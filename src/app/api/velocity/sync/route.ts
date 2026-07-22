/**
 * Code Guide:
 * GET  /api/velocity/sync — Returns the most recent synced_at timestamp from fc_velocity_link_snapshot.
 * POST /api/velocity/sync — Pulls data from two Supabase views independently.
 *                           Stores both UTC date (order_date) and LA date (order_date_la) per row,
 *                           grouped by both dates so timezone-based filtering works without re-sync.
 *                           Batch-upserts into fc_velocity_link_snapshot and fc_velocity_custom_snapshot
 *                           (500 rows per batch each).
 */

import { NextResponse, type NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const VELOCITY_SYNC_LOCK_KEY = 1000000001;
// No real sync has ever taken this long; a lock held past this age means the previous
// request's connection died without releasing it (e.g. dropped network, killed dev server)
// rather than a sync that's genuinely still running.
const STALE_LOCK_MAX_AGE_MS = 15 * 60 * 1000;

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
    WHEN ${skuExpr} LIKE '%SWC%'                                        THEN 'SWC'
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkRow {
  order_date: Date;
  order_date_la: Date;
  channel: string;
  item_category: string;
  order_type: string;
  link_master_sku: string;
  link_qty: number;
  is_custom: string;
}

interface CustomRow {
  order_date: Date;
  order_date_la: Date;
  channel: string;
  item_category: string;
  order_type: string;
  custom_master_sku: string;
  custom_qty: number;
  is_custom: string;
}

// ─── Batch upsert helpers ─────────────────────────────────────────────────────

const BATCH_SIZE = 2000;
// Only pull this many days of history — covers the 96-day max lookback with buffer.
const SYNC_LOOKBACK_DAYS = 120;
const primaryPool = () => getPrimaryPool();

async function upsertLink(rows: LinkRow[], syncedAt: Date, table = "shipcore.fc_velocity_link_snapshot"): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await primaryPool().query(
      `INSERT INTO ${table}
         (order_date, order_date_la, item_category, channel, order_type, link_master_sku, link_qty, synced_at, is_custom)
       SELECT UNNEST($1::date[]), UNNEST($2::date[]), UNNEST($3::text[]), UNNEST($4::text[]),
              UNNEST($5::text[]), UNNEST($6::text[]), UNNEST($7::int[]), UNNEST($8::timestamptz[]),
              UNNEST($9::text[])
       ON CONFLICT (order_date, order_date_la, item_category, channel, order_type, link_master_sku)
       DO UPDATE SET
         link_qty  = EXCLUDED.link_qty,
         synced_at = EXCLUDED.synced_at,
         is_custom = EXCLUDED.is_custom`,
      [
        batch.map((r) => r.order_date.toISOString().slice(0, 10)),
        batch.map((r) => r.order_date_la.toISOString().slice(0, 10)),
        batch.map((r) => r.item_category),
        batch.map((r) => r.channel),
        batch.map((r) => r.order_type),
        batch.map((r) => r.link_master_sku),
        batch.map((r) => r.link_qty),
        batch.map(() => syncedAt),
        batch.map((r) => r.is_custom),
      ],
    );
    upserted += batch.length;
  }
  return upserted;
}

async function upsertCustom(
  rows: CustomRow[],
  syncedAt: Date,
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await primaryPool().query(
      `INSERT INTO shipcore.fc_velocity_custom_snapshot
         (order_date, order_date_la, item_category, channel, order_type, custom_master_sku, custom_qty, synced_at, is_custom)
       SELECT UNNEST($1::date[]), UNNEST($2::date[]), UNNEST($3::text[]), UNNEST($4::text[]),
              UNNEST($5::text[]), UNNEST($6::text[]), UNNEST($7::int[]), UNNEST($8::timestamptz[]),
              UNNEST($9::text[])
       ON CONFLICT (order_date, order_date_la, item_category, channel, order_type, custom_master_sku)
       DO UPDATE SET
         custom_qty = EXCLUDED.custom_qty,
         synced_at  = EXCLUDED.synced_at,
         is_custom  = EXCLUDED.is_custom`,
      [
        batch.map((r) => r.order_date.toISOString().slice(0, 10)),
        batch.map((r) => r.order_date_la.toISOString().slice(0, 10)),
        batch.map((r) => r.item_category),
        batch.map((r) => r.channel),
        batch.map((r) => r.order_type),
        batch.map((r) => r.custom_master_sku),
        batch.map((r) => r.custom_qty),
        batch.map(() => syncedAt),
        batch.map((r) => r.is_custom),
      ],
    );
    upserted += batch.length;
  }
  return upserted;
}

// ─── Stale lock recovery ──────────────────────────────────────────────────────

async function reclaimStaleLock(
  client: PoolClient,
): Promise<{ reclaimed: boolean; holdSeconds: number | null }> {
  const holderRes = await client.query<{ pid: number; hold_seconds: number }>(
    `SELECT a.pid, EXTRACT(EPOCH FROM (now() - a.state_change))::int AS hold_seconds
     FROM pg_locks l
     JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory' AND l.objid = $1::bigint AND l.granted`,
    [VELOCITY_SYNC_LOCK_KEY],
  );

  const holder = holderRes.rows[0];
  if (!holder) return { reclaimed: false, holdSeconds: null };

  if (holder.hold_seconds * 1000 <= STALE_LOCK_MAX_AGE_MS) {
    return { reclaimed: false, holdSeconds: holder.hold_seconds };
  }

  console.warn(
    `[velocity/sync] Reclaiming stale advisory lock held by pid ${holder.pid} for ${holder.hold_seconds}s`,
  );
  await client.query(`SELECT pg_terminate_backend($1::int)`, [holder.pid]);
  return { reclaimed: true, holdSeconds: holder.hold_seconds };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const pool = getPrimaryPool();
    const result = await pool.query<{ last_synced_at: Date | null }>(
      "SELECT MAX(synced_at) AS last_synced_at FROM shipcore.fc_velocity_link_snapshot",
    );
    const lastSyncedAt = result.rows[0]?.last_synced_at ?? null;
    return NextResponse.json({ success: true, lastSyncedAt });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full") === "true";
  const dateFilter = full ? "" : `AND l.order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days'`;
  const dateFilterC = full ? "" : `AND c.order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days'`;

  const lookupPool = getLookupPool();
  if (!lookupPool) {
    return NextResponse.json(
      { success: false, error: "Supabase lookup pool not available" },
      { status: 503 },
    );
  }

  const client = await primaryPool().connect();
  let lockAcquired = false;
  try {
    let lockRes = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
      [VELOCITY_SYNC_LOCK_KEY],
    );

    if (!lockRes.rows[0].acquired) {
      const { reclaimed, holdSeconds } = await reclaimStaleLock(client);
      if (reclaimed) {
        lockRes = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
          [VELOCITY_SYNC_LOCK_KEY],
        );
      }

      if (!lockRes.rows[0].acquired) {
        return NextResponse.json(
          { success: false, error: "Sync already in progress", holdSeconds },
          { status: 409 },
        );
      }
    }
    lockAcquired = true;

    const LINK_WHERE = `
           WHERE l.master_sku  IS NOT NULL
           AND NOT (l.platform_source::text NOT IN ('SHOPIFY_COVERLAND', 'SHOPIFY_ICARCOVER') AND (l.master_sku LIKE '%NEW%' OR l.master_sku LIKE '%INV%'))
           AND (
             (l.fulfilled_quantity > 0
              AND (
                (l.platform_source::text = 'AMAZON' AND (LOWER(l.item_status) LIKE '%shipped%' OR LOWER(l.item_status) IN ('refunded', 'partially_refunded')))
                OR (l.platform_source::text = 'WALMART' AND LOWER(l.item_status) IN ('delivered', 'shipped', 'refunded', 'partially_refunded'))
                OR (l.platform_source::text IN ('EBAY', 'EBAY_AUTOARMOR') AND LOWER(l.item_status) IN ('fulfilled', 'refunded', 'partially_refunded'))
                OR (l.platform_source::text IN ('SHOPIFY_COVERLAND', 'SHOPIFY_ICARCOVER') AND LOWER(l.item_status) NOT IN ('cancelled', 'pending'))
              ))
             OR (COALESCE(l.is_preorder::boolean, false) AND LOWER(l.item_status) != 'cancelled')
           )
           AND NOT (l.platform_source::text = 'SHOPIFY_ICARCOVER' AND l.tags IS NOT NULL AND (l.tags ILIKE '%ebay%' OR l.tags ILIKE '%influencer%'))
           AND NOT (l.tags IS NOT NULL AND l.tags ILIKE '%Test%')`;

    const CUSTOM_WHERE = `
           WHERE c.master_sku  IS NOT NULL
           AND NOT (c.platform_source::text NOT IN ('SHOPIFY_COVERLAND', 'SHOPIFY_ICARCOVER') AND (c.master_sku LIKE '%NEW%' OR c.master_sku LIKE '%INV%'))
           AND (
             (c.fulfilled_quantity > 0
              AND (
                (c.platform_source::text = 'AMAZON' AND (LOWER(c.item_status) LIKE '%shipped%' OR LOWER(c.item_status) IN ('refunded', 'partially_refunded')))
                OR (c.platform_source::text = 'WALMART' AND LOWER(c.item_status) IN ('delivered', 'shipped', 'refunded', 'partially_refunded'))
                OR (c.platform_source::text IN ('EBAY', 'EBAY_AUTOARMOR') AND LOWER(c.item_status) IN ('fulfilled', 'refunded', 'partially_refunded'))
                OR (c.platform_source::text IN ('SHOPIFY_COVERLAND', 'SHOPIFY_ICARCOVER') AND LOWER(c.item_status) NOT IN ('cancelled', 'pending'))
              ))
             OR (COALESCE(c.is_preorder::boolean, false) AND LOWER(c.item_status) != 'cancelled')
           )
           AND NOT (c.platform_source::text = 'SHOPIFY_ICARCOVER' AND c.tags IS NOT NULL AND (c.tags ILIKE '%ebay%' OR c.tags ILIKE '%influencer%'))
           AND NOT (c.tags IS NOT NULL AND c.tags ILIKE '%Test%')`;

    const LINK_SELECT = `
        SELECT
           (l.order_date AT TIME ZONE 'UTC')::date                  AS order_date,
           (l.order_date AT TIME ZONE 'America/Los_Angeles')::date  AS order_date_la,
           ${CHANNEL_CASE("l")}       AS channel,
           ${ITEM_CATEGORY_CASE("l.master_sku")} AS item_category,
           ${ORDER_TYPE_CASE("l")}    AS order_type,
           ${normalizedMasterSkuSql("l.master_sku")} AS link_master_sku,
           SUM(l.quantity)::int AS link_qty,
           l.is_custom                AS is_custom
         FROM ecommerce_data.vw_sales_order_items_link_new l`;

    const CUSTOM_SELECT = `
        SELECT
           (c.order_date AT TIME ZONE 'UTC')::date                  AS order_date,
           (c.order_date AT TIME ZONE 'America/Los_Angeles')::date  AS order_date_la,
           ${CHANNEL_CASE("c")}       AS channel,
           ${ITEM_CATEGORY_CASE("c.master_sku")} AS item_category,
           ${ORDER_TYPE_CASE("c")}    AS order_type,
           ${normalizedMasterSkuSql("c.master_sku")} AS custom_master_sku,
           SUM(c.quantity)::int AS custom_qty,
           c.is_custom                AS is_custom
         FROM ecommerce_data.vw_sales_order_items_custom_new c`;

    const [linkRes, customRes, linkForecastRes] = await Promise.all([
      lookupPool.query<LinkRow>(
        `${LINK_SELECT} ${LINK_WHERE} ${dateFilter} GROUP BY 1, 2, 3, 4, 5, 6, 8`,
      ),
      lookupPool.query<CustomRow>(
        `${CUSTOM_SELECT} ${CUSTOM_WHERE} ${dateFilterC} GROUP BY 1, 2, 3, 4, 5, 6, 8`,
      ),
      lookupPool.query<LinkRow>(
        `${LINK_SELECT} ${LINK_WHERE} GROUP BY 1, 2, 3, 4, 5, 6, 8`,
      ),
    ]);

    const syncedAt = new Date();
    const [linkUpserted, customUpserted] = await Promise.all([
      upsertLink(linkRes.rows, syncedAt),
      upsertCustom(customRes.rows, syncedAt),
      upsertLink(linkForecastRes.rows, syncedAt, "shipcore.fc_velocity_link_snapshot_forecast"),
    ]);

    const [linkDeleteRes, customDeleteRes] = await Promise.all([
      primaryPool().query(
        full
          ? `DELETE FROM shipcore.fc_velocity_link_snapshot WHERE synced_at < $1`
          : `DELETE FROM shipcore.fc_velocity_link_snapshot WHERE order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days' AND synced_at < $1`,
        [syncedAt],
      ),
      primaryPool().query(
        full
          ? `DELETE FROM shipcore.fc_velocity_custom_snapshot WHERE synced_at < $1`
          : `DELETE FROM shipcore.fc_velocity_custom_snapshot WHERE order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days' AND synced_at < $1`,
        [syncedAt],
      ),
      primaryPool().query(
        `DELETE FROM shipcore.fc_velocity_link_snapshot_forecast WHERE synced_at < $1`,
        [syncedAt],
      ),
    ]);

    return NextResponse.json({
      success: true,
      linkUpserted,
      customUpserted,
      linkDeleted: linkDeleteRes.rowCount ?? 0,
      customDeleted: customDeleteRes.rowCount ?? 0,
    });
  } catch (error) {
    console.error("[velocity/sync] POST error:", getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  } finally {
    if (lockAcquired) {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [
        VELOCITY_SYNC_LOCK_KEY,
      ]);
    }
    client.release();
  }
}
