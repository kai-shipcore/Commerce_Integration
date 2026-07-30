/**
 * Code Guide:
 * Read-only helpers for the Supabase lookup database (SUPABASE_LOOKUP_DATABASE_URL).
 * Covers master SKU resolution, inventory display, and order feeds sourced from the old Supabase.
 * Write helpers for the primary (new) DB live in primary-db.ts.
 */

import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { CacheManager } from "@/lib/redis";


let lookupPool: Pool | null = null;

function getLookupConnectionString(): string | null {
  return (
    process.env.SUPABASE_LOOKUP_DATABASE_URL || process.env.DATABASE_URL || null
  );
}

export function getLookupPool(): Pool | null {
  const connectionString = getLookupConnectionString();

  if (!connectionString) {
    return null;
  }

  if (!lookupPool) {
    lookupPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    });
  }

  return lookupPool;
}

export interface MasterSkuResult {
  variant_sku: string;
  master_sku_parse1: string;
  master_sku_parse2: string | null;
  master_sku_parse3: string | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

export function isLookupConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code = getErrorCode(error);

  return (
    message.includes("connection timeout") ||
    message.includes("max client connections") ||
    message.includes("timeout expired") ||
    message.includes("connection terminated") ||
    message.includes("terminating connection") ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "57P01" ||
    code === "53300"
  );
}

/**
 * Lookup master SKUs using the size_chart.fn_extract_master_sku_from_web_sku function
 * from the separate Supabase project
 */
export async function lookupMasterSkusFromSupabase(
  webSkus: string[],
): Promise<Map<
  string,
  { parse1: string; parse2: string | null; parse3: string | null }
> | null> {
  const pool = getLookupPool();

  if (!pool) {
    console.warn(
      "No lookup database connection configured. Master SKU lookup disabled.",
    );
    return null;
  }

  if (webSkus.length === 0) {
    return new Map();
  }

  const masterSkuMap = new Map<
    string,
    { parse1: string; parse2: string | null; parse3: string | null }
  >();

  try {
    const client = await pool.connect();
    try {
      const result = await client.query<MasterSkuResult>(
        `SELECT
          sku as variant_sku,
          (size_chart.fn_extract_master_sku_from_web_sku(sku)).master_sku_parse1,
          (size_chart.fn_extract_master_sku_from_web_sku(sku)).master_sku_parse2,
          (size_chart.fn_extract_master_sku_from_web_sku(sku)).master_sku_parse3
        FROM unnest($1::text[]) as sku`,
        [webSkus],
      );

      for (const row of result.rows) {
        if (row.master_sku_parse1) {
          masterSkuMap.set(row.variant_sku, {
            parse1: row.master_sku_parse1,
            parse2: row.master_sku_parse2 || null,
            parse3: row.master_sku_parse3 || null,
          });
        }
      }
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    console.error(
      "Error looking up master SKUs from Supabase:",
      getErrorMessage(error),
    );

    // Check if it's a connection error vs a function error
    const errorCode = getErrorCode(error);
    if (errorCode === "ECONNREFUSED" || errorCode === "ENOTFOUND") {
      return null; // Connection not available
    }

    throw error;
  }

  return masterSkuMap;
}

/**
 * Test if the lookup connection is available
 */
export async function getVariantNames(
  channelSkus: string[],
): Promise<Map<string, string>> {
  const pool = getLookupPool();
  if (!pool || channelSkus.length === 0) return new Map();

  const client = await pool.connect();
  try {
    const result = await client.query<{
      variant_sku: string;
      variant_name: string;
    }>(
      `SELECT DISTINCT ON (variant_sku)
         variant_sku,
         TRIM(
           title ||
           CASE WHEN option_1_value IS NOT NULL AND option_1_value <> '' AND option_1_value <> 'Default Title'
                THEN ' ' || option_1_value ELSE '' END ||
           CASE WHEN option_2_value IS NOT NULL AND option_2_value <> ''
                THEN ' ' || option_2_value ELSE '' END ||
           CASE WHEN option_3_value IS NOT NULL AND option_3_value <> ''
                THEN ' ' || option_3_value ELSE '' END
         ) AS variant_name
       FROM size_chart.shopify_db
       WHERE variant_sku = ANY($1::text[])
       ORDER BY variant_sku, updated_at DESC NULLS LAST`,
      [channelSkus],
    );
    return new Map(result.rows.map((r) => [r.variant_sku, r.variant_name]));
  } finally {
    client.release();
  }
}

export async function testLookupConnection(): Promise<{
  available: boolean;
  error?: string;
}> {
  const pool = getLookupPool();

  if (!pool) {
    return {
      available: false,
      error: "No lookup database connection configured",
    };
  }

  try {
    const client = await pool.connect();
    try {
      // Test the function exists
      await client.query(
        `SELECT (size_chart.fn_extract_master_sku_from_web_sku('test')).master_sku_parse1`,
      );
      return { available: true };
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    return {
      available: false,
      error: getErrorMessage(error),
    };
  }
}

export async function syncInventorySnapshotFromSqlFile(
  sqlFilePath: string,
): Promise<{ filePath: string }> {
  const pool = getLookupPool();

  if (!pool) {
    throw new Error("No lookup database connection configured");
  }

  const sqlScript = (await readFile(sqlFilePath, "utf8")).trim();
  if (!sqlScript) {
    throw new Error("Inventory sync SQL file is empty");
  }

  const client = await pool.connect();
  try {
    await client.query(sqlScript);
    return { filePath: sqlFilePath };
  } finally {
    client.release();
  }
}

// In-memory SKU→master cache. vw_sales_order_items is expensive (~7s per query);
// caching per-SKU (including null for "not found") avoids re-querying on repeated page loads.
const _skuMasterCache = new Map<string, { master: string | null; expiresAt: number }>();
const SKU_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function lookupMasterSkusByOrderSkus(
  channelSkus: string[],
): Promise<Map<string, string>> {
  if (!channelSkus.length) return new Map();
  const pool = getLookupPool();
  if (!pool) return new Map();

  const result = new Map<string, string>();
  const now = Date.now();
  const uncached: string[] = [];

  for (const sku of channelSkus) {
    const entry = _skuMasterCache.get(sku);
    if (entry && entry.expiresAt > now) {
      if (entry.master !== null) result.set(sku, entry.master);
    } else {
      uncached.push(sku);
    }
  }

  if (uncached.length === 0) return result;

  try {
    const res = await pool.query<{ order_sku: string; master_sku: string }>(
      `SELECT DISTINCT ON (order_sku) order_sku, master_sku
       FROM ecommerce_data.vw_sales_order_items
       WHERE order_sku = ANY($1)
         AND master_sku IS NOT NULL`,
      [uncached],
    );
    const expiresAt = Date.now() + SKU_CACHE_TTL_MS;
    const found = new Set(res.rows.map((r) => r.order_sku));
    for (const row of res.rows) {
      result.set(row.order_sku, row.master_sku);
      _skuMasterCache.set(row.order_sku, { master: row.master_sku, expiresAt });
    }
    for (const sku of uncached) {
      if (!found.has(sku)) {
        _skuMasterCache.set(sku, { master: null, expiresAt });
      }
    }
    return result;
  } catch (err) {
    console.error("[lookupMasterSkusByOrderSkus] query error:", err);
    return result;
  }
}

export async function getLinkSalesVelocity(opts: {
  search?: string;
  sortCol?: string;
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<{
    master_sku: string;
    qty_90d: number;
    qty_60d: number;
    qty_30d: number;
    qty_15d: number;
    qty_7d: number;
    total_count: string;
  }>;
  totals: {
    total_90d: string;
    total_60d: string;
    total_30d: string;
    total_15d: string;
    total_7d: string;
    sku_count: string;
  } | null;
}> {
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
        dataParams,
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
        params,
      ),
    ]);
    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  } catch (err) {
    console.error("[getLinkSalesVelocity] query error:", err);
    return { rows: [], totals: null };
  }
}

type VelocityQtys = {
  qty_90d: number;
  qty_60d: number;
  qty_30d: number;
  qty_15d: number;
  qty_7d: number;
};

export async function getCustomSalesForSkus(
  linkMasterSkus: string[],
): Promise<Map<string, { custom_master_sku: string } & VelocityQtys>> {
  if (!linkMasterSkus.length) return new Map();
  const pool = getLookupPool();
  if (!pool) return new Map();
  try {
    const res = await pool.query<
      { link_master_sku: string; custom_master_sku: string } & VelocityQtys
    >(
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
      [linkMasterSkus],
    );
    if (res.rows.length > 0) {
      console.log(
        "[getCustomSalesForSkus] sample row:",
        JSON.stringify(res.rows[0]),
      );
    } else {
      console.log("[getCustomSalesForSkus] query returned 0 rows");
    }
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
      ]),
    );
  } catch (err) {
    console.error("[getCustomSalesForSkus] query error:", err);
    return new Map();
  }
}

export async function getCustomSalesTotals(search?: string): Promise<{
  total_90d: string;
  total_60d: string;
  total_30d: string;
  total_15d: string;
  total_7d: string;
} | null> {
  const pool = getLookupPool();
  if (!pool) return null;
  const params: string[] = [];
  const searchFilter = search
    ? `AND master_sku ILIKE $${params.push(`%${search}%`)}`
    : "";
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
      params,
    );
    return res.rows[0] ?? null;
  } catch (err) {
    console.error("[getCustomSalesTotals] query error:", err);
    return null;
  }
}

// In-flight deduplication: concurrent callers share the same promise, DB query runs only once.
// Result is cached in Redis for 30 min.
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

export async function getLinkTtmVelocity(opts: {
  search?: string;
  sortCol?: string;
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<{
    master_sku: string;
    qty_90d: number;
    qty_60d: number;
    qty_30d: number;
    qty_15d: number;
    qty_7d: number;
    total_count: string;
  }>;
  totals: {
    total_90d: string;
    total_60d: string;
    total_30d: string;
    total_15d: string;
    total_7d: string;
    sku_count: string;
  } | null;
}> {
  const pool = getLookupPool();
  if (!pool) return { rows: [], totals: null };

  const ttmOrderNumbers = await getTtmOrderNumbers(pool);
  if (ttmOrderNumbers.length === 0) return { rows: [], totals: null };

  const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
  const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

  // $1 = ttmOrderNumbers array; subsequent params start at $2
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
        dataParams,
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
        params,
      ),
    ]);
    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  } catch (err) {
    console.error("[getLinkTtmVelocity] query error:", err);
    return { rows: [], totals: null };
  }
}

export async function getCustomTtmForSkus(
  linkMasterSkus: string[],
): Promise<Map<string, { custom_master_sku: string } & VelocityQtys>> {
  if (!linkMasterSkus.length) return new Map();
  const pool = getLookupPool();
  if (!pool) return new Map();
  const ttmOrderNumbers = await getTtmOrderNumbers(pool);
  if (ttmOrderNumbers.length === 0) return new Map();
  try {
    const res = await pool.query<
      { link_master_sku: string; custom_master_sku: string } & VelocityQtys
    >(
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
      [linkMasterSkus, ttmOrderNumbers],
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
      ]),
    );
  } catch (err) {
    console.error("[getCustomTtmForSkus] query error:", err);
    return new Map();
  }
}

export async function getCustomTtmTotals(search?: string): Promise<{
  total_90d: string;
  total_60d: string;
  total_30d: string;
  total_15d: string;
  total_7d: string;
} | null> {
  const pool = getLookupPool();
  if (!pool) return null;
  const ttmOrderNumbers = await getTtmOrderNumbers(pool);
  if (ttmOrderNumbers.length === 0) return null;
  const params: unknown[] = [ttmOrderNumbers]; // $1 = ttmOrderNumbers array
  const searchFilter = search
    ? `AND master_sku ILIKE $${params.push(`%${search}%`)}`
    : "";
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
      params,
    );
    return res.rows[0] ?? null;
  } catch (err) {
    console.error("[getCustomTtmTotals] query error:", err);
    return null;
  }
}

export async function getCustomSalesVelocity(opts: {
  search?: string;
  sortCol?: string;
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<{
    master_sku: string;
    qty_90d: number;
    qty_60d: number;
    qty_30d: number;
    qty_15d: number;
    qty_7d: number;
    total_count: string;
  }>;
  totals: {
    total_90d: string;
    total_60d: string;
    total_30d: string;
    total_15d: string;
    total_7d: string;
    sku_count: string;
  } | null;
}> {
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
        dataParams,
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
        params,
      ),
    ]);
    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  } catch (err) {
    console.error("[getCustomSalesVelocity] query error:", err);
    return { rows: [], totals: null };
  }
}

export async function getCustomTtmVelocity(opts: {
  search?: string;
  sortCol?: string;
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<{
    master_sku: string;
    qty_90d: number;
    qty_60d: number;
    qty_30d: number;
    qty_15d: number;
    qty_7d: number;
    total_count: string;
  }>;
  totals: {
    total_90d: string;
    total_60d: string;
    total_30d: string;
    total_15d: string;
    total_7d: string;
    sku_count: string;
  } | null;
}> {
  const pool = getLookupPool();
  if (!pool) return { rows: [], totals: null };

  const { search = "", sortOrder = "DESC", limit = 100, offset = 0 } = opts;
  const sortCol = (opts.sortCol ?? "qty_90d").replace(/^i\./, "");

  const ttmOrderNumbers = await getTtmOrderNumbers(pool);
  if (ttmOrderNumbers.length === 0) return { rows: [], totals: null };

  // $1 = ttmOrderNumbers array; subsequent params start at $2
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
        dataParams,
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
        params,
      ),
    ]);
    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  } catch (err) {
    console.error("[getCustomTtmVelocity] query error:", err);
    return { rows: [], totals: null };
  }
}

// ─── Pre Order ────────────────────────────────────────────────────────────────

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


export async function getLinkPreOrderVelocity(opts: {
  search?: string;
  sortCol?: string;
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<{
    master_sku: string;
    qty_90d: number;
    qty_60d: number;
    qty_30d: number;
    qty_15d: number;
    qty_7d: number;
    total_count: string;
  }>;
  totals: {
    total_90d: string;
    total_60d: string;
    total_30d: string;
    total_15d: string;
    total_7d: string;
    sku_count: string;
  } | null;
}> {
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
        dataParams,
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
        params,
      ),
    ]);
    return { rows: dataRes.rows, totals: totalsRes.rows[0] ?? null };
  } catch (err) {
    console.error("[getLinkPreOrderVelocity] query error:", err);
    return { rows: [], totals: null };
  }
}

export async function getCustomPreOrderForSkus(
  linkMasterSkus: string[],
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
      [linkMasterSkus],
    );
    return new Map(res.rows.map((r) => [r.link_master_sku, { custom_master_sku: r.custom_master_sku, qty_90d: r.qty_90d }]));
  } catch (err) {
    console.error("[getCustomPreOrderForSkus] query error:", err);
    return new Map();
  }
}

export async function getTtmPreOrderForSkus(
  linkMasterSkus: string[],
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
      [linkMasterSkus],
    );
    return new Map(res.rows.map((r) => [r.master_sku, { ttm_master_sku: r.master_sku, count: r.count }]));
  } catch (err) {
    console.error("[getTtmPreOrderForSkus] query error:", err);
    return new Map();
  }
}

export async function getPreOrderTotals(search?: string): Promise<{
  custom_total: string;
  ttm_total: string;
} | null> {
  const pool = getLookupPool();
  if (!pool) return null;
  try {
    const customParams: unknown[] = [];
    const ttmParams: unknown[] = [];
    const searchFilterCustom = search ? `AND c.master_sku ILIKE $${customParams.push(`%${search}%`)}` : "";
    const searchFilterTtm   = search ? `AND v.master_sku ILIKE $${ttmParams.push(`%${search}%`)}` : "";

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
        customParams,
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
        ttmParams,
      ),
    ]);

    return {
      custom_total: String(customRes.rows[0]?.total ?? "0"),
      ttm_total:    String(ttmRes.rows[0]?.total ?? "0"),
    };
  } catch (err) {
    console.error("[getPreOrderTotals] query error:", err);
    return null;
  }
}
