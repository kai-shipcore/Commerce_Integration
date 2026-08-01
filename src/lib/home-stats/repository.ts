/**
 * Data access for the home dashboard "Command Center" stats widget.
 * Aggregate-only queries against shipcore.fc_stats/fc_stats_custom,
 * fc_containers/fc_container_items, and sc_sales_orders/sc_sales_order_items
 * — never loads full SKU rows.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";

// Shared category-classification CASE expression used in both queries
const CAT_CASE = `
  CASE
    WHEN UPPER(p.category_code) = 'CC' THEN 'cc'
    WHEN UPPER(p.category_code) = 'SWC' THEN 'cc'
    WHEN UPPER(p.category_code) = 'SC' THEN 'sc'
    WHEN UPPER(p.category_code) = 'FM' THEN 'fm'
    WHEN UPPER(s.master_sku) LIKE 'CC-%' THEN 'cc'
    WHEN UPPER(s.master_sku) LIKE 'CA-FM-%'
      OR 'FM' = ANY(string_to_array(UPPER(s.master_sku), '-')) THEN 'fm'
    WHEN UPPER(s.master_sku) LIKE 'CA-SC-%'
      OR UPPER(s.master_sku) LIKE 'CL-SC-%' THEN 'sc'
    ELSE 'ac'
  END
`;

// Shared stats_source CTE (fc_stats_custom takes precedence for CC/FM SKUs)
const STATS_SOURCE_CTE = `
  stats_source AS (
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
  )
`;

// Shared categorized CTE: adds cat, sod_days, has_inbound to each row
const CATEGORIZED_CTE = `
  categorized AS (
    SELECT
      s.master_sku,
      s.total_stock,
      s.total_avg_curr,
      s.back,
      ${CAT_CASE} AS cat,
      CASE
        WHEN s.back < 0 THEN -1
        WHEN s.total_avg_curr > 0 THEN FLOOR(s.total_stock::float / s.total_avg_curr)::int
        ELSE 9999
      END AS sod_days,
      EXISTS (
        SELECT 1 FROM shipcore.fc_container_items ci
        JOIN shipcore.fc_containers con ON con.id = ci.container_id
        WHERE ci.master_sku = s.master_sku
          AND con.status NOT IN ('complete')
          AND con.eta_date >= CURRENT_DATE
      ) AS has_inbound
    FROM stats_source s
    LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
  )
`;

export interface CatDetailRow {
  cat: string;
  critical_sku: string; expected_oos: string; overstock_sku: string; urgent_po: string;
  d0_30: string; d30_60: string; d60_180: string; d180plus: string; backorder: string;
}

export interface CatTopRow {
  cat: string; sku: string; total_stock: string; total_avg_curr: string;
  sod_days: string; back: string; next_eta: string | null;
}

export interface ContainerRow {
  name: string; eta: string | null; confirmed_date: string | null; confirmed_time: string | null;
  total_qty: string; status: string; cbm_capacity: string | null; used_cbm: string; sku_count: string;
}

export interface DelayedConRow {
  name: string; eta: string | null; delay_days: string; status: string;
}

export interface SalesRow {
  qty: string;
  revenue?: string;
}

export const HomeStatsRepository = {
  async getCatDetail(): Promise<CatDetailRow[]> {
    const result = await getPrimaryPool().query<CatDetailRow>(`
      WITH ${STATS_SOURCE_CTE},
      ${CATEGORIZED_CTE}
      SELECT
        cat,
        COUNT(*) FILTER (WHERE sod_days <= 30)::text                          AS critical_sku,
        COUNT(*) FILTER (WHERE sod_days BETWEEN 31 AND 60)::text              AS expected_oos,
        COUNT(*) FILTER (WHERE sod_days > 180 AND sod_days < 9999)::text      AS overstock_sku,
        COUNT(*) FILTER (WHERE sod_days <= 30 AND NOT has_inbound)::text       AS urgent_po,
        COUNT(*) FILTER (WHERE sod_days <= 30)::text                          AS d0_30,
        COUNT(*) FILTER (WHERE sod_days BETWEEN 31 AND 60)::text              AS d30_60,
        COUNT(*) FILTER (WHERE sod_days BETWEEN 61 AND 180)::text             AS d60_180,
        COUNT(*) FILTER (WHERE sod_days > 180 AND sod_days < 9999)::text      AS d180plus,
        COALESCE(SUM(CASE WHEN back < 0 THEN ABS(back) ELSE 0 END), 0)::text AS backorder
      FROM categorized
      WHERE cat IN ('fm', 'cc', 'sc')
      GROUP BY cat
    `);
    return result.rows;
  },

  async getLastSync(): Promise<string | null> {
    const result = await getPrimaryPool().query<{ last_sync: string | null }>(
      `SELECT MAX(calculated_at)::text AS last_sync FROM shipcore.fc_stats`,
    );
    return result.rows[0]?.last_sync ?? null;
  },

  async getInboundContainers(): Promise<ContainerRow[]> {
    const result = await getPrimaryPool().query<ContainerRow>(`
      SELECT
        c.container_number                                    AS name,
        c.eta_date::text                                      AS eta,
        c.confirmed_date::text                                AS confirmed_date,
        c.confirmed_time::text                                AS confirmed_time,
        c.status,
        COALESCE(c.cbm_capacity, 0)::text                    AS cbm_capacity,
        COALESCE(SUM(ci.qty), 0)::text                       AS total_qty,
        COALESCE(SUM(ci.cbm_unit * ci.qty), 0)::text         AS used_cbm,
        COUNT(DISTINCT ci.master_sku)::text                  AS sku_count
      FROM shipcore.fc_containers c
      LEFT JOIN shipcore.fc_container_items ci ON ci.container_id = c.id
      WHERE c.status NOT IN ('complete')
        AND (c.eta_date IS NULL OR c.eta_date >= CURRENT_DATE - INTERVAL '14 days')
      GROUP BY c.id, c.container_number, c.eta_date, c.confirmed_date, c.confirmed_time, c.status, c.cbm_capacity
      ORDER BY c.eta_date ASC NULLS LAST
      LIMIT 10
    `);
    return result.rows;
  },

  async getSalesSince(since: Date): Promise<SalesRow> {
    const result = await getPrimaryPool().query<Required<SalesRow>>(
      `SELECT
         COALESCE(SUM(i.quantity), 0)::text   AS qty,
         COALESCE(SUM(i.line_total), 0)::text AS revenue
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND i.is_counted_in_demand = true`,
      [since],
    );
    return result.rows[0];
  },

  async getSalesQtyBetween(start: Date, end: Date): Promise<SalesRow> {
    const result = await getPrimaryPool().query<SalesRow>(
      `SELECT COALESCE(SUM(i.quantity), 0)::text AS qty
       FROM shipcore.sc_sales_order_items i
       JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
       WHERE o.order_date >= $1 AND o.order_date < $2
         AND i.is_counted_in_demand = true`,
      [start, end],
    );
    return result.rows[0];
  },

  async getCatTopCritical(): Promise<CatTopRow[]> {
    const result = await getPrimaryPool().query<CatTopRow>(`
      WITH ${STATS_SOURCE_CTE},
      ${CATEGORIZED_CTE},
      with_effective_sod AS (
        SELECT
          c.*,
          CASE
            WHEN c.total_avg_curr > 0 THEN
              FLOOR((
                c.total_stock::float
                + COALESCE((
                    SELECT SUM(ci.qty)
                    FROM shipcore.fc_container_items ci
                    JOIN shipcore.fc_containers con ON con.id = ci.container_id
                    WHERE ci.master_sku = c.master_sku
                      AND con.status NOT IN ('complete')
                      AND con.eta_date IS NOT NULL
                      AND con.eta_date >= CURRENT_DATE
                  ), 0)
              ) / c.total_avg_curr)::int
            ELSE 9999
          END AS effective_sod_days
        FROM categorized c
      ),
      critical_only AS (
        SELECT w.*
        FROM with_effective_sod w
        JOIN stats_source ss ON ss.master_sku = w.master_sku
        WHERE w.cat IN ('fm', 'cc', 'sc')
          AND w.effective_sod_days <= 30
          AND w.total_avg_curr > 0
          AND (
            COALESCE(ss.west_90d, 0) > 0 OR COALESCE(ss.west_60d, 0) > 0 OR
            COALESCE(ss.west_30d, 0) > 0 OR COALESCE(ss.west_15d, 0) > 0 OR COALESCE(ss.west_7d, 0) > 0 OR
            COALESCE(ss.east_90d, 0) > 0 OR COALESCE(ss.east_60d, 0) > 0 OR
            COALESCE(ss.east_30d, 0) > 0 OR COALESCE(ss.east_15d, 0) > 0 OR COALESCE(ss.east_7d, 0) > 0
          )
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY cat ORDER BY total_avg_curr DESC, master_sku ASC) AS rn
        FROM critical_only
      )
      SELECT
        r.cat,
        r.master_sku                                AS sku,
        r.total_stock::text,
        ROUND(r.total_avg_curr::numeric, 1)::text  AS total_avg_curr,
        r.effective_sod_days::text                 AS sod_days,
        r.back::text,
        (
          SELECT MIN(c.eta_date)::text
          FROM shipcore.fc_container_items ci
          JOIN shipcore.fc_containers c ON c.id = ci.container_id
          WHERE ci.master_sku = r.master_sku
            AND c.status NOT IN ('complete')
            AND c.eta_date >= CURRENT_DATE
        ) AS next_eta
      FROM ranked r
      WHERE r.rn <= 10
      ORDER BY r.cat, r.total_avg_curr DESC
    `);
    return result.rows;
  },

  async getDelayedContainers(): Promise<DelayedConRow[]> {
    const result = await getPrimaryPool().query<DelayedConRow>(`
      SELECT
        c.container_number              AS name,
        c.eta_date::text                AS eta,
        (CURRENT_DATE - c.eta_date)::text AS delay_days,
        c.status
      FROM shipcore.fc_containers c
      WHERE c.status NOT IN ('complete')
        AND c.eta_date IS NOT NULL
        AND c.eta_date < CURRENT_DATE
      ORDER BY c.eta_date ASC
      LIMIT 10
    `);
    return result.rows;
  },
};
