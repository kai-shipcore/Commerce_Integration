// Code Guide: Returns DemandPlanningData for the /planning/dashboard page.
// Phase 1 data sources:
//   fc_containers          â€” container headers (primary DB)
//   fc_container_items     â€” per-SKU inbound qty per container (primary DB)
//   fc_stats               â€” pre-calculated sales/inventory stats (primary DB, LEFT JOIN)
//                            Empty table is fine â€” all stats columns default to 0.
//   coverland_inventory    â€” backorder qty (Supabase lookup, best-effort)
// Run prisma/sql/fc_stats.sql once before using this route.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { addSheetDays, planningLocalDateString } from "@/lib/planning/date-utils";
import { getPlanningDashboardCache, setPlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import {
  currentDailyAverage,
  fbmThirtyDayAverage,
  forecastCategoryCodeForSku,
  inventoryLifeDays,
} from "@/lib/planning/forecast-calculations";
import { DEFAULT_SEASONAL_FACTORS, seasonalFactorForEta } from "@/lib/planning/seasonal-factors";
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

function inferCategoryCode(sku: string): "SC" | "CC" | "FM" | "AC" {
  const normalized = sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

// DB status values for containers that have confirmed quantities.
// 'shipped'         = Final List Sent (UI: final-list-sent)
// 'packing_received' = Packing List Received (UI: packing-list-received)
const ACTIVE = `('shipped', 'packing_received')`;

// Set to false to skip the fc_pinned_rows query and hide reference rows from the grid.
const PINNED_ROWS_ENABLED = false;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") === "custom" ? "custom" : "link";
    const includeContainers = searchParams.get("includeContainers") === "1";
    const rawContainers = includeContainers && searchParams.get("rawContainers") === "1";
    const includeDrafts = searchParams.get("includeDrafts") === "1";
    const inboundStatuses = includeDrafts ? "('shipped', 'packing_received', 'draft')" : ACTIVE;
    const categoryParam = (searchParams.get("product") ?? searchParams.get("category") ?? "").toUpperCase();
    const categoryCode = categoryParam === "SC" || categoryParam === "CC" || categoryParam === "FM" || categoryParam === "AC"
      ? categoryParam
      : null;
    const categoryParams = categoryCode ? [categoryCode] : [];
    const categoryWhere = categoryCode ? "AND p.category_code = $1" : "";
    const productCategoryWhere = categoryCode ? "WHERE p.category_code = $1" : "";
    const categoryJoinWhere = categoryCode ? "AND p.category_code = $1" : "";
    const todayDefault = planningLocalDateString();
    const asOfParam = searchParams.get("asOf");
    const todayStr = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : todayDefault;
    const isToday = todayStr === todayDefault;
    const cached = await getPlanningDashboardCache(mode, includeContainers, isToday ? undefined : todayStr, includeDrafts, categoryCode ?? undefined, rawContainers);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "x-planning-dashboard-cache": "HIT" },
      });
    }

    // CC and FM SKUs always use custom velocity; SC uses the mode selection.
    // In custom mode all SKUs come from fc_stats_custom so no UNION needed.
    const statsSource = (() => {
      if (mode === "custom") return "shipcore.fc_stats_custom";
      if (categoryCode === "CC" || categoryCode === "FM") return "shipcore.fc_stats_custom";
      if (categoryCode === "SC") return "shipcore.fc_stats";
      return `(
          SELECT s.* FROM shipcore.fc_stats_custom s
          WHERE EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM')
          )
          UNION ALL
          SELECT s.* FROM shipcore.fc_stats s
          WHERE NOT EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM')
          )
        )`;
    })();

    const primary = getPrimaryPool();

    // ── 1-5 run in parallel: containers, stats rows, available stock, last sync, pinned rows ──
    const [containersResult, rowsResult, availStockResult, lastSyncResultEarly, pinnedRowsResult] = await Promise.all([
      // 1. Container headers
      primary.query<{ id: number; name: string; eta: string; cbm_cap: number; status: string }>(`
        SELECT
          id::int                   AS id,
          container_number          AS name,
          eta_date::text            AS eta,
          cbm_capacity::float8      AS cbm_cap,
          status
        FROM shipcore.fc_containers
        WHERE status != 'complete'
          ${categoryCode ? `AND (
            NOT EXISTS (
              SELECT 1
              FROM shipcore.fc_container_items ci_any
              WHERE ci_any.container_id = fc_containers.id
            )
            OR EXISTS (
              SELECT 1
              FROM shipcore.fc_container_items ci
              JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
              WHERE ci.container_id = fc_containers.id
                AND ci.qty > 0
                AND p.category_code = $1
            )
          )` : ""}
        ORDER BY
          eta_date NULLS LAST,
          id
      `, categoryParams),
      // 2. Per-SKU stats rows
      primary.query(`
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
        COALESCE(p.case_qty, 1)::int                          AS case_qty,
        COALESCE(p.moq, 1)::int                              AS moq,
        COALESCE(p.order_multiple, p.moq, 1)::int            AS order_multiple,
        COALESCE(s.back,                   0)::int            AS back,
        COALESCE(s.west_stock,             0)::int            AS west_stock,
        COALESCE(s.east_stock,             0)::int            AS east_stock,
        COALESCE(s.west_available_stock,   0)::int            AS west_available_stock,
        COALESCE(s.east_available_stock,   0)::int            AS east_available_stock,
        COALESCE(s.transit_stock,          0)::int            AS transit_stock,
        (COALESCE(s.west_stock, 0) + COALESCE(s.east_stock, 0) + COALESCE(s.transit_stock, 0))::int AS total_stock,
        COALESCE(s.stock_mode, 'onhand')                      AS stock_mode,
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
      FROM ${statsSource} s
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
        JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
        WHERE c.status IN ${inboundStatuses}
          ${categoryWhere}
        GROUP BY ci.master_sku
      ) agg ON agg.master_sku = s.master_sku
      ${productCategoryWhere}
      ORDER BY s.master_sku
    `, categoryParams),
      // 3. Available stock (remaining / mistake)
      primary.query<{ master_sku: string; source_type: string; total_qty: string }>(`
        SELECT
          s.master_sku,
          s.source_type,
          SUM(GREATEST(s.total_qty - COALESCE(alloc.allocated_qty, 0), 0))::int::text AS total_qty
        FROM shipcore.fc_available_stock s
        JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
        LEFT JOIN (
          SELECT source_stock_id, SUM(qty)::int AS allocated_qty
          FROM shipcore.fc_container_item_allocations
          GROUP BY source_stock_id
        ) alloc ON alloc.source_stock_id = s.id
        ${productCategoryWhere}
        GROUP BY s.master_sku, s.source_type
      `, categoryParams),
      // 4. Last sync timestamp
      primary.query<{ last_sync: string | null }>(
        `SELECT to_char(MAX(calculated_at) AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') AS last_sync FROM shipcore.fc_stats`
      ),
      // 5. Reference rows pinned to the top (skipped when PINNED_ROWS_ENABLED = false)
      PINNED_ROWS_ENABLED
        ? primary.query<{
            master_sku: string; sort_order: number; back: number;
            west_stock: number; east_stock: number; total_stock: number;
            west_90d: number; west_60d: number; west_30d: number; west_15d: number; west_7d: number; west_30d_pre: number;
            east_90d: number; east_60d: number; east_30d: number; east_15d: number; east_7d: number; east_30d_pre: number;
            fba_30d: number; avg_daily_prev: number; east_avg_prev: number;
          }>(`
            SELECT master_sku, sort_order,
                   COALESCE(back,0)::int        AS back,
                   COALESCE(west_stock,0)::int  AS west_stock,
                   COALESCE(east_stock,0)::int  AS east_stock,
                   COALESCE(total_stock,0)::int AS total_stock,
                   COALESCE(west_90d,0)::float8  AS west_90d,   COALESCE(west_60d,0)::float8 AS west_60d,
                   COALESCE(west_30d,0)::float8  AS west_30d,   COALESCE(west_15d,0)::float8 AS west_15d,
                   COALESCE(west_7d,0)::float8   AS west_7d,    COALESCE(west_30d_pre,0)::float8 AS west_30d_pre,
                   COALESCE(east_90d,0)::float8  AS east_90d,   COALESCE(east_60d,0)::float8 AS east_60d,
                   COALESCE(east_30d,0)::float8  AS east_30d,   COALESCE(east_15d,0)::float8 AS east_15d,
                   COALESCE(east_7d,0)::float8   AS east_7d,    COALESCE(east_30d_pre,0)::float8 AS east_30d_pre,
                   COALESCE(fba_30d,0)::int      AS fba_30d,
                   COALESCE(avg_daily_prev,0)::float8 AS avg_daily_prev,
                   COALESCE(east_avg_prev,0)::float8  AS east_avg_prev
            FROM shipcore.fc_pinned_rows
            ORDER BY sort_order
          `)
        : Promise.resolve({ rows: [] as never[] }),
    ]);

    // â”€â”€ 1b + cross: run in parallel after containersResult is available â”€â”€â”€â”€â”€â”€
    const containerIds = containersResult.rows.map((r) => r.id);
    const [categoriesResult, crossResult] = await Promise.all([
      // 1b. Category codes per container
      containerIds.length > 0
        ? primary.query<{ container_id: number; category_code: string }>(`
            SELECT ci.container_id::int, p.category_code
            FROM shipcore.fc_container_items ci
            JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
            WHERE ci.container_id = ANY($1::int[])
              AND ci.qty > 0
              AND p.category_code IS NOT NULL
            GROUP BY ci.container_id, p.category_code
          `, [containerIds])
        : Promise.resolve({ rows: [] as { container_id: number; category_code: string }[] }),
      // cross data (only for includeContainers=1)
      includeContainers ? primary.query(`
        SELECT
          ci.id::int                 AS item_id,
          ci.master_sku              AS sku,
          c.container_number         AS container_name,
          ci.qty::int                AS inbound_qty,
          COALESCE(ar.allocated_remaining_qty, 0)::int AS allocated_remaining_qty,
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
        JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
        LEFT JOIN (
          SELECT
            a.container_id,
            s.master_sku,
            SUM(a.qty)::int AS allocated_remaining_qty
          FROM shipcore.fc_container_item_allocations a
          JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
          WHERE s.source_type IN ('remaining', 'mistake')
          GROUP BY a.container_id, s.master_sku
        ) ar ON ar.container_id = ci.container_id
             AND ar.master_sku = ci.master_sku
        WHERE ${rawContainers ? `c.status != 'complete'` : `c.status IN ${inboundStatuses}`}
          ${categoryJoinWhere}
      `, categoryParams) : Promise.resolve({ rows: [] }),
    ]);

    // Build derived maps from parallel results

    const categoriesByContainer = new Map<number, string[]>();
    for (const row of categoriesResult.rows) {
      const arr = categoriesByContainer.get(row.container_id) ?? [];
      arr.push(row.category_code);
      categoriesByContainer.set(row.container_id, arr);
    }

    const availStockMap = new Map<string, { remaining: number; mistake: number }>();
    for (const r of availStockResult.rows) {
      const entry = availStockMap.get(r.master_sku) ?? { remaining: 0, mistake: 0 };
      if (r.source_type === "remaining") entry.remaining = parseInt(r.total_qty) || 0;
      if (r.source_type === "mistake")   entry.mistake   = parseInt(r.total_qty) || 0;
      availStockMap.set(r.master_sku, entry);
    }

    const lastSync = lastSyncResultEarly.rows[0]?.last_sync ?? null;

    // â”€â”€ 6b. Historical velocity (when asOf != today) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Re-compute velocity windows from snapshot tables using asOf as reference.
    // Inventory (west_stock etc.) always stays current â€” no historical snapshots.
    type VelRow = {
      master_sku: string; west_90d: number; west_60d: number; west_30d: number;
      west_15d: number; west_7d: number; west_30d_pre: number;
      east_90d: number; east_60d: number; east_30d: number;
      east_15d: number; east_7d: number; east_30d_pre: number;
      avg_daily_real: number; avg_daily_prev: number;
      east_avg_real: number; east_avg_prev: number;
      fba_avg_real: number; fba_avg_prev: number; fba_30d: number;
      _avg_curr: number; _east_curr: number; _fba_curr: number;
    };
    // SC uses link_snapshot velocity; CC/FM use custom_snapshot velocity.
    // Two separate maps so rows.map() can select by category_code.
    const linkVelMap   = new Map<string, VelRow>();
    const customVelMap = new Map<string, VelRow>();

    if (!isToday) {
      function velQuery(table: "shipcore.fc_velocity_link_snapshot", skuCol: "link_master_sku", qtyCol: "link_qty"): string;
      function velQuery(table: "shipcore.fc_velocity_custom_snapshot", skuCol: "custom_master_sku", qtyCol: "custom_qty"): string;
      function velQuery(table: string, skuCol: string, qtyCol: string): string {
        return `
          SELECT
            ${skuCol} AS master_sku,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 89 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_90d,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 59 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_60d,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 29 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_30d,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 14 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_15d,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 6  AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_7d,
            SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= $1::date - 29 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS west_30d_pre,
            SUM(CASE WHEN order_type = 'ttm' AND order_date >= $1::date - 89 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_90d,
            SUM(CASE WHEN order_type = 'ttm' AND order_date >= $1::date - 59 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_60d,
            SUM(CASE WHEN order_type = 'ttm' AND order_date >= $1::date - 29 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_30d,
            SUM(CASE WHEN order_type = 'ttm' AND order_date >= $1::date - 14 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_15d,
            SUM(CASE WHEN order_type = 'ttm' AND order_date >= $1::date - 6  AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_7d,
            SUM(CASE WHEN order_type = 'ttm_preorder' AND order_date >= $1::date - 29 AND order_date <= $1::date THEN ${qtyCol} ELSE 0 END)::float8 AS east_30d_pre,
            (SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-89 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-59 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-14 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-6 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15+SUM(CASE WHEN order_type='preorder' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10)::float8 AS avg_daily_real,
            (SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-96 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-66 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-21 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN order_type='sales' AND channel!='Amazon FBA' AND order_date>=$1::date-13 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15+SUM(CASE WHEN order_type='preorder' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10)::float8 AS avg_daily_prev,
            GREATEST(0.01, SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-89 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-59 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN order_type='ttm_preorder' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-14 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-6 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15)::float8 AS east_avg_real,
            GREATEST(0.01, SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-96 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-66 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN order_type='ttm_preorder' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-21 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN order_type='ttm' AND order_date>=$1::date-13 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15)::float8 AS east_avg_prev,
            (SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30)::float8 AS fba_avg_real,
            (SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30)::float8 AS fba_avg_prev,
            SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::int AS fba_30d
          FROM ${table}
          WHERE ${skuCol} IS NOT NULL AND order_date >= $1::date - 96
          GROUP BY ${skuCol}
        `;
      }

      // link mode: SC uses link_snapshot, CC/FM use custom_snapshot
      // custom mode: everything uses custom_snapshot
      // Keep two separate maps so rows.map() can select by category_code.
      const [linkVelResult, customVelResult] = await Promise.all([
        mode === "link" ? primary.query<VelRow>(velQuery("shipcore.fc_velocity_link_snapshot", "link_master_sku", "link_qty"), [todayStr]) : Promise.resolve({ rows: [] as VelRow[] }),
        primary.query<VelRow>(velQuery("shipcore.fc_velocity_custom_snapshot", "custom_master_sku", "custom_qty"), [todayStr]),
      ]);

      function buildVelEntry(r: VelRow): VelRow {
        const categoryCode = forecastCategoryCodeForSku(r.master_sku);
        const wPrev   = Number(r.avg_daily_prev);
        const wReal   = Number(r.avg_daily_real);
        const ePrev   = Number(r.east_avg_prev);
        const eReal   = Number(r.east_avg_real);
        const fbaPrev = Number(r.fba_avg_prev ?? 0);
        const fbaReal = Number(r.fba_avg_real ?? 0);
        return {
          master_sku:     r.master_sku,
          west_90d:       Number(r.west_90d),
          west_60d:       Number(r.west_60d),
          west_30d:       Number(r.west_30d),
          west_15d:       Number(r.west_15d),
          west_7d:        Number(r.west_7d),
          west_30d_pre:   Number(r.west_30d_pre),
          east_90d:       Number(r.east_90d),
          east_60d:       Number(r.east_60d),
          east_30d:       Number(r.east_30d),
          east_15d:       Number(r.east_15d),
          east_7d:        Number(r.east_7d),
          east_30d_pre:   Number(r.east_30d_pre),
          avg_daily_prev: wPrev,
          avg_daily_real: wReal,
          east_avg_prev:  ePrev,
          east_avg_real:  eReal,
          fba_avg_real:   fbaReal,
          fba_avg_prev:   fbaPrev,
          fba_30d:        Number(r.fba_30d),
          _avg_curr:  currentDailyAverage(wPrev, wReal, categoryCode),
          _east_curr: currentDailyAverage(ePrev, eReal, categoryCode),
          _fba_curr:  fbaReal,
        } as VelRow & { _avg_curr: number; _east_curr: number; _fba_curr: number };
      }

      for (const r of linkVelResult.rows)   linkVelMap.set(r.master_sku, buildVelEntry(r));
      for (const r of customVelResult.rows) customVelMap.set(r.master_sku, buildVelEntry(r));
    }

    // â”€â”€ Assemble response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const containers: ContainerMeta[] = [
      { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" },
      ...containersResult.rows.map((r, i) => ({
        col:          i + 1,
        container_id: r.id,
        name:         r.name,
        eta:          r.eta,
        cbm_cap:      r.cbm_cap ?? 0,
        status:       r.status,
        categories:   categoriesByContainer.get(r.id) ?? [],
      })),
    ];

    // cross-data lookup: sku â†’ container_name â†’ ContainerRowData
    containers[0] = { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" };
    const orderedContainers = containers.slice(1).sort((a, b) => {
      const aTime = a.eta ? new Date(a.eta).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.eta ? new Date(b.eta).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name);
    });
    containers.splice(1, containers.length - 1, ...orderedContainers.map((container, i) => ({
      ...container,
      col: i + 1,
    })));

    const crossMap = new Map<string, Map<string, ContainerRowData>>();
    for (const r of crossResult.rows) {
      if (!crossMap.has(r.sku)) crossMap.set(r.sku, new Map());
      crossMap.get(r.sku)!.set(r.container_name, {
        item_id:     r.item_id,
        cbm_unit:    r.cbm_unit,
        inbound_qty: r.inbound_qty,
        allocated_remaining_qty: r.allocated_remaining_qty ?? 0,
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
      const masterSku    = r.sku as string;
      const rowSku       = masterSku;
      const { seat, no, color, tone } = parseSku(masterSku);
      const categoryCode = r.category_code === "SC" || r.category_code === "CC" || r.category_code === "FM" || r.category_code === "AC"
        ? r.category_code
        : inferCategoryCode(masterSku);

      const containerInfo = r.latest_container
        ? `${r.latest_eta ?? ""} - (${r.latest_container}) - ${r.latest_qty ?? ""}`
        : "";

      const skuCross = includeContainers
        ? crossMap.get(masterSku)
        : undefined;
      const containersObj: Record<string, ContainerRowData> = {};
      if (skuCross) {
        for (const [name, data] of skuCross) containersObj[name] = data;
      }

      // For historical dates, pick velocity from the correct snapshot source:
      // CC/FM use custom_snapshot; SC uses link_snapshot (mirrors statsSource logic).
      const velSourceMap = (categoryCode === "CC" || categoryCode === "FM") ? customVelMap : linkVelMap;
      const vel = velSourceMap.get(masterSku) as (VelRow & { _avg_curr: number; _east_curr: number; _fba_curr: number }) | undefined;
      const west_90d     = vel ? vel.west_90d     : r.west_90d as number;
      const west_60d     = vel ? vel.west_60d     : r.west_60d as number;
      const west_30d     = vel ? vel.west_30d     : r.west_30d as number;
      const west_15d     = vel ? vel.west_15d     : r.west_15d as number;
      const west_7d      = vel ? vel.west_7d      : r.west_7d  as number;
      const west_30d_pre = vel ? vel.west_30d_pre : r.west_30d_pre as number;
      const east_90d     = vel ? vel.east_90d     : r.east_90d as number;
      const east_60d     = vel ? vel.east_60d     : r.east_60d as number;
      const east_30d     = vel ? vel.east_30d     : r.east_30d as number;
      const east_15d     = vel ? vel.east_15d     : r.east_15d as number;
      const east_7d      = vel ? vel.east_7d      : r.east_7d  as number;
      const east_30d_pre = vel ? vel.east_30d_pre : r.east_30d_pre as number;
      const avg_daily_prev = Math.max(0.01, vel ? vel.avg_daily_prev : r.avg_daily_prev as number);
      const avg_daily_real = Math.max(0.01, vel ? vel.avg_daily_real : r.avg_daily_real as number);
      const avg_daily_curr = Math.max(0.01, vel ? vel._avg_curr      : r.avg_daily_curr as number);
      const east_avg_prev  = Math.max(0.01, vel ? vel.east_avg_prev  : r.east_avg_prev  as number);
      const east_avg_real  = Math.max(0.01, vel ? vel.east_avg_real  : r.east_avg_real  as number);
      const east_avg_curr  = Math.max(0.01, vel ? vel._east_curr     : currentDailyAverage(east_avg_prev, east_avg_real, categoryCode));
      const fba_avg_real   = Math.max(0.01, vel ? vel.fba_avg_real   : r.fba_avg_real   as number);
      const fba_avg_curr   = Math.max(0.01, vel ? vel._fba_curr      : r.fba_avg_curr   as number);
      const fba_30d        = vel ? vel.fba_30d        : r.fba_30d        as number;
      // Derived 30d/avg totals
      const west_fbm_30d = vel ? fbmThirtyDayAverage(west_90d, west_60d, west_30d, west_30d_pre, west_15d, west_7d) : r.west_fbm_30d as number;
      const east_fbm_30d = vel ? fbmThirtyDayAverage(east_90d, east_60d, east_30d, east_30d_pre, east_15d, east_7d) : r.east_fbm_30d as number;
      const total_30d    = vel ? west_fbm_30d + east_fbm_30d + fba_30d : r.total_30d as number;
      const total_avg_prev = Math.max(0.03, vel ? avg_daily_prev + east_avg_prev + (vel.fba_avg_prev ?? 0) : r.total_avg_prev as number);
      const total_avg_real = Math.max(0.03, vel ? avg_daily_real + east_avg_real + fba_avg_real : r.total_avg_real as number);
      const total_avg_curr = Math.max(0.03, vel ? avg_daily_curr + east_avg_curr + fba_avg_curr : currentDailyAverage(total_avg_prev, total_avg_real));

      // Baseline seed: today's state, no incoming units
      const availQty  = (r.total_stock as number) + (r.back as number);
      const carryover = availQty >= 0 ? availQty : 0;
      const dailyRate = total_avg_curr;
      const invLife   = inventoryLifeDays(carryover, dailyRate, seasonalFactorForEta(todayStr, DEFAULT_SEASONAL_FACTORS));
      const asOfMs    = new Date(todayStr).getTime();
      const sod       = (() => {
        const rate = total_avg_real;
        if (!rate) return null;
        const days = Math.floor((r.total_stock as number) / rate);
        const d = new Date(asOfMs);
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
      })();
      const planSod   = invLife !== null
        ? addSheetDays(todayStr, invLife)
        : null;

      if (!rawContainers) {
        containersObj["Base"] = {
          item_id:     null,
          cbm_unit:    null,
          inbound_qty: null,
          open_orders: 0,
          avail_qty:   availQty,
          est_sales:   0,
          backorder:   availQty < 0 ? Math.abs(availQty) : 0,
          carryover:   carryover,
          eta:         todayStr,
          inv_life:    invLife,
          est_sod:     sod,
          plan_sod:    planSod,
          cbm:         0,
        };
      }

      if (!rawContainers && !containersObj.Base) {
        const baselineData = Object.values(containersObj).find((value) => value.eta === todayStr && value.est_sales === 0 && value.cbm === 0);
        if (baselineData) containersObj.Base = baselineData;
      }

      // Chain: iterate real containers left-to-right, each block reads prior block's outputs
      let prevCarryover = carryover;
      let prevBackorder = availQty < 0 ? Math.abs(availQty) : 0;
      let prevSod       = sod;
      let prevEta       = todayStr;

      for (const c of rawContainers ? [] : containers.slice(1)) {
        const raw  = containersObj[c.name];
        if (!raw) continue;
        const qty  = raw?.inbound_qty ?? 0;
        const eta  = c.eta ?? todayStr;

        const openOrders = prevCarryover > 0 ? 0 : (prevBackorder > qty ? -qty : -prevBackorder);
        const availQtyC  = prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder;

        const daysBetween = Math.round(
          (new Date(eta).getTime() - new Date(prevEta).getTime()) / 86400000
        );
        const seasonalFactor = seasonalFactorForEta(eta, DEFAULT_SEASONAL_FACTORS);
        const estSales   = daysBetween * dailyRate * seasonalFactor;
        const backorderC = Math.max(0, estSales - availQtyC);
        const carryoverC = backorderC >= 1 ? 0 : Math.max(0, availQtyC - estSales);
        const invLifeC   = inventoryLifeDays(carryoverC, dailyRate, seasonalFactor);

        const sodFromThis = invLifeC !== null
          ? addSheetDays(eta, invLifeC)
          : null;
        const estSodC: string | null = (!qty || carryoverC === 0)
          ? prevSod
          : sodFromThis === null
            ? null
            : (prevSod && prevSod > sodFromThis ? prevSod : sodFromThis);
        const planSodC = sodFromThis;

        containersObj[c.name] = {
          ...(raw ?? { item_id: null, cbm_unit: null, inbound_qty: null, cbm: 0, eta }),
          open_orders: openOrders,
          avail_qty:   availQtyC,
          est_sales:   estSales,
          backorder:   backorderC,
          carryover:   carryoverC,
          inv_life:    invLifeC,
          est_sod:     estSodC,
          plan_sod:    planSodC,
        };

        prevCarryover = carryoverC;
        prevBackorder = backorderC;
        prevSod       = estSodC;
        prevEta       = eta;
      }

      return {
        container_info:    containerInfo,
        cbm:               (r.cbm_unit as number) ?? 0,
        cbm_per_unit:      (r.cbm_per_unit as number) ?? 0,
        case_qty:          (r.case_qty as number) ?? 1,
        moq:               (r.moq as number) ?? 1,
        order_multiple:    (r.order_multiple as number) ?? (r.moq as number) ?? 1,
        seat,
        no,
        color,
        tone,
        back:              r.back as number,
        sales_status:      (r.sales_status as "Original" | "Custom" | "Hold"),
        category_code:     categoryCode,
        sku:               rowSku,
        west_stock:             r.west_stock,
        east_stock:             r.east_stock,
        west_available_stock:   r.west_available_stock,
        east_available_stock:   r.east_available_stock,
        transit_stock:          r.transit_stock,
        total_stock:            r.total_stock,
        stock_mode:             (r.stock_mode as 'onhand' | 'available') ?? 'onhand',
        west_90d:          west_90d,
        west_60d:          west_60d,
        west_30d:          west_30d,
        west_15d:          west_15d,
        west_7d:           west_7d,
        west_30d_pre:      west_30d_pre,
        east_90d:          east_90d,
        east_60d:          east_60d,
        east_30d:          east_30d,
        east_15d:          east_15d,
        east_7d:           east_7d,
        east_30d_pre:      east_30d_pre,
        avg_daily_prev:    avg_daily_prev,
        avg_daily_real:    avg_daily_real,
        avg_daily_curr:    avg_daily_curr,
        east_avg_prev:     east_avg_prev,
        east_avg_real:     east_avg_real,
        east_avg_curr:     east_avg_curr,
        fba_avg_real:      fba_avg_real,
        fba_avg_curr:      fba_avg_curr,
        west_fbm_30d:      west_fbm_30d,
        east_fbm_30d:      east_fbm_30d,
        fba_30d:           fba_30d,
        total_30d:         total_30d,
        total_avg_prev:    total_avg_prev,
        total_avg_real:    total_avg_real,
        total_avg_curr:    total_avg_curr,
        total_inbound_qty: r.total_inbound_qty,
        containers_list:   r.containers_list ?? null,
        next_eta:          r.next_eta ?? null,
        remaining:         availStockMap.get(masterSku)?.remaining ?? 0,
        mistake:           availStockMap.get(masterSku)?.mistake   ?? 0,
        sod,
        containers:        includeContainers ? containersObj : {},
      };
    });

    // Build pinned reference rows from raw stored inputs
    function wAvg(d90: number, d60: number, d30: number, d15: number, d7: number, pre30: number): number {
      return (d90/90)*0.10 + (d60/60)*0.15 + (d30/30)*0.30 + (d15/15)*0.20 + (d7/7)*0.15 + (pre30/30)*0.10;
    }
    const pinned_rows: DemandRow[] = !PINNED_ROWS_ENABLED ? [] : pinnedRowsResult.rows.map((p) => {
      const { seat, no, color, tone } = parseSku(p.master_sku);
      const w90 = p.west_90d, w60 = p.west_60d, w30 = p.west_30d, w15 = p.west_15d, w7 = p.west_7d, wpre = p.west_30d_pre;
      const e90 = p.east_90d, e60 = p.east_60d, e30 = p.east_30d, e15 = p.east_15d, e7 = p.east_7d, epre = p.east_30d_pre;
      const avgReal  = Math.max(0.01, wAvg(w90, w60, w30, w15, w7, wpre));
      const avgPrev  = Math.max(0.01, p.avg_daily_prev);
      const avgCurr  = currentDailyAverage(avgPrev, avgReal);
      const eReal    = Math.max(0.01, wAvg(e90, e60, e30, e15, e7, epre));
      const ePrev    = Math.max(0.01, p.east_avg_prev);
      const eCurr    = currentDailyAverage(ePrev, eReal);
      const fbaReal  = Math.max(0.01, p.fba_30d / 30);
      const fbaCurr  = fbaReal;
      const wFbm30   = fbmThirtyDayAverage(w90, w60, w30, wpre, w15, w7);
      const eFbm30   = fbmThirtyDayAverage(e90, e60, e30, epre, e15, e7);
      const total30  = wFbm30 + eFbm30 + p.fba_30d;
      const tAvgPrev = Math.max(0.03, avgPrev + ePrev);
      const tAvgReal = Math.max(0.03, avgReal + eReal + fbaReal);
      const tAvgCurr = Math.max(0.03, avgCurr + eCurr + fbaCurr);
      const totalStk  = p.total_stock;
      const sodDays   = tAvgReal > 0 ? Math.floor(totalStk / tAvgReal) : null;
      const sodDate   = sodDays !== null ? (() => { const d = new Date(todayStr); d.setDate(d.getDate() + sodDays); return d.toISOString().slice(0, 10); })() : null;
      const availQtyP = totalStk + p.back;
      const carryoverP = Math.max(0, availQtyP);
      const sfP        = seasonalFactorForEta(todayStr, DEFAULT_SEASONAL_FACTORS);
      const invLifeP   = inventoryLifeDays(carryoverP, tAvgCurr, sfP);
      const planSodP   = invLifeP !== null ? addSheetDays(todayStr, invLifeP) : null;
      return {
        pinned:           true,
        sku:              p.master_sku,
        container_info:   "",
        cbm:              0,
        cbm_per_unit:     0,
        seat, no, color, tone,
        back:             p.back,
        sales_status:     "Original",
        category_code:    inferCategoryCode(p.master_sku),
        west_stock:       p.west_stock,
        east_stock:       p.east_stock,
        west_available_stock: 0,
        east_available_stock: 0,
        transit_stock:    0,
        total_stock:      totalStk,
        stock_mode:       "onhand",
        west_90d: w90, west_60d: w60, west_30d: w30, west_15d: w15, west_7d: w7, west_30d_pre: wpre,
        east_90d: e90, east_60d: e60, east_30d: e30, east_15d: e15, east_7d: e7, east_30d_pre: epre,
        avg_daily_prev:   avgPrev,
        avg_daily_real:   avgReal,
        avg_daily_curr:   avgCurr,
        east_avg_prev:    ePrev,
        east_avg_real:    eReal,
        east_avg_curr:    eCurr,
        fba_avg_real:     fbaReal,
        fba_avg_curr:     fbaCurr,
        west_fbm_30d:     wFbm30,
        east_fbm_30d:     eFbm30,
        fba_30d:          p.fba_30d,
        total_30d:        total30,
        total_avg_prev:   tAvgPrev,
        total_avg_real:   tAvgReal,
        total_avg_curr:   tAvgCurr,
        total_inbound_qty: null,
        containers_list:  null,
        next_eta:         null,
        remaining:        0,
        mistake:          0,
        sod:              sodDate,
        containers:       {
          Base: {
            item_id: null, cbm_unit: null, inbound_qty: null, cbm: 0,
            open_orders: 0,
            avail_qty:   availQtyP,
            est_sales:   0,
            backorder:   availQtyP < 0 ? Math.abs(availQtyP) : 0,
            carryover:   carryoverP,
            eta:         todayStr,
            inv_life:    invLifeP,
            est_sod:     sodDate,
            plan_sod:    planSodP,
          },
        },
      } satisfies DemandRow;
    });

    const response: { success: true; data: DemandPlanningData } = { success: true, data: { containers, rows, pinned_rows, last_sync: lastSync } };
    setPlanningDashboardCache(mode, response, includeContainers, isToday ? undefined : todayStr, includeDrafts, categoryCode ?? undefined, rawContainers);
    return NextResponse.json(response, {
      headers: { "x-planning-dashboard-cache": "MISS" },
    });
  } catch (error) {
    console.error("Planning dashboard GET failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
