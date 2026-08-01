/**
 * Data access for the OOS Impact screens (top sellers, cross-channel
 * recovery, recovery drilldown, Pre-Order demand drop). All queries read
 * from shipcore.fc_velocity_link_snapshot / fc_velocity_custom_snapshot
 * (picking exactly one source per SKU by category — see inline comments)
 * and shipcore.fc_inventory_history_snapshot for OOS episode detection.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";

const WINDOW_DAYS = 30;
const TOP_SELLERS_LIMIT = 100;

const NON_SHOPIFY_CHANNELS = `'Amazon FBA','Amazon FBM','Walmart','Auto_Armor','Advance_Parts'`;
const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;

const MIN_DAYS_SINCE_RESTOCK = 7;
const ROLLING_WINDOW_DAYS = 14;
const RECOVERY_THRESHOLD_PCT = 0.8;
const RECOVERY_HORIZON_DAYS = 90;

const PREORDER_MAX_WINDOW_DAYS = 30;
const PREORDER_DATA_LAG_DAYS = 2;

export interface TopSellerDbRow {
  master_sku: string;
  category_code: string | null;
  total_qty: string;
}

export interface RecoveryDbRow {
  master_sku: string;
  channel: string;
  oos_started_on: string;
  oos_days: number;
  back_in_stock_on: string;
  days_since_restock: number;
  baseline: string;
  day0_30_avg: string | null;
  day30_60_avg: string | null;
  day60_90_avg: string | null;
  days_to_recovery: number | null;
}

export interface EpisodeDbRow {
  oos_started_on: string;
  back_in_stock_on: string;
}

export interface DrilldownSeriesDbRow {
  pre1: string;
  pre2: string;
  baseline: string;
  d15: string;
  d30: string;
  d60: string;
  d90: string;
}

export interface PreorderDbRow {
  master_sku: string;
  item_category: "Car Cover" | "Seat Cover" | "Floor Mat" | "SWC" | "Miscellaneous";
  channel: string;
  normal_start: string;
  normal_end: string;
  preorder_start: string;
  preorder_end: string;
  back_in_stock_on: string | null;
  window_days: number;
  normal_qty: string;
  preorder_qty: string;
  stage: "active" | "ended";
}

export const OosImpactRepository = {
  async getTopSellers(): Promise<TopSellerDbRow[]> {
    const result = await getPrimaryPool().query<TopSellerDbRow>(`
      WITH velocity AS (
        SELECT v.order_date, v.link_master_sku AS master_sku, v.link_qty AS qty
        FROM shipcore.fc_velocity_link_snapshot v
        WHERE NOT EXISTS (
          SELECT 1 FROM shipcore.fc_products p
          WHERE p.master_sku = v.link_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
        )
        UNION ALL
        SELECT v.order_date, v.custom_master_sku AS master_sku, v.custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot v
        WHERE EXISTS (
          SELECT 1 FROM shipcore.fc_products p
          WHERE p.master_sku = v.custom_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
        )
      )
      SELECT
        v.master_sku,
        MAX(p.category_code) AS category_code,
        SUM(v.qty)::text AS total_qty
      FROM velocity v
      LEFT JOIN shipcore.fc_products p ON p.master_sku = v.master_sku
      WHERE v.order_date >= CURRENT_DATE - ${WINDOW_DAYS}
      GROUP BY v.master_sku
      HAVING SUM(v.qty) > 0
      ORDER BY SUM(v.qty) DESC
      LIMIT ${TOP_SELLERS_LIMIT}
    `);
    return result.rows;
  },

  async getRecoveryRows(): Promise<RecoveryDbRow[]> {
    const result = await getPrimaryPool().query<RecoveryDbRow>(`
      WITH episodes_raw AS (
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          oos_started_on,
          back_in_stock_on,
          synced_at
        FROM shipcore.fc_inventory_history_snapshot
        WHERE back_in_stock_on IS NOT NULL
          AND CURRENT_DATE - back_in_stock_on >= ${MIN_DAYS_SINCE_RESTOCK}
      ),
      episodes AS (
        SELECT DISTINCT ON (master_sku, back_in_stock_on)
          master_sku,
          oos_started_on,
          back_in_stock_on,
          (back_in_stock_on - oos_started_on)::int AS oos_days,
          (CURRENT_DATE - back_in_stock_on)::int AS days_since_restock
        FROM episodes_raw
        ORDER BY master_sku, back_in_stock_on, synced_at DESC
      ),
      velocity AS (
        SELECT v.order_date, v.channel, v.link_master_sku AS master_sku, v.link_qty AS qty
        FROM shipcore.fc_velocity_link_snapshot v
        WHERE v.channel IN (${NON_SHOPIFY_CHANNELS})
          AND NOT EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = v.link_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
          )
        UNION ALL
        SELECT v.order_date, v.channel, v.custom_master_sku AS master_sku, v.custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot v
        WHERE v.channel IN (${NON_SHOPIFY_CHANNELS})
          AND EXISTS (
            SELECT 1 FROM shipcore.fc_products p
            WHERE p.master_sku = v.custom_master_sku AND p.category_code IN ('CC', 'FM', 'SWC')
          )
      ),
      daily_rolling AS (
        SELECT master_sku, channel, order_date,
          SUM(qty) OVER (
            PARTITION BY master_sku, channel ORDER BY order_date
            RANGE BETWEEN INTERVAL '${ROLLING_WINDOW_DAYS - 1} days' PRECEDING AND CURRENT ROW
          ) / ${ROLLING_WINDOW_DAYS}.0 AS trailing_avg
        FROM velocity
      ),
      joined AS (
        SELECT e.master_sku, e.oos_started_on, e.back_in_stock_on, e.oos_days, e.days_since_restock,
               v.channel, v.order_date, v.qty
        FROM episodes e
        JOIN velocity v
          ON v.master_sku = e.master_sku
         AND v.order_date >= e.oos_started_on - 30
         AND v.order_date < e.back_in_stock_on + ${RECOVERY_HORIZON_DAYS}
      ),
      agg AS (
        SELECT
          master_sku, channel, oos_started_on, oos_days, back_in_stock_on, days_since_restock,
          COALESCE(SUM(qty) FILTER (
            WHERE order_date >= oos_started_on - 30 AND order_date < oos_started_on
          ), 0) / 30.0 AS baseline,
          CASE WHEN days_since_restock >= 30 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on AND order_date < back_in_stock_on + 30), 0) / 30.0
          END AS day0_30_avg,
          CASE WHEN days_since_restock >= 60 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on + 30 AND order_date < back_in_stock_on + 60), 0) / 30.0
          END AS day30_60_avg,
          CASE WHEN days_since_restock >= 90 THEN
            COALESCE(SUM(qty) FILTER (WHERE order_date >= back_in_stock_on + 60 AND order_date < back_in_stock_on + 90), 0) / 30.0
          END AS day60_90_avg
        FROM joined
        GROUP BY master_sku, channel, oos_started_on, oos_days, back_in_stock_on, days_since_restock
      ),
      recovery AS (
        SELECT a.master_sku, a.channel, a.back_in_stock_on,
          MIN(dr.order_date) AS first_recovered_on
        FROM agg a
        JOIN daily_rolling dr
          ON dr.master_sku = a.master_sku
         AND dr.channel = a.channel
         AND dr.order_date >= a.back_in_stock_on + ${ROLLING_WINDOW_DAYS - 1}
         AND dr.order_date <= a.back_in_stock_on + ${RECOVERY_HORIZON_DAYS}
         AND dr.trailing_avg >= ${RECOVERY_THRESHOLD_PCT} * a.baseline
        WHERE a.baseline > 0
        GROUP BY a.master_sku, a.channel, a.back_in_stock_on
      )
      SELECT
        a.master_sku, a.channel,
        a.oos_started_on::text AS oos_started_on,
        a.oos_days,
        a.back_in_stock_on::text AS back_in_stock_on,
        a.days_since_restock,
        a.baseline::text AS baseline,
        a.day0_30_avg::text AS day0_30_avg,
        a.day30_60_avg::text AS day30_60_avg,
        a.day60_90_avg::text AS day60_90_avg,
        (r.first_recovered_on - a.back_in_stock_on)::int AS days_to_recovery
      FROM agg a
      LEFT JOIN recovery r
        ON r.master_sku = a.master_sku AND r.channel = a.channel AND r.back_in_stock_on = a.back_in_stock_on
      WHERE a.baseline > 0
      ORDER BY a.days_since_restock ASC
    `);
    return result.rows;
  },

  async findLatestEpisode(sku: string, restockDate: string | null): Promise<EpisodeDbRow | undefined> {
    const result = await getPrimaryPool().query<EpisodeDbRow>(
      `SELECT oos_started_on::text, back_in_stock_on::text
       FROM shipcore.fc_inventory_history_snapshot
       WHERE ${normalizedMasterSkuSql("master_sku")} = $1
         AND back_in_stock_on IS NOT NULL
         ${restockDate ? "AND back_in_stock_on = $2::date" : ""}
       ORDER BY back_in_stock_on DESC, synced_at DESC
       LIMIT 1`,
      restockDate ? [sku, restockDate] : [sku],
    );
    return result.rows[0];
  },

  async getDrilldownSeries(
    sku: string,
    channel: string,
    oosStartedOn: string,
    backInStockOn: string,
  ): Promise<DrilldownSeriesDbRow> {
    const result = await getPrimaryPool().query<DrilldownSeriesDbRow>(
      `WITH velocity AS (
         SELECT v.order_date, v.link_qty AS qty FROM shipcore.fc_velocity_link_snapshot v
         WHERE v.link_master_sku = $1 AND v.channel = $2
           AND NOT EXISTS (SELECT 1 FROM shipcore.fc_products p WHERE p.master_sku = $1 AND p.category_code IN ('CC', 'FM', 'SWC'))
         UNION ALL
         SELECT v.order_date, v.custom_qty AS qty FROM shipcore.fc_velocity_custom_snapshot v
         WHERE v.custom_master_sku = $1 AND v.channel = $2
           AND EXISTS (SELECT 1 FROM shipcore.fc_products p WHERE p.master_sku = $1 AND p.category_code IN ('CC', 'FM', 'SWC'))
       )
       SELECT
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 30 AND order_date < $3::date - 15), 0) / 15.0 AS pre1,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 15 AND order_date < $3::date), 0) / 15.0 AS pre2,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $3::date - 30 AND order_date < $3::date), 0) / 30.0 AS baseline,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 15), 0) / 15.0 AS d15,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 30), 0) / 30.0 AS d30,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 60), 0) / 60.0 AS d60,
         COALESCE(SUM(qty) FILTER (WHERE order_date >= $4::date AND order_date < $4::date + 90), 0) / 90.0 AS d90
       FROM velocity`,
      [sku, channel, oosStartedOn, backInStockOn],
    );
    return result.rows[0];
  },

  async getPreorderRows(): Promise<PreorderDbRow[]> {
    const result = await getPrimaryPool().query<PreorderDbRow>(`
      WITH episodes_raw AS (
        SELECT
          ${normalizedMasterSkuSql("master_sku")} AS master_sku,
          oos_started_on,
          back_in_stock_on,
          synced_at
        FROM shipcore.fc_inventory_history_snapshot
        WHERE oos_started_on < CURRENT_DATE - ${PREORDER_DATA_LAG_DAYS - 1}
      ),
      episodes_deduped AS (
        SELECT DISTINCT ON (master_sku, COALESCE(back_in_stock_on, DATE '9999-12-31'))
          master_sku,
          oos_started_on,
          back_in_stock_on
        FROM episodes_raw
        ORDER BY master_sku, COALESCE(back_in_stock_on, DATE '9999-12-31'), synced_at DESC
      ),
      episodes AS (
        SELECT
          master_sku,
          oos_started_on,
          back_in_stock_on,
          LEAST(
            ${PREORDER_MAX_WINDOW_DAYS},
            LEAST(COALESCE(back_in_stock_on, CURRENT_DATE - ${PREORDER_DATA_LAG_DAYS - 1}), CURRENT_DATE - ${PREORDER_DATA_LAG_DAYS - 1})
              - oos_started_on
          )::int AS window_days
        FROM episodes_deduped
      ),
      velocity AS (
        SELECT
          order_date,
          channel,
          item_category,
          order_type,
          ${normalizedMasterSkuSql("custom_master_sku")} AS master_sku,
          custom_qty AS qty
        FROM shipcore.fc_velocity_custom_snapshot
        WHERE channel IN (${SHOPIFY_CHANNELS})
      ),
      aggregated AS (
        SELECT
          e.master_sku,
          v.channel,
          COALESCE(
            MAX(v.item_category) FILTER (WHERE v.item_category IN ('Car Cover', 'Seat Cover', 'Floor Mat', 'SWC')),
            'Miscellaneous'
          ) AS item_category,
          e.oos_started_on,
          e.back_in_stock_on,
          e.window_days,
          COALESCE(SUM(v.qty) FILTER (
            WHERE v.order_date >= e.oos_started_on - e.window_days
              AND v.order_date < e.oos_started_on
              AND v.order_type IN ('sales', 'ttm')
          ), 0) AS normal_qty,
          COALESCE(SUM(v.qty) FILTER (
            WHERE v.order_date >= e.oos_started_on
              AND v.order_date < e.oos_started_on + e.window_days
              AND v.order_type IN ('preorder', 'ttm_preorder')
          ), 0) AS preorder_qty
        FROM episodes e
        JOIN velocity v
          ON v.master_sku = e.master_sku
         AND v.order_date >= e.oos_started_on - e.window_days
         AND v.order_date < e.oos_started_on + e.window_days
        WHERE e.window_days > 0
        GROUP BY e.master_sku, v.channel, e.oos_started_on, e.back_in_stock_on, e.window_days
      )
      SELECT
        master_sku,
        item_category,
        channel,
        (oos_started_on - window_days)::text AS normal_start,
        (oos_started_on - 1)::text AS normal_end,
        oos_started_on::text AS preorder_start,
        (oos_started_on + window_days - 1)::text AS preorder_end,
        back_in_stock_on::text AS back_in_stock_on,
        window_days,
        normal_qty::text,
        preorder_qty::text,
        CASE WHEN back_in_stock_on IS NULL THEN 'active' ELSE 'ended' END AS stage
      FROM aggregated
      WHERE normal_qty > 0
      ORDER BY oos_started_on DESC, master_sku, channel
    `);
    return result.rows;
  },
};
