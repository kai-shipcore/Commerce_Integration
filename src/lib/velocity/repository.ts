import type { Pool, PoolClient } from "pg";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { normalizedMasterSkuSql } from "@/lib/planning/master-sku";
import { CacheManager } from "@/lib/redis";

// ─── Shared types ───────────────────────────────────────────────────────────

export type VelocitySortOrder = "ASC" | "DESC";

export interface VelocityQueryOpts {
  search?: string;
  sortCol?: string;
  sortOrder?: VelocitySortOrder;
  limit?: number;
  offset?: number;
}

export interface VelocityRow {
  master_sku: string;
  qty_90d: number;
  qty_60d: number;
  qty_30d: number;
  qty_15d: number;
  qty_7d: number;
  total_count: string;
}

export interface VelocityTotals {
  total_90d: string;
  total_60d: string;
  total_30d: string;
  total_15d: string;
  total_7d: string;
  sku_count: string;
}

export interface VelocityQueryResult {
  rows: VelocityRow[];
  totals: VelocityTotals | null;
}

type VelocityQtys = {
  qty_90d: number;
  qty_60d: number;
  qty_30d: number;
  qty_15d: number;
  qty_7d: number;
};

// ─── Shared order-number lookups (in-flight dedup + 30min cache) ───────────
// Multiple velocity queries below need "which order_numbers count as TTM /
// Pre Order" — this is expensive to compute repeatedly, so concurrent callers
// share one in-flight promise and the result is cached in Redis. This is the
// one piece of caching that lives in the repository rather than the service:
// it memoizes a shared intermediate lookup used by several query methods,
// not "the response" of any single method, so there's no clean seam to lift
// it across without threading the order-number list through every caller.

let _ttmOrderNumbersInFlight: Promise<string[]> | null = null;

async function getTtmOrderNumbers(pool: Pool): Promise<string[]> {
  if (_ttmOrderNumbersInFlight) return _ttmOrderNumbersInFlight;

  _ttmOrderNumbersInFlight = (async () => {
    try {
      const cacheKey = "velocity:ttm-order-numbers";
      const cached = await CacheManager.get<string[]>(cacheKey);
      if (cached) return cached;

      const res = await pool.query<{ order_number: string }>(
        `SELECT DISTINCT order_number
         FROM ecommerce_data.sales_orders
         WHERE tags LIKE '%TTM%'
           AND order_number IS NOT NULL`
      );
      const nums = res.rows.map((r) => r.order_number);
      await CacheManager.set(cacheKey, nums, 30 * 60);
      return nums;
    } finally {
      _ttmOrderNumbersInFlight = null;
    }
  })();

  return _ttmOrderNumbersInFlight;
}

let _preOrderOrderNumbersInFlight: Promise<string[]> | null = null;

async function getPreOrderOrderNumbers(pool: Pool): Promise<string[]> {
  if (_preOrderOrderNumbersInFlight) return _preOrderOrderNumbersInFlight;
  _preOrderOrderNumbersInFlight = (async () => {
    try {
      const cacheKey = "velocity:preorder-order-numbers";
      const cached = await CacheManager.get<string[]>(cacheKey);
      if (cached) return cached;
      const res = await pool.query<{ order_number: string }>(
        `SELECT DISTINCT order_number
         FROM ecommerce_data.sales_orders
         WHERE tags LIKE '%STOQ-preorder%'
           AND tags NOT LIKE '%TTM%'
           AND order_number IS NOT NULL`
      );
      const nums = res.rows.map((r) => r.order_number);
      await CacheManager.set(cacheKey, nums, 30 * 60);
      return nums;
    } finally {
      _preOrderOrderNumbersInFlight = null;
    }
  })();
  return _preOrderOrderNumbersInFlight;
}

/**
 * Pure data access for the Velocity feature: sales-velocity rollups sourced
 * from the legacy Supabase lookup DB (`ecommerce_data.*` views) and the
 * primary DB's `fc_velocity_*_snapshot` tables. Caching/validation/
 * orchestration are Service concerns (see velocity/service.ts).
 */
export const VelocityRepository = {
  // ─── Link / Custom / TTM / Pre Order velocity (Channel tab, live views) ───

  async getLinkSalesVelocity(opts: VelocityQueryOpts): Promise<VelocityQueryResult> {
    const pool = getLookupPool();
    if (!pool) return { rows: [], totals: null };

    const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
    const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

    const params: (string | number)[] = [];
    const filters: string[] = [
      "master_sku IS NOT NULL",
      "master_sku LIKE 'CA-SC%'",
      "order_date::date >= CURRENT_DATE - INTERVAL '91 days'",
      "order_date::date <= CURRENT_DATE - INTERVAL '2 days'",
      "item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          master_sku,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_link_new
        ${whereClause}
        GROUP BY master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    try {
      const [dataRes, totalsRes] = await Promise.all([
        pool.query(
          `${pivotCte}
          SELECT master_sku, qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
                 COUNT(*) OVER ()::text AS total_count
          FROM velocity
          ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        pool.query(
          `${pivotCte}
          SELECT
            COALESCE(SUM(qty_90d), 0)::text AS total_90d,
            COALESCE(SUM(qty_60d), 0)::text AS total_60d,
            COALESCE(SUM(qty_30d), 0)::text AS total_30d,
            COALESCE(SUM(qty_15d), 0)::text AS total_15d,
            COALESCE(SUM(qty_7d),  0)::text AS total_7d,
            COUNT(*)::text AS sku_count
          FROM velocity`,
          params
        ),
      ]);
      return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
    } catch (err) {
      console.error("[getLinkSalesVelocity] query error:", err);
      return { rows: [], totals: null };
    }
  },

  async getCustomSalesForSkus(
    linkMasterSkus: string[]
  ): Promise<Map<string, { custom_master_sku: string } & VelocityQtys>> {
    if (!linkMasterSkus.length) return new Map();
    const pool = getLookupPool();
    if (!pool) return new Map();
    try {
      const res = await pool.query<{ link_master_sku: string; custom_master_sku: string } & VelocityQtys>(
        `WITH link_orders AS (
           SELECT DISTINCT master_sku AS link_master_sku, order_sku
           FROM ecommerce_data.vw_sales_order_items_link_new
           WHERE master_sku = ANY($1)
             AND order_date >= NOW() - INTERVAL '93 days'
             AND master_sku IS NOT NULL
             AND item_status IN ('FULFILLED', 'Shipped')
         ),
         custom_data AS (
           SELECT
             lo.link_master_sku,
             c.master_sku AS custom_master_sku,
             c.order_date
           FROM link_orders lo
           JOIN ecommerce_data.vw_sales_order_items_custom_new c ON c.order_sku = lo.order_sku
           WHERE c.master_sku IS NOT NULL
             AND c.item_status IN ('FULFILLED', 'Shipped')
         )
         SELECT
           link_master_sku,
           MIN(custom_master_sku) AS custom_master_sku,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
         FROM custom_data
         GROUP BY link_master_sku`,
        [linkMasterSkus]
      );
      return new Map(
        res.rows.map((r) => [
          r.link_master_sku,
          {
            custom_master_sku: r.custom_master_sku,
            qty_90d: r.qty_90d,
            qty_60d: r.qty_60d,
            qty_30d: r.qty_30d,
            qty_15d: r.qty_15d,
            qty_7d: r.qty_7d,
          },
        ])
      );
    } catch (err) {
      console.error("[getCustomSalesForSkus] query error:", err);
      return new Map();
    }
  },

  async getCustomSalesTotals(search?: string): Promise<{
    total_90d: string; total_60d: string; total_30d: string; total_15d: string; total_7d: string;
  } | null> {
    const pool = getLookupPool();
    if (!pool) return null;
    const params: string[] = [];
    const searchFilter = search ? `AND master_sku ILIKE $${params.push(`%${search}%`)}` : "";
    try {
      const res = await pool.query(
        `WITH link_orders AS (
           SELECT DISTINCT order_sku
           FROM ecommerce_data.vw_sales_order_items_link_new
           WHERE order_date >= NOW() - INTERVAL '93 days'
             AND master_sku IS NOT NULL
             AND master_sku LIKE 'CA-SC%'
             AND item_status IN ('FULFILLED', 'Shipped')
             ${searchFilter}
         ),
         custom_data AS (
           SELECT c.order_date
           FROM link_orders lo
           JOIN ecommerce_data.vw_sales_order_items_custom_new c ON c.order_sku = lo.order_sku
           WHERE c.master_sku IS NOT NULL
             AND c.item_status IN ('FULFILLED', 'Shipped')
         )
         SELECT
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_90d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_60d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_30d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_15d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_7d
         FROM custom_data`,
        params
      );
      return res.rows[0] ?? null;
    } catch (err) {
      console.error("[getCustomSalesTotals] query error:", err);
      return null;
    }
  },

  async getLinkTtmVelocity(opts: VelocityQueryOpts): Promise<VelocityQueryResult> {
    const pool = getLookupPool();
    if (!pool) return { rows: [], totals: null };

    const ttmOrderNumbers = await getTtmOrderNumbers(pool);
    if (ttmOrderNumbers.length === 0) return { rows: [], totals: null };

    const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
    const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

    const params: unknown[] = [ttmOrderNumbers];
    const filters: string[] = [
      "v.master_sku IS NOT NULL",
      "v.master_sku LIKE 'CA-SC%'",
      "v.order_number = ANY($1)",
      "v.order_date::date >= CURRENT_DATE - INTERVAL '91 days'",
      "v.order_date::date <= CURRENT_DATE - INTERVAL '2 days'",
      "v.item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`v.master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          v.master_sku,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_link_new v
        ${whereClause}
        GROUP BY v.master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    try {
      const [dataRes, totalsRes] = await Promise.all([
        pool.query(
          `${pivotCte}
          SELECT master_sku, qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
                 COUNT(*) OVER ()::text AS total_count
          FROM velocity
          ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        pool.query(
          `${pivotCte}
          SELECT
            COALESCE(SUM(qty_90d), 0)::text AS total_90d,
            COALESCE(SUM(qty_60d), 0)::text AS total_60d,
            COALESCE(SUM(qty_30d), 0)::text AS total_30d,
            COALESCE(SUM(qty_15d), 0)::text AS total_15d,
            COALESCE(SUM(qty_7d),  0)::text AS total_7d,
            COUNT(*)::text AS sku_count
          FROM velocity`,
          params
        ),
      ]);
      return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
    } catch (err) {
      console.error("[getLinkTtmVelocity] query error:", err);
      return { rows: [], totals: null };
    }
  },

  async getCustomTtmForSkus(
    linkMasterSkus: string[]
  ): Promise<Map<string, { custom_master_sku: string } & VelocityQtys>> {
    if (!linkMasterSkus.length) return new Map();
    const pool = getLookupPool();
    if (!pool) return new Map();
    const ttmOrderNumbers = await getTtmOrderNumbers(pool);
    if (ttmOrderNumbers.length === 0) return new Map();
    try {
      const res = await pool.query<{ link_master_sku: string; custom_master_sku: string } & VelocityQtys>(
        `WITH link_orders AS (
           SELECT DISTINCT master_sku AS link_master_sku, order_sku
           FROM ecommerce_data.vw_sales_order_items_link_new
           WHERE master_sku = ANY($1)
             AND order_number = ANY($2)
             AND order_date >= NOW() - INTERVAL '93 days'
             AND master_sku IS NOT NULL
             AND item_status IN ('FULFILLED', 'Shipped')
         ),
         custom_data AS (
           SELECT
             lo.link_master_sku,
             c.master_sku AS custom_master_sku,
             c.order_date
           FROM link_orders lo
           JOIN ecommerce_data.vw_sales_order_items_custom_new c ON c.order_sku = lo.order_sku
           WHERE c.order_number = ANY($2)
             AND c.master_sku IS NOT NULL
             AND c.item_status IN ('FULFILLED', 'Shipped')
         )
         SELECT
           link_master_sku,
           MIN(custom_master_sku) AS custom_master_sku,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
         FROM custom_data
         GROUP BY link_master_sku`,
        [linkMasterSkus, ttmOrderNumbers]
      );
      return new Map(
        res.rows.map((r) => [
          r.link_master_sku,
          {
            custom_master_sku: r.custom_master_sku,
            qty_90d: r.qty_90d,
            qty_60d: r.qty_60d,
            qty_30d: r.qty_30d,
            qty_15d: r.qty_15d,
            qty_7d: r.qty_7d,
          },
        ])
      );
    } catch (err) {
      console.error("[getCustomTtmForSkus] query error:", err);
      return new Map();
    }
  },

  async getCustomTtmTotals(search?: string): Promise<{
    total_90d: string; total_60d: string; total_30d: string; total_15d: string; total_7d: string;
  } | null> {
    const pool = getLookupPool();
    if (!pool) return null;
    const ttmOrderNumbers = await getTtmOrderNumbers(pool);
    if (ttmOrderNumbers.length === 0) return null;
    const params: unknown[] = [ttmOrderNumbers];
    const searchFilter = search ? `AND master_sku ILIKE $${params.push(`%${search}%`)}` : "";
    try {
      const res = await pool.query(
        `SELECT
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_90d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_60d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_30d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_15d,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::text AS total_7d
         FROM ecommerce_data.vw_sales_order_items_custom_new
         WHERE order_number = ANY($1)
           AND master_sku IS NOT NULL
           AND master_sku LIKE 'CA-SC%'
           AND item_status IN ('FULFILLED', 'Shipped')
           ${searchFilter}`,
        params
      );
      return res.rows[0] ?? null;
    } catch (err) {
      console.error("[getCustomTtmTotals] query error:", err);
      return null;
    }
  },

  async getCustomSalesVelocity(opts: VelocityQueryOpts): Promise<VelocityQueryResult> {
    const pool = getLookupPool();
    if (!pool) return { rows: [], totals: null };

    const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
    const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

    const params: (string | number)[] = [];
    const filters: string[] = [
      "master_sku IS NOT NULL",
      "master_sku LIKE 'CA-SC%'",
      "order_date::date >= CURRENT_DATE - INTERVAL '91 days'",
      "order_date::date <= CURRENT_DATE - INTERVAL '2 days'",
      "item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          master_sku,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
          COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_custom_new
        ${whereClause}
        GROUP BY master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    try {
      const [dataRes, totalsRes] = await Promise.all([
        pool.query(
          `${pivotCte}
          SELECT master_sku, qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
                 COUNT(*) OVER ()::text AS total_count
          FROM velocity
          ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        pool.query(
          `${pivotCte}
          SELECT
            COALESCE(SUM(qty_90d), 0)::text AS total_90d,
            COALESCE(SUM(qty_60d), 0)::text AS total_60d,
            COALESCE(SUM(qty_30d), 0)::text AS total_30d,
            COALESCE(SUM(qty_15d), 0)::text AS total_15d,
            COALESCE(SUM(qty_7d),  0)::text AS total_7d,
            COUNT(*)::text AS sku_count
          FROM velocity`,
          params
        ),
      ]);
      return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
    } catch (err) {
      console.error("[getCustomSalesVelocity] query error:", err);
      return { rows: [], totals: null };
    }
  },

  async getCustomTtmVelocity(opts: VelocityQueryOpts): Promise<VelocityQueryResult> {
    const pool = getLookupPool();
    if (!pool) return { rows: [], totals: null };

    const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
    const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

    const ttmOrderNumbers = await getTtmOrderNumbers(pool);
    if (ttmOrderNumbers.length === 0) return { rows: [], totals: null };

    const params: unknown[] = [ttmOrderNumbers];
    const filters: string[] = [
      "v.master_sku IS NOT NULL",
      "v.master_sku LIKE 'CA-SC%'",
      "v.order_number = ANY($1)",
      "v.order_date::date >= CURRENT_DATE - INTERVAL '91 days'",
      "v.order_date::date <= CURRENT_DATE - INTERVAL '2 days'",
      "v.item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`v.master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          v.master_sku,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '61 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '31 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '16 days' AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
          COUNT(CASE WHEN v.order_date::date >= CURRENT_DATE - INTERVAL '8 days'  AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_custom_new v
        ${whereClause}
        GROUP BY v.master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    try {
      const [dataRes, totalsRes] = await Promise.all([
        pool.query(
          `${pivotCte}
          SELECT master_sku, qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
                 COUNT(*) OVER ()::text AS total_count
          FROM velocity
          ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        pool.query(
          `${pivotCte}
          SELECT
            COALESCE(SUM(qty_90d), 0)::text AS total_90d,
            COALESCE(SUM(qty_60d), 0)::text AS total_60d,
            COALESCE(SUM(qty_30d), 0)::text AS total_30d,
            COALESCE(SUM(qty_15d), 0)::text AS total_15d,
            COALESCE(SUM(qty_7d),  0)::text AS total_7d,
            COUNT(*)::text AS sku_count
          FROM velocity`,
          params
        ),
      ]);
      return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
    } catch (err) {
      console.error("[getCustomTtmVelocity] query error:", err);
      return { rows: [], totals: null };
    }
  },

  async getLinkPreOrderVelocity(opts: VelocityQueryOpts): Promise<VelocityQueryResult> {
    const pool = getLookupPool();
    if (!pool) return { rows: [], totals: null };

    const preOrderNums = await getPreOrderOrderNumbers(pool);
    if (preOrderNums.length === 0) return { rows: [], totals: null };

    const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
    const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

    const params: unknown[] = [preOrderNums];
    const filters: string[] = [
      "v.master_sku IS NOT NULL",
      "v.master_sku LIKE 'CA-SC%'",
      "v.order_number = ANY($1)",
      "v.order_date::date >= CURRENT_DATE - INTERVAL '91 days'",
      "v.order_date::date <= CURRENT_DATE - INTERVAL '2 days'",
      "v.item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`v.master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          v.master_sku,
          COUNT(*)::int AS qty_90d,
          0::int AS qty_60d,
          0::int AS qty_30d,
          0::int AS qty_15d,
          0::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items_link_new v
        ${whereClause}
        GROUP BY v.master_sku
      )
    `;

    const dataParams = [...params, limit, offset];
    try {
      const [dataRes, totalsRes] = await Promise.all([
        pool.query(
          `${pivotCte}
          SELECT master_sku, qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
                 COUNT(*) OVER ()::text AS total_count
          FROM velocity
          ORDER BY ${sortCol} ${sortOrder}, master_sku ASC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          dataParams
        ),
        pool.query(
          `${pivotCte}
          SELECT
            COALESCE(SUM(qty_90d), 0)::text AS total_90d,
            '0'::text AS total_60d,
            '0'::text AS total_30d,
            '0'::text AS total_15d,
            '0'::text AS total_7d,
            COUNT(*)::text AS sku_count
          FROM velocity`,
          params
        ),
      ]);
      return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
    } catch (err) {
      console.error("[getLinkPreOrderVelocity] query error:", err);
      return { rows: [], totals: null };
    }
  },

  async getCustomPreOrderForSkus(
    linkMasterSkus: string[]
  ): Promise<Map<string, { custom_master_sku: string; qty_90d: number }>> {
    if (!linkMasterSkus.length) return new Map();
    const pool = getLookupPool();
    if (!pool) return new Map();
    try {
      const res = await pool.query<{ link_master_sku: string; custom_master_sku: string; qty_90d: number }>(
        `WITH pre_order_nums AS (
           SELECT order_number FROM ecommerce_data.sales_orders
           WHERE tags LIKE '%STOQ-preorder%' AND tags NOT LIKE '%TTM%'
             AND order_number IS NOT NULL
         ),
         link_orders AS (
           SELECT DISTINCT v.master_sku AS link_master_sku, v.order_sku
           FROM ecommerce_data.vw_sales_order_items_link_new v
           JOIN pre_order_nums po ON po.order_number = v.order_number
           WHERE v.master_sku = ANY($1)
             AND v.order_date >= NOW() - INTERVAL '93 days'
             AND v.master_sku IS NOT NULL
             AND v.item_status IN ('FULFILLED', 'Shipped')
         ),
         custom_data AS (
           SELECT lo.link_master_sku, c.master_sku AS custom_master_sku, c.order_date
           FROM link_orders lo
           JOIN ecommerce_data.vw_sales_order_items_custom_new c ON c.order_sku = lo.order_sku
           JOIN pre_order_nums po ON po.order_number = c.order_number
           WHERE c.master_sku IS NOT NULL
             AND c.item_status IN ('FULFILLED', 'Shipped')
         )
         SELECT
           link_master_sku,
           MIN(custom_master_sku) AS custom_master_sku,
           COUNT(CASE WHEN order_date::date >= CURRENT_DATE - INTERVAL '91 days' AND order_date::date <= CURRENT_DATE - INTERVAL '2 days' THEN 1 END)::int AS qty_90d
         FROM custom_data
         GROUP BY link_master_sku`,
        [linkMasterSkus]
      );
      return new Map(res.rows.map((r) => [r.link_master_sku, { custom_master_sku: r.custom_master_sku, qty_90d: r.qty_90d }]));
    } catch (err) {
      console.error("[getCustomPreOrderForSkus] query error:", err);
      return new Map();
    }
  },

  async getTtmPreOrderForSkus(
    linkMasterSkus: string[]
  ): Promise<Map<string, { ttm_master_sku: string; count: number }>> {
    if (!linkMasterSkus.length) return new Map();
    const pool = getLookupPool();
    if (!pool) return new Map();
    try {
      const res = await pool.query<{ master_sku: string; count: number }>(
        `SELECT v.master_sku, COUNT(*)::int AS count
         FROM ecommerce_data.vw_sales_order_items_link_new v
         JOIN ecommerce_data.sales_orders so ON so.order_number = v.order_number
         WHERE v.master_sku = ANY($1)
           AND so.tags LIKE '%STOQ-preorder%'
           AND so.tags LIKE '%TTM%'
           AND v.master_sku IS NOT NULL
           AND v.master_sku LIKE 'CA-SC%'
           AND v.item_status IN ('FULFILLED', 'Shipped')
           AND v.order_date::date >= CURRENT_DATE - INTERVAL '91 days'
           AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days'
         GROUP BY v.master_sku`,
        [linkMasterSkus]
      );
      return new Map(res.rows.map((r) => [r.master_sku, { ttm_master_sku: r.master_sku, count: r.count }]));
    } catch (err) {
      console.error("[getTtmPreOrderForSkus] query error:", err);
      return new Map();
    }
  },

  async getPreOrderTotals(search?: string): Promise<{ custom_total: string; ttm_total: string } | null> {
    const pool = getLookupPool();
    if (!pool) return null;
    try {
      const customParams: unknown[] = [];
      const ttmParams: unknown[] = [];
      const searchFilterCustom = search ? `AND c.master_sku ILIKE $${customParams.push(`%${search}%`)}` : "";
      const searchFilterTtm = search ? `AND v.master_sku ILIKE $${ttmParams.push(`%${search}%`)}` : "";

      const [customRes, ttmRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::text AS total
           FROM ecommerce_data.vw_sales_order_items_custom_new c
           JOIN ecommerce_data.sales_orders so ON so.order_number = c.order_number
           WHERE so.tags LIKE '%STOQ-preorder%' AND so.tags NOT LIKE '%TTM%'
             AND c.master_sku IS NOT NULL
             AND c.item_status IN ('FULFILLED', 'Shipped')
             AND c.order_date::date >= CURRENT_DATE - INTERVAL '91 days'
             AND c.order_date::date <= CURRENT_DATE - INTERVAL '2 days'
             ${searchFilterCustom}`,
          customParams
        ),
        pool.query(
          `SELECT COUNT(*)::text AS total
           FROM ecommerce_data.vw_sales_order_items_link_new v
           JOIN ecommerce_data.sales_orders so ON so.order_number = v.order_number
           WHERE so.tags LIKE '%STOQ-preorder%' AND so.tags LIKE '%TTM%'
             AND v.master_sku IS NOT NULL
             AND v.master_sku LIKE 'CA-SC%'
             AND v.item_status IN ('FULFILLED', 'Shipped')
             AND v.order_date::date >= CURRENT_DATE - INTERVAL '91 days'
             AND v.order_date::date <= CURRENT_DATE - INTERVAL '2 days'
             ${searchFilterTtm}`,
          ttmParams
        ),
      ]);

      return {
        custom_total: String(customRes.rows[0]?.total ?? "0"),
        ttm_total: String(ttmRes.rows[0]?.total ?? "0"),
      };
    } catch (err) {
      console.error("[getPreOrderTotals] query error:", err);
      return null;
    }
  },

  // ─── Legacy default mode (Channel tab, /api/velocity with no `source`) ───

  async queryChannelVelocity(opts: {
    platformSource: string;
    fulfillmentChannel: string;
    search: string;
    sortCol: string;
    sortOrder: VelocitySortOrder;
    limit: number;
    offset: number;
  }): Promise<{
    rows: Array<{ master_sku: string; qty_90d: number; qty_60d: number; qty_30d: number; qty_15d: number; qty_7d: number; total_count: string }>;
    totals: { total_90d: string; total_60d: string; total_30d: string; total_15d: string; total_7d: string; sku_count: string } | null;
  }> {
    const pool = getLookupPool();
    if (!pool) throw new Error("No lookup database connection configured");

    const params: (string | number)[] = [];
    const filters: string[] = [
      "master_sku IS NOT NULL",
      "order_date >= NOW() - INTERVAL '90 days'",
      "quantity > 0",
      "item_status IN ('FULFILLED', 'Shipped')",
    ];

    if (opts.platformSource) {
      params.push(opts.platformSource);
      filters.push(`platform_source::text = $${params.length}`);
    }

    if (opts.fulfillmentChannel) {
      params.push(opts.fulfillmentChannel);
      filters.push(`fulfillment_channel::text = $${params.length}`);
    }

    if (opts.search) {
      params.push(`%${opts.search}%`);
      filters.push(`master_sku ILIKE $${params.length}`);
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const pivotCte = `
      WITH velocity AS (
        SELECT
          master_sku,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '90 days' THEN quantity ELSE 0 END)::int AS qty_90d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '60 days' THEN quantity ELSE 0 END)::int AS qty_60d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '30 days' THEN quantity ELSE 0 END)::int AS qty_30d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '15 days' THEN quantity ELSE 0 END)::int AS qty_15d,
          SUM(CASE WHEN order_date >= NOW() - INTERVAL '7 days'  THEN quantity ELSE 0 END)::int AS qty_7d
        FROM ecommerce_data.vw_sales_order_items
        ${whereClause}
        GROUP BY master_sku
      )
    `;

    const dataParams = [...params, opts.limit, opts.offset];
    const [dataRes, totalsRes] = await Promise.all([
      pool.query<{ master_sku: string; qty_90d: number; qty_60d: number; qty_30d: number; qty_15d: number; qty_7d: number; total_count: string }>(
        `${pivotCte}
        SELECT
          master_sku,
          qty_90d, qty_60d, qty_30d, qty_15d, qty_7d,
          COUNT(*) OVER ()::text AS total_count
        FROM velocity
        ORDER BY ${opts.sortCol} ${opts.sortOrder}, master_sku ASC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      pool.query<{ total_90d: string; total_60d: string; total_30d: string; total_15d: string; total_7d: string; sku_count: string }>(
        `${pivotCte}
        SELECT
          COALESCE(SUM(qty_90d), 0)::text AS total_90d,
          COALESCE(SUM(qty_60d), 0)::text AS total_60d,
          COALESCE(SUM(qty_30d), 0)::text AS total_30d,
          COALESCE(SUM(qty_15d), 0)::text AS total_15d,
          COALESCE(SUM(qty_7d),  0)::text AS total_7d,
          COUNT(*)::text AS sku_count
        FROM velocity`,
        params
      ),
    ]);

    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  },

  // ─── Channels list (Channel tab sub-tabs) ─────────────────────────────────

  async getDistinctChannels(): Promise<{ channels: string[]; subChannels: Record<string, string[]> }> {
    const pool = getLookupPool();
    if (!pool) throw new Error("No lookup database connection configured");

    const [channelsRes, ebaySubRes] = await Promise.all([
      pool.query<{ platform_source: string }>(
        `SELECT DISTINCT platform_source::text AS platform_source
         FROM ecommerce_data.vw_sales_order_items
         WHERE platform_source IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
           AND master_sku IS NOT NULL
           AND quantity > 0
           AND item_status IN ('FULFILLED', 'Shipped')
         ORDER BY platform_source ASC`
      ),
      pool.query<{ fulfillment_channel: string }>(
        `SELECT DISTINCT fulfillment_channel::text AS fulfillment_channel
         FROM ecommerce_data.vw_sales_order_items
         WHERE platform_source::text = 'ebay'
           AND fulfillment_channel IS NOT NULL
           AND order_date >= NOW() - INTERVAL '90 days'
           AND master_sku IS NOT NULL
           AND quantity > 0
           AND item_status IN ('FULFILLED', 'Shipped')
         ORDER BY fulfillment_channel ASC`
      ),
    ]);

    const subChannels: Record<string, string[]> = {};
    if (ebaySubRes.rows.length > 0) {
      subChannels["ebay"] = ebaySubRes.rows.map((r) => r.fulfillment_channel);
    }

    return {
      channels: channelsRes.rows.map((r) => r.platform_source),
      subChannels,
    };
  },

  // ─── Snapshot-based date-range queries (Item/Channel tab) ────────────────

  async querySnapshotByRanges(opts: {
    table: "fc_velocity_link_snapshot" | "fc_velocity_custom_snapshot";
    skuColumn: "link_master_sku" | "custom_master_sku";
    qtyColumn: "link_qty" | "custom_qty";
    items: string[];
    channels: string[];
    orderType: "sales" | "ttm";
    ranges: { from: string; to: string }[];
  }): Promise<Array<{ master_sku: string } & Record<string, unknown>>> {
    const pool = getPrimaryPool();
    const cols = opts.ranges
      .map(
        ({ from, to }, i) =>
          `SUM(CASE WHEN order_date >= '${from}' AND order_date <= '${to}' THEN ${opts.qtyColumn} ELSE 0 END)::int AS qty_${i}`
      )
      .join(", ");

    const result = await pool.query(
      `SELECT ${opts.skuColumn} AS master_sku, ${cols}
       FROM shipcore.${opts.table}
       WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = $3
       GROUP BY ${opts.skuColumn}
       ORDER BY qty_0 DESC`,
      [opts.items, opts.channels, opts.orderType]
    );
    return result.rows;
  },

  async querySnapshotPreorder(opts: {
    table: "fc_velocity_link_snapshot" | "fc_velocity_custom_snapshot";
    skuColumn: "link_master_sku" | "custom_master_sku";
    qtyColumn: "link_qty" | "custom_qty";
    items: string[];
    channels: string[];
    ranges: { from: string; to: string }[];
    orderTypeFilter: string;
  }): Promise<Array<{ master_sku: string } & Record<string, unknown>>> {
    const pool = getPrimaryPool();
    const cols = opts.ranges
      .map(
        ({ from, to }, i) =>
          `SUM(CASE WHEN order_date >= '${from}' AND order_date <= '${to}' THEN ${opts.qtyColumn} ELSE 0 END)::int AS qty_${i}`
      )
      .join(", ");

    const result = await pool.query(
      `SELECT ${opts.skuColumn} AS master_sku, ${cols}
       FROM shipcore.${opts.table}
       WHERE item_category = ANY($1) AND channel = ANY($2) AND ${opts.orderTypeFilter}
       GROUP BY ${opts.skuColumn} ORDER BY qty_0 DESC`,
      [opts.items, opts.channels]
    );
    return result.rows;
  },

  // ─── Sync (POST /api/velocity/sync) ───────────────────────────────────────

  async getLastSyncedAt(): Promise<Date | null> {
    const pool = getPrimaryPool();
    const result = await pool.query<{ last_synced_at: Date | null }>(
      "SELECT MAX(synced_at) AS last_synced_at FROM shipcore.fc_velocity_link_snapshot"
    );
    return result.rows[0]?.last_synced_at ?? null;
  },

  async checkoutSyncClient(): Promise<PoolClient> {
    const pool = getPrimaryPool();
    return pool.connect();
  },

  async tryAcquireSyncLock(client: PoolClient): Promise<boolean> {
    const result = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
      [VELOCITY_SYNC_LOCK_KEY]
    );
    return result.rows[0].acquired;
  },

  async reclaimStaleLock(client: PoolClient): Promise<{ reclaimed: boolean; holdSeconds: number | null }> {
    const holderRes = await client.query<{ pid: number; hold_seconds: number }>(
      `SELECT a.pid, EXTRACT(EPOCH FROM (now() - a.state_change))::int AS hold_seconds
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.objid = $1::bigint AND l.granted`,
      [VELOCITY_SYNC_LOCK_KEY]
    );

    const holder = holderRes.rows[0];
    if (!holder) return { reclaimed: false, holdSeconds: null };

    if (holder.hold_seconds * 1000 <= STALE_LOCK_MAX_AGE_MS) {
      return { reclaimed: false, holdSeconds: holder.hold_seconds };
    }

    console.warn(`[velocity/sync] Reclaiming stale advisory lock held by pid ${holder.pid} for ${holder.hold_seconds}s`);
    await client.query(`SELECT pg_terminate_backend($1::int)`, [holder.pid]);
    return { reclaimed: true, holdSeconds: holder.hold_seconds };
  },

  async releaseSyncLock(client: PoolClient): Promise<void> {
    await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [VELOCITY_SYNC_LOCK_KEY]);
  },

  // GROUP BY is positional against LINK_SELECT / CUSTOM_SELECT: every column
  // except the SUM at position 6. Adding or removing a select column shifts
  // these numbers, and a wrong-but-valid number groups the wrong thing without
  // erroring — recount them whenever the select list changes.
  async fetchLinkRowsFromLookup(lookupPool: Pool, dateFilter: string): Promise<LinkSnapshotSourceRow[]> {
    const result = await lookupPool.query<LinkSnapshotSourceRow>(
      `${LINK_SELECT} ${LINK_WHERE} ${dateFilter} GROUP BY 1, 2, 3, 4, 5, 7`
    );
    return result.rows;
  },

  async fetchLinkForecastRowsFromLookup(lookupPool: Pool): Promise<LinkSnapshotSourceRow[]> {
    const result = await lookupPool.query<LinkSnapshotSourceRow>(`${LINK_SELECT} ${LINK_WHERE} GROUP BY 1, 2, 3, 4, 5, 7`);
    return result.rows;
  },

  async fetchCustomRowsFromLookup(lookupPool: Pool, dateFilterC: string): Promise<CustomSnapshotSourceRow[]> {
    const result = await lookupPool.query<CustomSnapshotSourceRow>(
      `${CUSTOM_SELECT} ${CUSTOM_WHERE} ${dateFilterC} GROUP BY 1, 2, 3, 4, 5, 7`
    );
    return result.rows;
  },

  async upsertLinkSnapshot(
    rows: LinkSnapshotSourceRow[],
    syncedAt: Date,
    table = "shipcore.fc_velocity_link_snapshot"
  ): Promise<number> {
    const pool = getPrimaryPool();
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await pool.query(
        `INSERT INTO ${table}
           (order_date, item_category, channel, order_type, link_master_sku, link_qty, synced_at, is_custom)
         SELECT UNNEST($1::date[]), UNNEST($2::text[]), UNNEST($3::text[]), UNNEST($4::text[]),
                UNNEST($5::text[]), UNNEST($6::int[]), UNNEST($7::timestamptz[]),
                UNNEST($8::text[])
         ON CONFLICT (order_date, item_category, channel, order_type, link_master_sku)
         DO UPDATE SET
           link_qty  = EXCLUDED.link_qty,
           synced_at = EXCLUDED.synced_at,
           is_custom = EXCLUDED.is_custom`,
        [
          batch.map((r) => r.order_date.toISOString().slice(0, 10)),
          batch.map((r) => r.item_category),
          batch.map((r) => r.channel),
          batch.map((r) => r.order_type),
          batch.map((r) => r.link_master_sku),
          batch.map((r) => r.link_qty),
          batch.map(() => syncedAt),
          batch.map((r) => r.is_custom),
        ]
      );
      upserted += batch.length;
    }
    return upserted;
  },

  async upsertCustomSnapshot(rows: CustomSnapshotSourceRow[], syncedAt: Date): Promise<number> {
    const pool = getPrimaryPool();
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await pool.query(
        `INSERT INTO shipcore.fc_velocity_custom_snapshot
           (order_date, item_category, channel, order_type, custom_master_sku, custom_qty, synced_at, is_custom)
         SELECT UNNEST($1::date[]), UNNEST($2::text[]), UNNEST($3::text[]), UNNEST($4::text[]),
                UNNEST($5::text[]), UNNEST($6::int[]), UNNEST($7::timestamptz[]),
                UNNEST($8::text[])
         ON CONFLICT (order_date, item_category, channel, order_type, custom_master_sku)
         DO UPDATE SET
           custom_qty = EXCLUDED.custom_qty,
           synced_at  = EXCLUDED.synced_at,
           is_custom  = EXCLUDED.is_custom`,
        [
          batch.map((r) => r.order_date.toISOString().slice(0, 10)),
          batch.map((r) => r.item_category),
          batch.map((r) => r.channel),
          batch.map((r) => r.order_type),
          batch.map((r) => r.custom_master_sku),
          batch.map((r) => r.custom_qty),
          batch.map(() => syncedAt),
          batch.map((r) => r.is_custom),
        ]
      );
      upserted += batch.length;
    }
    return upserted;
  },

  async deleteStaleSnapshots(syncedAt: Date, full: boolean): Promise<{ linkDeleted: number; customDeleted: number }> {
    const pool = getPrimaryPool();
    const [linkDeleteRes, customDeleteRes] = await Promise.all([
      pool.query(
        full
          ? `DELETE FROM shipcore.fc_velocity_link_snapshot WHERE synced_at < $1`
          : `DELETE FROM shipcore.fc_velocity_link_snapshot WHERE order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days' AND synced_at < $1`,
        [syncedAt]
      ),
      pool.query(
        full
          ? `DELETE FROM shipcore.fc_velocity_custom_snapshot WHERE synced_at < $1`
          : `DELETE FROM shipcore.fc_velocity_custom_snapshot WHERE order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days' AND synced_at < $1`,
        [syncedAt]
      ),
      pool.query(`DELETE FROM shipcore.fc_velocity_link_snapshot_forecast WHERE synced_at < $1`, [syncedAt]),
    ]);
    return { linkDeleted: linkDeleteRes.rowCount ?? 0, customDeleted: customDeleteRes.rowCount ?? 0 };
  },
};

// ─── Sync internals (SQL fragments, batch config, row shapes) ─────────────

const VELOCITY_SYNC_LOCK_KEY = 1000000001;
// No real sync has ever taken this long; a lock held past this age means the previous
// request's connection died without releasing it (e.g. dropped network, killed dev server)
// rather than a sync that's genuinely still running.
const STALE_LOCK_MAX_AGE_MS = 15 * 60 * 1000;

const BATCH_SIZE = 2000;
// Only pull this many days of history — covers the 96-day max lookback with buffer.
const SYNC_LOOKBACK_DAYS = 120;

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

export interface LinkSnapshotSourceRow {
  order_date: Date;
  channel: string;
  item_category: string;
  order_type: string;
  link_master_sku: string;
  link_qty: number;
  is_custom: string;
}

export interface CustomSnapshotSourceRow {
  order_date: Date;
  channel: string;
  item_category: string;
  order_type: string;
  custom_master_sku: string;
  custom_qty: number;
  is_custom: string;
}

export function buildSyncDateFilters(full: boolean): { dateFilter: string; dateFilterC: string } {
  return {
    dateFilter: full ? "" : `AND l.order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days'`,
    dateFilterC: full ? "" : `AND c.order_date >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days'`,
  };
}

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
       ${CHANNEL_CASE("c")}       AS channel,
       ${ITEM_CATEGORY_CASE("c.master_sku")} AS item_category,
       ${ORDER_TYPE_CASE("c")}    AS order_type,
       ${normalizedMasterSkuSql("c.master_sku")} AS custom_master_sku,
       SUM(c.quantity)::int AS custom_qty,
       c.is_custom                AS is_custom
     FROM ecommerce_data.vw_sales_order_items_custom_new c`;
