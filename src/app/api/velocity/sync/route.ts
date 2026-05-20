/**
 * Code Guide:
 * GET  /api/velocity/sync — Returns the most recent synced_at timestamp from velocity_link_snapshot.
 * POST /api/velocity/sync — Pulls data from two Supabase views independently.
 *                           Stores both UTC date (order_date) and LA date (order_date_la) per row,
 *                           grouped by both dates so timezone-based filtering works without re-sync.
 *                           Batch-upserts into velocity_link_snapshot and velocity_custom_snapshot
 *                           (500 rows per batch each).
 */

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Shared SQL fragments ─────────────────────────────────────────────────────

const CHANNEL_CASE = (alias: string) => `
  CASE
    WHEN ${alias}.platform_source::text = 'SHOPIFY_COVERLAND' AND ${alias}.tags ILIKE '%B2B%' THEN 'Coverland B2B'
    WHEN ${alias}.platform_source::text = 'SHOPIFY_COVERLAND' THEN 'Coverland B2C'
    WHEN ${alias}.platform_source::text = 'SHOPIFY_ICARCOVER' THEN 'Icarcover'
    WHEN ${alias}.platform_source::text = 'AMAZON' AND ${alias}.fulfillment_channel::text = 'Amazon'   THEN 'Amazon FBA'
    WHEN ${alias}.platform_source::text = 'AMAZON' AND ${alias}.fulfillment_channel::text = 'Merchant' THEN 'Amazon FBM'
    WHEN ${alias}.platform_source::text = 'AMAZON' THEN 'Amazon FBA'
    WHEN ${alias}.platform_source::text = 'WALMART'       THEN 'Walmart'
    WHEN ${alias}.platform_source::text = 'EBAY_AUTOARMOR' THEN 'Auto_Armor'
    WHEN ${alias}.platform_source::text = 'EBAY'           THEN 'Advance_Parts'
    ELSE ${alias}.platform_source::text
  END`;

const ITEM_CATEGORY_CASE = (skuExpr: string) => `
  CASE
    WHEN ${skuExpr} = 'C-SJ-GR-7' OR ${skuExpr} LIKE 'CC%'             THEN 'Car Cover'
    WHEN ${skuExpr} LIKE 'CA-SC%' OR ${skuExpr} LIKE 'CL-SC%'          THEN 'Seat Cover'
    WHEN ${skuExpr} LIKE 'CA-FM%'                                       THEN 'Floor Mat'
    ELSE 'Miscellaneous'
  END`;

const ORDER_TYPE_CASE = (alias: string) => `
  CASE
    WHEN COALESCE(${alias}.is_ttm::boolean, false) AND COALESCE(${alias}.is_preorder::boolean, false) THEN 'ttm_preorder'
    WHEN COALESCE(${alias}.is_ttm::boolean, false)                                                    THEN 'ttm'
    WHEN COALESCE(${alias}.is_preorder::boolean, false)                                               THEN 'preorder'
    ELSE 'sales'
  END`;

const MASTER_SKU_REMAP: Record<string, string> = {
  "CC-CP-07-N-GR":      "CC-CP-03-M-GR-1TO",
  "CC-CSP-03-M-GR-1TO": "CC-CS-03-M-GR-1TO",
  "C-SJ-GR-7":          "CC-CS-03-J-GR-1TO",
};

const MASTER_SKU_REMAP_CASE = (skuExpr: string) => {
  const whens = Object.entries(MASTER_SKU_REMAP)
    .map(([from, to]) => `WHEN ${skuExpr} = '${from}' THEN '${to}'`)
    .join(" ");
  return `CASE ${whens} ELSE ${skuExpr} END`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkRow {
  order_date: Date;
  order_date_la: Date;
  channel: string;
  item_category: string;
  order_type: string;
  link_master_sku: string;
  link_qty: number;
}

interface CustomRow {
  order_date: Date;
  order_date_la: Date;
  channel: string;
  item_category: string;
  order_type: string;
  custom_master_sku: string;
  custom_qty: number;
}

// ─── Batch upsert helpers ─────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const primaryPool = () => getPrimaryPool();

async function upsertLink(rows: LinkRow[], syncedAt: Date): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await primaryPool().query(
      `INSERT INTO shipcore.velocity_link_snapshot
         (order_date, order_date_la, item_category, channel, order_type, link_master_sku, link_qty, synced_at)
       SELECT UNNEST($1::date[]), UNNEST($2::date[]), UNNEST($3::text[]), UNNEST($4::text[]),
              UNNEST($5::text[]), UNNEST($6::text[]), UNNEST($7::int[]), UNNEST($8::timestamptz[])
       ON CONFLICT (order_date, order_date_la, item_category, channel, order_type, link_master_sku)
       DO UPDATE SET
         link_qty  = EXCLUDED.link_qty,
         synced_at = EXCLUDED.synced_at`,
      [
        batch.map((r) => r.order_date.toISOString().slice(0, 10)),
        batch.map((r) => r.order_date_la.toISOString().slice(0, 10)),
        batch.map((r) => r.item_category),
        batch.map((r) => r.channel),
        batch.map((r) => r.order_type),
        batch.map((r) => r.link_master_sku),
        batch.map((r) => r.link_qty),
        batch.map(() => syncedAt),
      ]
    );
    upserted += batch.length;
  }
  return upserted;
}

async function upsertCustom(rows: CustomRow[], syncedAt: Date): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await primaryPool().query(
      `INSERT INTO shipcore.velocity_custom_snapshot
         (order_date, order_date_la, item_category, channel, order_type, custom_master_sku, custom_qty, synced_at)
       SELECT UNNEST($1::date[]), UNNEST($2::date[]), UNNEST($3::text[]), UNNEST($4::text[]),
              UNNEST($5::text[]), UNNEST($6::text[]), UNNEST($7::int[]), UNNEST($8::timestamptz[])
       ON CONFLICT (order_date, order_date_la, item_category, channel, order_type, custom_master_sku)
       DO UPDATE SET
         custom_qty = EXCLUDED.custom_qty,
         synced_at  = EXCLUDED.synced_at`,
      [
        batch.map((r) => r.order_date.toISOString().slice(0, 10)),
        batch.map((r) => r.order_date_la.toISOString().slice(0, 10)),
        batch.map((r) => r.item_category),
        batch.map((r) => r.channel),
        batch.map((r) => r.order_type),
        batch.map((r) => r.custom_master_sku),
        batch.map((r) => r.custom_qty),
        batch.map(() => syncedAt),
      ]
    );
    upserted += batch.length;
  }
  return upserted;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const pool = getPrimaryPool();
    const result = await pool.query<{ last_synced_at: Date | null }>(
      "SELECT MAX(synced_at) AS last_synced_at FROM shipcore.velocity_link_snapshot"
    );
    const lastSyncedAt = result.rows[0]?.last_synced_at ?? null;
    return NextResponse.json({ success: true, lastSyncedAt });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  const lookupPool = getLookupPool();
  if (!lookupPool) {
    return NextResponse.json(
      { success: false, error: "Supabase lookup pool not available" },
      { status: 503 }
    );
  }

  try {
    const [linkRes, customRes] = await Promise.all([
      lookupPool.query<LinkRow>(
        `SELECT
           (l.order_date AT TIME ZONE 'UTC')::date                  AS order_date,
           (l.order_date AT TIME ZONE 'America/Los_Angeles')::date  AS order_date_la,
           ${CHANNEL_CASE("l")}       AS channel,
           ${ITEM_CATEGORY_CASE("l.master_sku")} AS item_category,
           ${ORDER_TYPE_CASE("l")}    AS order_type,
           ${MASTER_SKU_REMAP_CASE("l.master_sku")} AS link_master_sku,
           SUM(l.quantity)::int       AS link_qty
         FROM ecommerce_data.vw_sales_order_items_link_new l
         WHERE l.master_sku  IS NOT NULL
           AND LOWER(l.item_status) IN ('delivered', 'fulfilled', 'partially_fulfilled', 'shipped', 'shipping', 'acknowledged', 'partially_refunded')
         GROUP BY 1, 2, 3, 4, 5, 6`
      ),
      lookupPool.query<CustomRow>(
        `SELECT
           (c.order_date AT TIME ZONE 'UTC')::date                  AS order_date,
           (c.order_date AT TIME ZONE 'America/Los_Angeles')::date  AS order_date_la,
           ${CHANNEL_CASE("c")}       AS channel,
           ${ITEM_CATEGORY_CASE("c.master_sku")} AS item_category,
           ${ORDER_TYPE_CASE("c")}    AS order_type,
           ${MASTER_SKU_REMAP_CASE("c.master_sku")} AS custom_master_sku,
           SUM(c.quantity)::int       AS custom_qty
         FROM ecommerce_data.vw_sales_order_items_custom_new c
         WHERE c.master_sku  IS NOT NULL
           AND LOWER(c.item_status) IN ('delivered', 'fulfilled', 'partially_fulfilled', 'shipped', 'shipping', 'acknowledged', 'partially_refunded')
         GROUP BY 1, 2, 3, 4, 5, 6`
      ),
    ]);

    const syncedAt = new Date();
    await primaryPool().query(
      "TRUNCATE TABLE shipcore.velocity_link_snapshot, shipcore.velocity_custom_snapshot"
    );
    const [linkUpserted, customUpserted] = await Promise.all([
      upsertLink(linkRes.rows, syncedAt),
      upsertCustom(customRes.rows, syncedAt),
    ]);

    return NextResponse.json({ success: true, linkUpserted, customUpserted });
  } catch (error) {
    console.error("[velocity/sync] POST error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
