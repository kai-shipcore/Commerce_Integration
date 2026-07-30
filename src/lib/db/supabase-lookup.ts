/**
 * Code Guide:
 * Read-only helpers for the Supabase lookup database (SUPABASE_LOOKUP_DATABASE_URL).
 * Covers master SKU resolution, inventory display, and order feeds sourced from the old Supabase.
 * Write helpers for the primary (new) DB live in primary-db.ts.
 */

import { Pool } from "pg";
import { readFile } from "node:fs/promises";


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
