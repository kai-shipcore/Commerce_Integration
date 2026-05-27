// Code Guide: Returns DemandPlanningData for the /planning/dashboard page.
// Phase 1 data sources:
//   fc_containers          — container headers (primary DB)
//   fc_container_items     — per-SKU inbound qty per container (primary DB)
//   fc_stats               — pre-calculated sales/inventory stats (primary DB, LEFT JOIN)
//                            Empty table is fine — all stats columns default to 0.
//   coverland_inventory    — backorder qty (Supabase lookup, best-effort)
// Run prisma/sql/fc_stats.sql once before using this route.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import type {
  ContainerMeta,
  ContainerRowData,
  DemandPlanningData,
  DemandRow,
} from "@/types/demand-planning";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

// Parses seat / no / color / tone from a master SKU string.
// CA-SC-{no}-{seat}-{size}-{color}-{tone}  e.g. CA-SC-10-F-10-BK-1TO
// CA-FM-{no}-{seat}-{size}-{color}          e.g. CA-FM-10-F-10-BK
function parseSku(sku: string): { seat: string; no: number; color: string; tone: string } {
  const p = sku.toUpperCase().split("-");
  if (p[0] === "CA" && p[1] === "SC" && p.length >= 6) {
    return { no: parseInt(p[2]) || 0, seat: p[3] ?? "", color: p[5] ?? "", tone: p[6] ?? "" };
  }
  if (p[0] === "CA" && p[1] === "FM" && p.length >= 5) {
    return { no: parseInt(p[2]) || 0, seat: p[3] ?? "", color: p[5] ?? "", tone: "" };
  }
  return { no: 0, seat: "", color: "", tone: "" };
}

function inferCategoryCode(sku: string): "SC" | "CC" | "FM" {
  const normalized = sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  return "SC";
}

// DB status values for containers that have confirmed quantities.
// 'shipped'         = Final List Sent (UI: final-list-sent)
// 'packing_received' = Packing List Received (UI: packing-list-received)
const ACTIVE = `('shipped', 'packing_received')`;

export async function GET() {
  try {
    const primary = getPrimaryPool();
    const lookup  = getLookupPool();

    // ── 1. Container headers ─────────────────────────────────────────────────
    // All containers regardless of status so drafts also appear as columns.
    const containersResult = await primary.query<{
      id: number; name: string; eta: string; cbm_cap: number; status: string;
    }>(`
      SELECT
        id::int                   AS id,
        container_number          AS name,
        eta_date::text            AS eta,
        cbm_capacity::float8      AS cbm_cap,
        status
      FROM shipcore.fc_containers
      ORDER BY
        CASE WHEN status IN ${ACTIVE} THEN 0 ELSE 1 END,
        eta_date NULLS LAST,
        id
    `);

    // ── 2. Per-SKU rows ──────────────────────────────────────────────────────
    // Drives from fc_stats (all SKUs) and LEFT JOINs container aggregation,
    // so SKUs with no active containers still appear with their stats.
    const rowsResult = await primary.query(`
      SELECT
        s.master_sku                                          AS sku,
        COALESCE(agg.total_inbound_qty, 0)::int              AS total_inbound_qty,
        agg.containers_list,
        agg.next_eta,
        agg.cbm_unit,
        agg.latest_container,
        agg.latest_eta,
        agg.latest_qty,
        COALESCE(s.sales_status,   'Original')               AS sales_status,
        p.category_code                                      AS category_code,
        COALESCE(p.cbm_per_unit, 0)::float8                  AS cbm_per_unit,
        COALESCE(s.back,           0)::int                   AS back,
        COALESCE(s.west_stock,     0)::int                   AS west_stock,
        COALESCE(s.east_stock,     0)::int                   AS east_stock,
        COALESCE(s.total_stock,    0)::int                   AS total_stock,
        COALESCE(s.west_90d,       0)::float8                AS west_90d,
        COALESCE(s.west_60d,       0)::float8                AS west_60d,
        COALESCE(s.west_30d,       0)::float8                AS west_30d,
        COALESCE(s.west_15d,       0)::float8                AS west_15d,
        COALESCE(s.west_7d,        0)::float8                AS west_7d,
        COALESCE(s.west_30d_pre,   0)::float8                AS west_30d_pre,
        COALESCE(s.east_90d,       0)::float8                AS east_90d,
        COALESCE(s.east_60d,       0)::float8                AS east_60d,
        COALESCE(s.east_30d,       0)::float8                AS east_30d,
        COALESCE(s.east_15d,       0)::float8                AS east_15d,
        COALESCE(s.east_7d,        0)::float8                AS east_7d,
        COALESCE(s.east_30d_pre,   0)::float8                AS east_30d_pre,
        COALESCE(s.avg_daily_prev, 0)::float8                AS avg_daily_prev,
        COALESCE(s.avg_daily_real, 0)::float8                AS avg_daily_real,
        COALESCE(s.avg_daily_curr, 0)::float8                AS avg_daily_curr,
        COALESCE(s.east_avg_prev,  0)::float8                AS east_avg_prev,
        COALESCE(s.east_avg_real,  0)::float8                AS east_avg_real,
        COALESCE(s.east_avg_curr,  0)::float8                AS east_avg_curr,
        COALESCE(s.fba_avg_real,   0)::float8                AS fba_avg_real,
        COALESCE(s.fba_avg_curr,   0)::float8                AS fba_avg_curr,
        COALESCE(s.west_fbm_30d,   0)::int                   AS west_fbm_30d,
        COALESCE(s.east_fbm_30d,   0)::int                   AS east_fbm_30d,
        COALESCE(s.fba_30d,        0)::int                   AS fba_30d,
        COALESCE(s.total_30d,      0)::int                   AS total_30d,
        COALESCE(s.total_avg_prev, 0)::float8                AS total_avg_prev,
        COALESCE(s.total_avg_real, 0)::float8                AS total_avg_real,
        COALESCE(s.total_avg_curr, 0)::float8                AS total_avg_curr
      FROM shipcore.fc_stats s
      LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
      LEFT JOIN (
        SELECT
          ci.master_sku,
          SUM(ci.qty)::int                                                             AS total_inbound_qty,
          STRING_AGG(
            c.container_number || ' (' || ci.qty || ')', ', '
            ORDER BY c.eta_date NULLS LAST
          )                                                                             AS containers_list,
          MIN(c.eta_date)::text                                                         AS next_eta,
          AVG(ci.cbm_unit)::float8                                                      AS cbm_unit,
          (ARRAY_AGG(c.container_number   ORDER BY c.eta_date NULLS LAST))[1]          AS latest_container,
          (ARRAY_AGG(c.eta_date::text     ORDER BY c.eta_date NULLS LAST))[1]          AS latest_eta,
          (ARRAY_AGG(ci.qty               ORDER BY c.eta_date NULLS LAST))[1]::int     AS latest_qty
        FROM shipcore.fc_container_items ci
        JOIN shipcore.fc_containers c ON c.id = ci.container_id
        WHERE c.status IN ${ACTIVE}
        GROUP BY ci.master_sku
      ) agg ON agg.master_sku = s.master_sku
      ORDER BY s.master_sku
    `);

    // ── 3. Per-SKU × per-container cross data ────────────────────────────────
    // inbound_qty and avail_qty both come from fc_container_items.qty for now.
    // open_orders / est_sales / inv_life / est_sod / plan_sod → Phase 2
    const crossResult = await primary.query(`
      SELECT
        ci.id::int                 AS item_id,
        ci.master_sku              AS sku,
        c.container_number         AS container_name,
        ci.qty::int                AS inbound_qty,
        ci.qty::int                AS avail_qty,
        ci.cbm_unit::float8        AS cbm_unit,
        ci.total_cbm::float8       AS cbm,
        c.eta_date::text           AS eta,
        NULL::int                  AS open_orders,
        NULL::int                  AS est_sales,
        NULL::int                  AS backorder,
        NULL::float8               AS inv_life,
        NULL::text                 AS est_sod,
        NULL::text                 AS plan_sod
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
    `);

    // ── 4. Backorders from Supabase (best-effort) ────────────────────────────
    // Sums backorder across all rows per master_sku in coverland_inventory.
    // Falls back to 0 per SKU if Supabase is unavailable.
    const backorderMap = new Map<string, number>();
    if (lookup) {
      try {
        const boResult = await lookup.query<{ master_sku: string; backorder: string }>(`
          SELECT
            BTRIM(master_sku)            AS master_sku,
            SUM(COALESCE(backorder, 0))::text AS backorder
          FROM ecommerce_data.coverland_inventory
          WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
          GROUP BY BTRIM(master_sku)
        `);
        for (const r of boResult.rows) {
          backorderMap.set(r.master_sku, parseInt(r.backorder) || 0);
        }
      } catch {
        // Supabase unreachable — all backorders stay 0
      }
    }

    // ── Assemble response ────────────────────────────────────────────────────

    const containers: ContainerMeta[] = containersResult.rows.map((r, i) => ({
      col:          i,
      container_id: r.id,
      name:         r.name,
      eta:          r.eta,
      cbm_cap:      r.cbm_cap ?? 0,
      status:       r.status,
    }));

    // cross-data lookup: sku → container_name → ContainerRowData
    const crossMap = new Map<string, Map<string, ContainerRowData>>();
    for (const r of crossResult.rows) {
      if (!crossMap.has(r.sku)) crossMap.set(r.sku, new Map());
      crossMap.get(r.sku)!.set(r.container_name, {
        item_id:     r.item_id,
        cbm_unit:    r.cbm_unit,
        inbound_qty: r.inbound_qty,
        open_orders: r.open_orders,
        avail_qty:   r.avail_qty,
        est_sales:   r.est_sales,
        backorder:   r.backorder,
        eta:         r.eta,
        inv_life:    r.inv_life,
        est_sod:     r.est_sod,
        plan_sod:    r.plan_sod,
        cbm:         r.cbm,
      });
    }

    const rows: DemandRow[] = rowsResult.rows.map((r) => {
      const { seat, no, color, tone } = parseSku(r.sku as string);
      const categoryCode = r.category_code === "SC" || r.category_code === "CC" || r.category_code === "FM"
        ? r.category_code
        : inferCategoryCode(r.sku as string);

      const containerInfo = r.latest_container
        ? `${r.latest_eta ?? ""} - (${r.latest_container}) - ${r.latest_qty ?? ""}`
        : "";

      const skuCross = crossMap.get(r.sku as string);
      const containersObj: Record<string, ContainerRowData> = {};
      if (skuCross) {
        for (const [name, data] of skuCross) containersObj[name] = data;
      }

      return {
        container_info:    containerInfo,
        cbm:               (r.cbm_unit as number) ?? 0,
        cbm_per_unit:      (r.cbm_per_unit as number) ?? 0,
        seat,
        no,
        color,
        tone,
        back:              r.back as number,
        sales_status:      (r.sales_status as "Original" | "Custom" | "Hold"),
        category_code:     categoryCode,
        sku:               r.sku as string,
        west_stock:        r.west_stock,
        east_stock:        r.east_stock,
        total_stock:       r.total_stock,
        west_90d:          r.west_90d,
        west_60d:          r.west_60d,
        west_30d:          r.west_30d,
        west_15d:          r.west_15d,
        west_7d:           r.west_7d,
        west_30d_pre:      r.west_30d_pre,
        east_90d:          r.east_90d,
        east_60d:          r.east_60d,
        east_30d:          r.east_30d,
        east_15d:          r.east_15d,
        east_7d:           r.east_7d,
        east_30d_pre:      r.east_30d_pre,
        avg_daily_prev:    r.avg_daily_prev,
        avg_daily_real:    r.avg_daily_real,
        avg_daily_curr:    r.avg_daily_curr,
        east_avg_prev:     r.east_avg_prev,
        east_avg_real:     r.east_avg_real,
        east_avg_curr:     r.east_avg_curr,
        fba_avg_real:      r.fba_avg_real,
        fba_avg_curr:      r.fba_avg_curr,
        west_fbm_30d:      r.west_fbm_30d,
        east_fbm_30d:      r.east_fbm_30d,
        fba_30d:           r.fba_30d,
        total_30d:         r.total_30d,
        total_avg_prev:    r.total_avg_prev,
        total_avg_real:    r.total_avg_real,
        total_avg_curr:    r.total_avg_curr,
        total_inbound_qty: r.total_inbound_qty,
        containers_list:   r.containers_list ?? null,
        next_eta:          r.next_eta ?? null,
        sod:               (() => {
          const rate = r.total_avg_real as number;
          if (!rate) return null;
          const days = Math.round((r.total_stock as number) / rate);
          const d = new Date();
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        })(),
        containers:        containersObj,
      };
    });

    return NextResponse.json({ success: true, data: { containers, rows } satisfies DemandPlanningData });
  } catch (error) {
    console.error("Planning dashboard GET failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
