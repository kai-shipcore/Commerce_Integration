/**
 * Pure data access for the Demand Planning domain: the dashboard read
 * pipeline (shipcore.fc_stats/fc_stats_custom joined with containers,
 * available stock, and velocity snapshots) and the stats-refresh write
 * pipeline (inventory sync, OOS episode tracking, sales velocity
 * recompute). Raw SQL only — no Prisma models for these tables.
 *
 * The dashboard route has no request-scoped mutations (read + Redis cache
 * only) and stats/refresh never wrapped its steps in a DB transaction
 * (each step is independently idempotent/re-runnable) — neither is changed
 * here, so no withTransaction helper exists in this domain.
 */

import type { Pool } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";

function primary(): Pool {
  return getPrimaryPool();
}

// ─── Dashboard read types ───────────────────────────────────────────────

export interface ContainerHeaderRow {
  id: number;
  name: string;
  eta: string;
  cbm_cap: number;
  status: string;
}

export interface ContainerCategoryRow {
  container_id: number;
  category_code: string;
}

export interface AvailStockRow {
  master_sku: string;
  source_type: string;
  total_qty: string;
}

export interface CrossRow {
  item_id: number;
  sku: string;
  container_name: string;
  inbound_qty: number;
  allocated_remaining_qty: number;
  avail_qty: number;
  cbm_unit: number;
  cbm: number;
  eta: string | null;
  open_orders: null;
  est_sales: null;
  backorder: null;
  inv_life: null;
  est_sod: null;
  plan_sod: null;
}

export type VelRow = {
  master_sku: string;
  west_90d: number; west_60d: number; west_30d: number;
  west_15d: number; west_7d: number; west_30d_pre: number;
  east_90d: number; east_60d: number; east_30d: number;
  east_15d: number; east_7d: number; east_30d_pre: number;
  avg_daily_real: number; avg_daily_prev: number;
  east_avg_real: number; east_avg_prev: number;
  fba_avg_real: number; fba_avg_prev: number; fba_30d: number;
};

export interface DashboardFilters {
  mode: "link" | "custom";
  categoryCode: "SC" | "CC" | "FM" | "AC" | null;
  inboundStatuses: string;
}

// Mirrors the home-stats pattern: rows count if fc_products matches OR
// (no fc_products row AND SKU pattern matches) — keeps the planning grid's
// per-category counts aligned with the home dashboard's.
function productCategoryWhere(categoryCode: DashboardFilters["categoryCode"]): string {
  if (!categoryCode) return "";
  if (categoryCode === "SC") return `WHERE (UPPER(p.category_code) = 'SC' OR (p.category_code IS NULL AND (UPPER(s.master_sku) LIKE 'CA-SC-%' OR UPPER(s.master_sku) LIKE 'CL-SC-%')))`;
  if (categoryCode === "CC") return `WHERE (UPPER(p.category_code) = 'CC' OR (p.category_code IS NULL AND UPPER(s.master_sku) LIKE 'CC-%'))`;
  if (categoryCode === "FM") return `WHERE (UPPER(p.category_code) = 'FM' OR (p.category_code IS NULL AND (UPPER(s.master_sku) LIKE 'CA-FM-%' OR 'FM' = ANY(string_to_array(UPPER(s.master_sku), '-')))))`;
  return "WHERE p.category_code = $1";
}

function statsSourceSql(mode: "link" | "custom", categoryCode: DashboardFilters["categoryCode"]): string {
  if (mode === "custom") return "shipcore.fc_stats_custom";
  if (categoryCode === "CC" || categoryCode === "FM") return "shipcore.fc_stats_custom";
  if (categoryCode === "SC") return "shipcore.fc_stats";
  return `(
      SELECT s.* FROM shipcore.fc_stats_custom s
      WHERE EXISTS (
        SELECT 1 FROM shipcore.fc_products p
        WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
      )
      UNION ALL
      SELECT s.* FROM shipcore.fc_stats s
      WHERE NOT EXISTS (
        SELECT 1 FROM shipcore.fc_products p
        WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
      )
    )`;
}

export const DemandPlanningRepository = {
  // ─── Dashboard reads ──────────────────────────────────────────────

  async getContainerHeaders(categoryCode: DashboardFilters["categoryCode"]): Promise<ContainerHeaderRow[]> {
    const categoryParams = categoryCode ? [categoryCode] : [];
    const result = await primary().query<{ id: number; name: string; eta: string; cbm_cap: number; status: string }>(`
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
    `, categoryParams);
    return result.rows;
  },

  async getStatsRows(filters: DashboardFilters): Promise<Record<string, unknown>[]> {
    const categoryCode = filters.categoryCode;
    const categoryParams = categoryCode ? [categoryCode] : [];
    const categoryWhere = categoryCode ? "AND p.category_code = $1" : "";
    const statsSource = statsSourceSql(filters.mode, categoryCode);

    const result = await primary().query(`
      SELECT
        s.master_sku                                          AS sku,
      COALESCE(agg.total_inbound_qty, 0)::int              AS total_inbound_qty,
      agg.containers_list,
      agg.next_eta,
      agg.cbm_unit,
      agg.latest_container,
      agg.latest_eta,
      agg.latest_qty,
      COALESCE(p.sales_status, s.sales_status, 'Original')  AS sales_status,
      p.category_code                                      AS category_code,
      COALESCE(p.cbm_per_unit, 0)::float8                  AS cbm_per_unit,
      p.memo                                               AS memo,
      COALESCE(p.case_qty, 1)::int                          AS case_qty,
      COALESCE(p.moq, 1)::int                              AS moq,
      COALESCE(p.order_multiple, p.moq, 1)::int            AS order_multiple,
      COALESCE(s.back,                   0)::int            AS back,
      COALESCE(s.west_stock,             0)::int            AS west_stock,
      COALESCE(s.east_stock,             0)::int            AS east_stock,
      COALESCE(s.west_available_stock,   0)::int            AS west_available_stock,
      COALESCE(s.east_available_stock,   0)::int            AS east_available_stock,
      COALESCE(s.transit_stock,          0)::int            AS transit_stock,
      COALESCE(s.fullerton_stock,           0)::int            AS fullerton_stock,
      COALESCE(s.canary_stock,             0)::int            AS canary_stock,
      COALESCE(s.ttm_stock,                0)::int            AS ttm_stock,
      COALESCE(s.ttm_jeff_stock,           0)::int            AS ttm_jeff_stock,
      COALESCE(s.fullerton_available_stock, 0)::int           AS fullerton_available_stock,
      COALESCE(s.canary_available_stock,    0)::int           AS canary_available_stock,
      COALESCE(s.ttm_available_stock,       0)::int           AS ttm_available_stock,
      COALESCE(s.ttm_jeff_available_stock,  0)::int           AS ttm_jeff_available_stock,
      (COALESCE(s.west_available_stock, 0) + COALESCE(s.east_available_stock, 0) + COALESCE(s.transit_stock, 0))::int AS total_stock,
      'available'                                           AS stock_mode,
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
      COALESCE(s.fba_avg_prev,   0)::float8                AS fba_avg_prev,
      COALESCE(s.fba_avg_real,   0)::float8                AS fba_avg_real,
      COALESCE(s.fba_avg_curr,   0)::float8                AS fba_avg_curr,
      COALESCE(s.west_fbm_30d,   0)::int                   AS west_fbm_30d,
      COALESCE(s.east_fbm_30d,   0)::int                   AS east_fbm_30d,
      COALESCE(s.fba_30d,        0)::int                   AS fba_30d,
      COALESCE(s.total_30d,      0)::int                   AS total_30d,
      COALESCE(s.total_avg_prev, 0)::float8                AS total_avg_prev,
      COALESCE(s.total_avg_real, 0)::float8                AS total_avg_real,
      COALESCE(s.total_avg_curr, 0)::float8                AS total_avg_curr,
      COALESCE(s.oos_days_90d,   0)::int                   AS oos_days_90d,
      s.oos_lost_demand_90d::float8                        AS oos_lost_demand_90d
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
      WHERE c.status IN ${filters.inboundStatuses}
        ${categoryWhere}
      GROUP BY ci.master_sku
    ) agg ON agg.master_sku = s.master_sku
    ${productCategoryWhere(categoryCode)}
    ORDER BY s.master_sku
  `, categoryParams);
    return result.rows;
  },

  async getAvailableStockTotals(categoryCode: DashboardFilters["categoryCode"]): Promise<AvailStockRow[]> {
    const categoryParams = categoryCode ? [categoryCode] : [];
    const result = await primary().query<AvailStockRow>(`
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
      ${categoryCode ? "WHERE p.category_code = $1" : ""}
      GROUP BY s.master_sku, s.source_type
    `, categoryParams);
    return result.rows;
  },

  async getLastSync(): Promise<string | null> {
    const result = await primary().query<{ last_sync: string | null }>(
      `SELECT to_char(MAX(calculated_at) AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') AS last_sync FROM shipcore.fc_stats`,
    );
    return result.rows[0]?.last_sync ?? null;
  },

  async getContainerCategories(containerIds: number[]): Promise<ContainerCategoryRow[]> {
    if (containerIds.length === 0) return [];
    const result = await primary().query<ContainerCategoryRow>(`
      SELECT ci.container_id::int, p.category_code
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
      WHERE ci.container_id = ANY($1::int[])
        AND ci.qty > 0
        AND p.category_code IS NOT NULL
      GROUP BY ci.container_id, p.category_code
    `, [containerIds]);
    return result.rows;
  },

  async getCrossData(filters: DashboardFilters & { rawContainers: boolean }): Promise<CrossRow[]> {
    const categoryCode = filters.categoryCode;
    const categoryParams = categoryCode ? [categoryCode] : [];
    const categoryJoinWhere = categoryCode ? "AND p.category_code = $1" : "";
    const result = await primary().query<CrossRow>(`
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
      WHERE ${filters.rawContainers ? `c.status != 'complete'` : `c.status IN ${filters.inboundStatuses}`}
        ${categoryJoinWhere}
    `, categoryParams);
    return result.rows;
  },

  async getVelocitySnapshot(source: "link" | "custom", asOfDate: string): Promise<VelRow[]> {
    const table = source === "link" ? "shipcore.fc_velocity_link_snapshot" : "shipcore.fc_velocity_custom_snapshot";
    const skuCol = source === "link" ? "link_master_sku" : "custom_master_sku";
    const qtyCol = source === "link" ? "link_qty" : "custom_qty";
    const result = await primary().query<VelRow>(`
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
        GREATEST(0.01, SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-89 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-59 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-14 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-6 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15+SUM(CASE WHEN channel='Amazon FBA' AND order_type='preorder' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10)::float8 AS fba_avg_real,
        GREATEST(0.01, SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-96 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/90*0.10+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-66 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/60*0.15+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.30+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-21 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/15*0.20+SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-13 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/7*0.15+SUM(CASE WHEN channel='Amazon FBA' AND order_type='preorder' AND order_date>=$1::date-36 AND order_date<=$1::date-7 THEN ${qtyCol} ELSE 0 END)::numeric/30*0.10)::float8 AS fba_avg_prev,
        SUM(CASE WHEN channel='Amazon FBA' AND order_date>=$1::date-29 AND order_date<=$1::date THEN ${qtyCol} ELSE 0 END)::int AS fba_30d
      FROM ${table}
      WHERE ${skuCol} IS NOT NULL AND order_date >= $1::date - 96
      GROUP BY ${skuCol}
    `, [asOfDate]);
    return result.rows;
  },

  // ─── Stats refresh: Step 1 (inventory) ─────────────────────────────

  async getInventoryByWarehouse() {
    const lookup = getLookupPool();
    if (!lookup) return null;
    const result = await lookup.query(`
      WITH normalized_inventory AS (
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          warehouse,
          on_hand,
          available,
          backorder
        FROM ecommerce_data.coverland_inventory_by_warehouse
        WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
      )
      SELECT
        master_sku,
        SUM(CASE WHEN warehouse IN ('Fullerton','Canary')                 THEN COALESCE(on_hand,   0) ELSE 0 END)::int  AS west_stock,
        SUM(CASE WHEN warehouse IN ('TTM Group','TTM Group Jefferson')    THEN COALESCE(on_hand,   0) ELSE 0 END)::int  AS east_stock,
        SUM(COALESCE(on_hand,   0))::int                                                                                AS total_stock,
        -SUM(COALESCE(backorder, 0))::int                                                                               AS back,
        SUM(CASE WHEN warehouse IN ('Fullerton','Canary')                 THEN COALESCE(available, 0) ELSE 0 END)::int  AS west_available_stock,
        SUM(CASE WHEN warehouse IN ('TTM Group','TTM Group Jefferson')    THEN COALESCE(available, 0) ELSE 0 END)::int  AS east_available_stock,
        SUM(CASE WHEN warehouse = 'Fullerton'           THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS fullerton_stock,
        SUM(CASE WHEN warehouse = 'Canary'              THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS canary_stock,
        SUM(CASE WHEN warehouse = 'TTM Group'           THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS ttm_stock,
        SUM(CASE WHEN warehouse = 'TTM Group Jefferson' THEN COALESCE(on_hand,   0) ELSE 0 END)::int                   AS ttm_jeff_stock,
        SUM(CASE WHEN warehouse = 'Fullerton'           THEN COALESCE(available, 0) ELSE 0 END)::int                   AS fullerton_available_stock,
        SUM(CASE WHEN warehouse = 'Canary'              THEN COALESCE(available, 0) ELSE 0 END)::int                   AS canary_available_stock,
        SUM(CASE WHEN warehouse = 'TTM Group'           THEN COALESCE(available, 0) ELSE 0 END)::int                   AS ttm_available_stock,
        SUM(CASE WHEN warehouse = 'TTM Group Jefferson' THEN COALESCE(available, 0) ELSE 0 END)::int                   AS ttm_jeff_available_stock
      FROM normalized_inventory
      GROUP BY master_sku
    `);
    return result.rows as Record<string, unknown>[];
  },

  // ─── Stats refresh: Step 1b (OOS episodes) ─────────────────────────

  async getOosEpisodes() {
    const lookup = getLookupPool();
    if (!lookup) return [];
    // No trailing-window filter on snapshot_date: fc_inventory_history_snapshot
    // is upsert-only (never deleted from, unlike the velocity snapshots), so
    // an episode that never falls inside a "Sync" click's window is lost
    // forever — it can never be backfilled once older data ages out of a
    // fixed cutoff. Scanning full history (~380 days, ~550k base rows as of
    // writing) only costs ~1s more than a 120-day window, so there's no
    // performance reason to risk that permanent gap.
    const result = await lookup.query<{ master_sku: string; oos_started_on: string; back_in_stock_on: string | null }>(`
      WITH daily AS (
        SELECT
          BTRIM(master_sku) AS master_sku,
          snapshot_date,
          CASE WHEN COALESCE(available, 0) > 0 THEN 'IN STOCK' ELSE 'OUT OF STOCK' END AS status
        FROM ecommerce_data.vw_coverland_inventory_history
        WHERE master_sku IS NOT NULL AND BTRIM(master_sku) <> ''
      ),
      tagged AS (
        SELECT master_sku, snapshot_date, status,
               LAG(status) OVER (PARTITION BY master_sku ORDER BY snapshot_date) AS prev_status
        FROM daily
      ),
      transitions AS (
        SELECT * FROM tagged WHERE prev_status IS DISTINCT FROM status
      ),
      episodes AS (
        SELECT master_sku, snapshot_date AS oos_started_on, status,
               LEAD(snapshot_date) OVER (PARTITION BY master_sku ORDER BY snapshot_date) AS back_in_stock_on
        FROM transitions
      )
      SELECT master_sku, oos_started_on, back_in_stock_on
      FROM episodes
      WHERE status = 'OUT OF STOCK'
    `);
    return result.rows;
  },

  async getOosAgg(): Promise<{ master_sku: string; oos_days_90d: number }[]> {
    const result = await primary().query<{ master_sku: string; oos_days_90d: number }>(`
      SELECT master_sku,
             SUM(
               GREATEST(0,
                 LEAST(COALESCE(back_in_stock_on, CURRENT_DATE), CURRENT_DATE)
                 - GREATEST(oos_started_on, CURRENT_DATE - 89)
               )
             )::int AS oos_days_90d
      FROM shipcore.fc_inventory_history_snapshot
      GROUP BY master_sku
    `);
    return result.rows;
  },

  // ─── Stats refresh: Step 5 (OOS lost demand) ───────────────────────

  async getCategoryChannelRatio(source: "link" | "custom") {
    const [qtyCol, skuCol, table] = source === "link"
      ? ["link_qty", "link_master_sku", "shipcore.fc_velocity_link_snapshot"]
      : ["custom_qty", "custom_master_sku", "shipcore.fc_velocity_custom_snapshot"];
    const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;
    const AMAZON_CHANNELS = `'Amazon FBA','Amazon FBM'`;
    const EBAY_CHANNELS = `'Auto_Armor','Advance_Parts'`;
    const result = await primary().query<{ category_code: string; shopify_90d: number; amazon_90d: number; ebay_90d: number; walmart_90d: number }>(`
      SELECT
        COALESCE(p.category_code, 'SC') AS category_code,
        SUM(CASE WHEN v.channel IN (${SHOPIFY_CHANNELS}) AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.${qtyCol} ELSE 0 END)::numeric AS shopify_90d,
        SUM(CASE WHEN v.channel IN (${AMAZON_CHANNELS})  AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.${qtyCol} ELSE 0 END)::numeric AS amazon_90d,
        SUM(CASE WHEN v.channel IN (${EBAY_CHANNELS})    AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.${qtyCol} ELSE 0 END)::numeric AS ebay_90d,
        SUM(CASE WHEN v.channel = 'Walmart'              AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.${qtyCol} ELSE 0 END)::numeric AS walmart_90d
      FROM ${table} v
      LEFT JOIN shipcore.fc_products p ON p.master_sku = v.${skuCol}
      GROUP BY COALESCE(p.category_code, 'SC')
    `);
    return result.rows;
  },

  async getOosLostDemandRaw(source: "link" | "custom") {
    const [qtyCol, skuCol, table] = source === "link"
      ? ["link_qty", "link_master_sku", "shipcore.fc_velocity_link_snapshot"]
      : ["custom_qty", "custom_master_sku", "shipcore.fc_velocity_custom_snapshot"];
    const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;
    const AMAZON_CHANNELS = `'Amazon FBA','Amazon FBM'`;
    const EBAY_CHANNELS = `'Auto_Armor','Advance_Parts'`;
    const result = await primary().query<{
      master_sku: string; category_code: string; clipped_days: number;
      shopify_qty: number; amazon_qty: number; ebay_qty: number; walmart_qty: number;
    }>(`
      WITH episode_clip AS (
        SELECT id AS episode_id, master_sku,
          GREATEST(oos_started_on, CURRENT_DATE - 89) AS clip_start,
          LEAST(COALESCE(back_in_stock_on, CURRENT_DATE), CURRENT_DATE) AS clip_end
        FROM shipcore.fc_inventory_history_snapshot
      ),
      episode_days AS (
        SELECT *, GREATEST(0, clip_end - clip_start) AS clipped_days
        FROM episode_clip
      )
      SELECT
        ed.master_sku,
        COALESCE(p.category_code, 'SC') AS category_code,
        ed.clipped_days::int AS clipped_days,
        COALESCE(SUM(v.${qtyCol}) FILTER (
          WHERE v.channel IN (${SHOPIFY_CHANNELS}) AND v.order_type = 'preorder'
        ), 0)::numeric AS shopify_qty,
        COALESCE(SUM(v.${qtyCol}) FILTER (
          WHERE v.channel IN (${AMAZON_CHANNELS})
        ), 0)::numeric AS amazon_qty,
        COALESCE(SUM(v.${qtyCol}) FILTER (
          WHERE v.channel IN (${EBAY_CHANNELS})
        ), 0)::numeric AS ebay_qty,
        COALESCE(SUM(v.${qtyCol}) FILTER (
          WHERE v.channel = 'Walmart'
        ), 0)::numeric AS walmart_qty
      FROM episode_days ed
      LEFT JOIN shipcore.fc_products p ON p.master_sku = ed.master_sku
      LEFT JOIN ${table} v
        ON v.${skuCol} = ed.master_sku
       AND v.order_date BETWEEN ed.clip_start AND ed.clip_end
      GROUP BY
        ed.episode_id,
        ed.master_sku,
        ed.clip_start,
        ed.clip_end,
        ed.clipped_days,
        COALESCE(p.category_code, 'SC')
    `);
    return result.rows;
  },

  // ─── Stats refresh: Step 2 (sales velocity) ────────────────────────

  async zeroVelocityColumns(): Promise<void> {
    const zeroVelocity = `
      west_90d = 0, west_60d = 0, west_30d = 0, west_15d = 0, west_7d = 0, west_30d_pre = 0,
      east_90d = 0, east_60d = 0, east_30d = 0, east_15d = 0, east_7d = 0, east_30d_pre = 0,
      avg_daily_real = 0, avg_daily_prev = 0, avg_daily_curr = 0,
      east_avg_real  = 0, east_avg_prev  = 0, east_avg_curr  = 0,
      total_avg_prev = 0, total_avg_real = 0, total_avg_curr = 0,
      west_fbm_30d   = 0, east_fbm_30d   = 0, total_30d = 0,
      fba_avg_prev   = 0, fba_avg_real   = 0, fba_avg_curr   = 0, fba_30d = 0,
      updated_at = NOW()`;
    await Promise.all([
      primary().query(`UPDATE shipcore.fc_stats        SET ${zeroVelocity}`),
      primary().query(`UPDATE shipcore.fc_stats_custom SET ${zeroVelocity}`),
    ]);
  },

  async getSalesVelocity(source: "link" | "custom", planningDate: string) {
    const table = source === "link" ? "shipcore.fc_velocity_link_snapshot" : "shipcore.fc_velocity_custom_snapshot";
    const alias = source === "link" ? "vls" : "vcs";
    const skuCol = source === "link" ? "link_master_sku" : "custom_master_sku";
    const qtyCol = source === "link" ? "link_qty" : "custom_qty";
    const result = await primary().query(`
      SELECT
        ${alias}.${skuCol} AS master_sku,
        CASE WHEN MAX(${alias}.is_custom) = 'Y' THEN 'Custom' ELSE 'Original' END AS sales_status,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_90d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_60d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_30d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_15d,
        SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_7d,
        SUM(CASE WHEN order_type = 'preorder' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS west_30d_pre,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS east_90d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS east_60d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS east_30d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS east_15d,
        SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric AS east_7d,
        0::numeric AS east_30d_pre,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_real,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 98 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 68 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 23 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' AND order_date >= $1::date - 15 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder'                           AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS avg_daily_prev,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_real,
        GREATEST(0.01, (
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 98 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 68 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 23 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN order_type = 'ttm'      AND order_date >= $1::date - 15 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN order_type = 'preorder' AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS east_avg_prev,
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_real,
        GREATEST(0.01, (
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 98 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 90 * 0.10 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 68 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 60 * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.30 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 23 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 15 * 0.20 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 15 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 7  * 0.15 +
          SUM(CASE WHEN channel = 'Amazon FBA' AND order_type = 'preorder' AND order_date >= $1::date - 38 AND order_date <= $1::date - 9 THEN ${qtyCol} ELSE 0 END)::numeric / 30 * 0.10
        )) AS fba_avg_prev,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 91 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::int AS fba_90d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 61 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::int AS fba_60d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 31 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::int AS fba_30d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 16 AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::int AS fba_15d,
        SUM(CASE WHEN channel = 'Amazon FBA' AND order_date >= $1::date - 8  AND order_date <= $1::date - 2 THEN ${qtyCol} ELSE 0 END)::int AS fba_7d
      FROM ${table} ${alias}
      WHERE ${alias}.${skuCol} IS NOT NULL
        AND ${alias}.order_date >= $1::date - 98
      GROUP BY ${alias}.${skuCol}
    `, [planningDate]);
    return result.rows as Record<string, unknown>[];
  },

  // ─── Stats refresh: Step 3 (sync SWC products) ─────────────────────

  async upsertSwcProducts(): Promise<void> {
    await primary().query(`
      INSERT INTO shipcore.fc_products
        (master_sku, product_name, category, category_code, status, sales_status,
         moq, order_multiple, cbm_per_unit, case_qty, weight_kg, created_at, updated_at)
      SELECT DISTINCT
        link_master_sku,
        link_master_sku,
        'SWC',
        'SWC',
        'active'::shipcore.fc_product_status,
        'SWC',
        1, 1, 0.078, 1, 2.8,
        NOW(), NOW()
      FROM shipcore.fc_velocity_link_snapshot
      WHERE link_master_sku ILIKE '%SWC%'
        AND link_master_sku IS NOT NULL
      ON CONFLICT (master_sku) DO UPDATE SET
        category_code = 'SWC',
        sales_status  = 'SWC',
        updated_at = NOW()
    `);
  },

  // ─── Shared batch upsert helper ─────────────────────────────────────

  async batchUpsert(
    table: "shipcore.fc_stats" | "shipcore.fc_stats_custom" | "shipcore.fc_inventory_history_snapshot",
    rows: Record<string, unknown>[],
    columns: string[],
    updateSet: string,
    conflictCols: string[] = ["master_sku"],
    batchSize = 500,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = batch
        .map((_, j) => {
          const base = j * columns.length;
          return `(${columns.map((_, k) => `$${base + k + 1}`).join(", ")})`;
        })
        .join(", ");
      const params = batch.flatMap((r) => columns.map((c) => r[c]));
      await primary().query(
        `INSERT INTO ${table} (${columns.join(", ")})
         VALUES ${values}
         ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${updateSet}`,
        params,
      );
    }
  },
};
