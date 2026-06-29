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

export interface CoverlandInventoryRow {
  masterSku: string;
  onHand: number;
  allocated: number;
  available: number;
  backorder: number;
  warehouse: string | null;
  warehouseCount?: number;
  createdAt: string | null;
}

export interface CoverlandInventoryQueryOptions {
  page?: number;
  limit?: number;
  exportAll?: boolean;
  groupBy?: "warehouse" | "product";
  search?: string;
  warehouse?: string;
  sortBy?:
    | "masterSku"
    | "warehouse"
    | "warehouseCount"
    | "onHand"
    | "allocated"
    | "available"
    | "backorder"
    | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface CoverlandInventoryQueryResult {
  rows: CoverlandInventoryRow[];
  totalRows: number;
  totalProducts: number;
  totalWarehouses: number;
  totals: {
    onHand: number;
    allocated: number;
    available: number;
    backorder: number;
  };
  warehouses: string[];
}

export interface SalesOrderRow {
  id: number;
  platformSource: string;
  externalOrderId: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  totalPrice: number;
  currency: string | null;
  financialStatus: string | null;
  buyerEmail: string | null;
  shippingCountry: string | null;
  salesChannel: string | null;
  lineCount: number;
  unitCount: number;
  webSku: string | null;
  webSkuCount: number;
  masterSku: string | null;
  masterSkuCount: number;
}

export interface SalesOrderItemRow {
  id: number;
  orderId: number;
  externalLineItemId: string | null;
  sku: string | null;
  masterSku: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  currency: string | null;
  shippingPrice: number;
  itemStatus: string | null;
  itemTax: number;
  refundedQuantity: number;
  netQuantity: number;
  fulfilledQuantity: number;
  fulfillmentStatus: string | null;
}

export interface SalesOrdersQueryOptions {
  page?: number;
  limit?: number;
  exportAll?: boolean;
  search?: string;
  platformSource?: string;
  orderStatus?: string;
  startDate?: string;
  endDate?: string;
  skipMeta?: boolean;
  sortBy?:
    | "orderDate"
    | "orderNumber"
    | "platformSource"
    | "orderStatus"
    | "financialStatus"
    | "totalPrice"
    | "salesChannel"
    | "shippingCountry"
    | "buyerEmail";
  sortOrder?: "asc" | "desc";
}

export interface SalesOrdersQueryResult {
  rows: SalesOrderRow[];
  totalRows: number;
  platformSources: string[];
  orderStatuses: string[];
  summary: {
    totalOrders: number;
    totalRevenue: number;
    totalUnits: number;
    totalPlatforms: number;
  };
}

function isOrderIdentifierSearch(search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) return true;

  const withoutHash = trimmed.replace(/^#/, "");
  if (/^[a-zA-Z]{1,8}-?\d+[a-zA-Z0-9-]*$/.test(withoutHash)) {
    return !withoutHash.toUpperCase().startsWith("CL-SC-");
  }

  return false;
}

function isMasterSkuSearch(search: string): boolean {
  return /^[A-Z]{2}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)+$/i.test(search.trim());
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

/**
 * Read the external inventory snapshot from the lookup database.
 */
export async function getCoverlandInventory(
  options: CoverlandInventoryQueryOptions = {},
): Promise<CoverlandInventoryQueryResult> {
  const pool = getLookupPool();

  if (!pool) {
    throw new Error("No lookup database connection configured");
  }

  const page = Math.max(1, options.page ?? 1);
  const limit = options.exportAll
    ? Math.max(1, Math.min(100000, options.limit ?? 100000))
    : Math.max(1, Math.min(200, options.limit ?? 20));
  const offset = (page - 1) * limit;
  const search = options.search?.trim() ?? "";
  const warehouse = options.warehouse?.trim() ?? "";
  const groupBy = options.groupBy ?? "warehouse";
  const sortByMap = {
    masterSku: "master_sku",
    warehouse: "warehouse",
    warehouseCount: "warehouse_count",
    onHand: "on_hand",
    allocated: "allocated",
    available: "available",
    backorder: "backorder",
    createdAt: "created_at",
  } as const;
  const requestedSortBy =
    options.sortBy && options.sortBy in sortByMap
      ? options.sortBy
      : "masterSku";
  const normalizedSortBy =
    groupBy === "product" && requestedSortBy === "warehouse"
      ? "masterSku"
      : groupBy !== "product" && requestedSortBy === "warehouseCount"
        ? "masterSku"
        : requestedSortBy;
  const sortBy = sortByMap[normalizedSortBy];
  const sortOrder = options.sortOrder === "desc" ? "DESC" : "ASC";

  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (search) {
    params.push(`%${search}%`);
    filters.push(`btrim(master_sku) ILIKE $${params.length}`);
  }

  if (warehouse && warehouse !== "all") {
    if (warehouse === "Unspecified") {
      filters.push(`(warehouse IS NULL OR warehouse = '')`);
    } else {
      params.push(warehouse);
      filters.push(`warehouse = $${params.length}`);
    }
  }

  const whereClause =
    filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const paginationParams = [...params];
  if (!options.exportAll) {
    paginationParams.push(limit);
    paginationParams.push(offset);
  }

  const cacheKey = `inventory:v2:${groupBy}:${page}:${limit}:${sortBy}:${sortOrder}:${search}:${warehouse}`;
  if (!options.exportAll) {
    const cached = await CacheManager.get<CoverlandInventoryQueryResult>(cacheKey);
    if (cached) return cached;
  }

  const [summaryResult, warehouseResult, result] = await Promise.all([
    pool.query<{
      total_rows: string;
      total_products: string;
      total_warehouses: string;
      total_on_hand: string | null;
      total_allocated: string | null;
      total_available: string | null;
      total_backorder: string | null;
    }>(
      `SELECT
        COUNT(*)::text AS total_rows,
        COUNT(DISTINCT btrim(master_sku)) FILTER (WHERE master_sku IS NOT NULL AND btrim(master_sku) <> '')::text AS total_products,
        COUNT(DISTINCT NULLIF(warehouse, ''))::text AS total_warehouses,
        COALESCE(SUM(on_hand), 0)::text AS total_on_hand,
        COALESCE(SUM(allocated), 0)::text AS total_allocated,
        COALESCE(SUM(available), 0)::text AS total_available,
        COALESCE(SUM(backorder), 0)::text AS total_backorder
      FROM ecommerce_data.coverland_inventory
      ${whereClause}`,
      params,
    ),
    pool.query<{ warehouse: string | null }>(
      `SELECT DISTINCT warehouse
      FROM ecommerce_data.coverland_inventory
      WHERE warehouse IS NOT NULL AND warehouse <> ''
      ORDER BY warehouse ASC`,
    ),
    groupBy === "product"
      ? pool.query<{
          master_sku: string;
          on_hand: number | null;
          allocated: number | null;
          available: number | null;
          backorder: number | null;
          warehouse_count: string;
          created_at: Date | string | null;
        }>(
          `SELECT
            btrim(master_sku) AS master_sku,
            COALESCE(SUM(on_hand), 0) AS on_hand,
            COALESCE(SUM(allocated), 0) AS allocated,
            COALESCE(SUM(available), 0) AS available,
            COALESCE(SUM(backorder), 0) AS backorder,
            COUNT(DISTINCT NULLIF(warehouse, ''))::text AS warehouse_count,
            MAX(created_at) AS created_at
          FROM ecommerce_data.coverland_inventory
          ${whereClause}
          GROUP BY btrim(master_sku)
          ORDER BY ${sortBy} ${sortOrder}, master_sku ASC
          ${options.exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
          paginationParams,
        )
      : pool.query<{
          master_sku: string;
          on_hand: number | null;
          allocated: number | null;
          available: number | null;
          backorder: number | null;
          warehouse: string | null;
          created_at: Date | string | null;
        }>(
          `SELECT
            btrim(master_sku) AS master_sku,
            on_hand,
            allocated,
            available,
            backorder,
            warehouse,
            created_at
          FROM ecommerce_data.coverland_inventory
          ${whereClause}
          ORDER BY ${sortBy} ${sortOrder}, master_sku ASC
          ${options.exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
          paginationParams,
        ),
  ]);

  const summary = summaryResult.rows[0];

  const response: CoverlandInventoryQueryResult = {
    rows: result.rows.map((row) => ({
      masterSku: row.master_sku,
      onHand: row.on_hand ?? 0,
      allocated: row.allocated ?? 0,
      available: row.available ?? 0,
      backorder: row.backorder ?? 0,
      warehouse: "warehouse" in row ? row.warehouse : null,
      warehouseCount:
        "warehouse_count" in row
          ? Number(row.warehouse_count ?? 0)
          : undefined,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.created_at,
    })),
    totalRows: Number(summary?.total_rows ?? 0),
    totalProducts: Number(summary?.total_products ?? 0),
    totalWarehouses: Number(summary?.total_warehouses ?? 0),
    totals: {
      onHand: Number(summary?.total_on_hand ?? 0),
      allocated: Number(summary?.total_allocated ?? 0),
      available: Number(summary?.total_available ?? 0),
      backorder: Number(summary?.total_backorder ?? 0),
    },
    warehouses: warehouseResult.rows
      .map((row) => row.warehouse)
      .filter((value): value is string => Boolean(value)),
  };

  if (!options.exportAll) {
    await CacheManager.set(cacheKey, response, 120);
  }

  return response;
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

export async function getSalesOrders(
  options: SalesOrdersQueryOptions = {},
): Promise<SalesOrdersQueryResult> {
  const pool = getLookupPool();

  if (!pool) {
    throw new Error("No lookup database connection configured");
  }

  const page = Math.max(1, options.page ?? 1);
  const limit = options.exportAll
    ? Math.max(1, Math.min(100000, options.limit ?? 100000))
    : Math.max(1, Math.min(200, options.limit ?? 20));
  const offset = (page - 1) * limit;
  const search = options.search?.trim() ?? "";
  const platformSource = options.platformSource?.trim() ?? "";
  const startDate = options.startDate?.trim() ?? "";
  const endDate = options.endDate?.trim() ?? "";
  const orderDateDisplaySql =
    "(((so.order_date AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')";
  const sortByMap = {
    orderDate: "so.order_date",
    orderNumber: "so.order_number",
    platformSource: "so.platform_source",
    orderStatus: "so.order_status",
    financialStatus: "so.financial_status",
    totalPrice: "so.total_price",
    salesChannel: "so.sales_channel",
    shippingCountry: "so.shipping_country",
    buyerEmail: "buyer_email",
  } as const;
  const sortBy =
    sortByMap[
      options.sortBy && options.sortBy in sortByMap
        ? options.sortBy
        : "orderDate"
    ];
  const sortOrder = options.sortOrder === "asc" ? "ASC" : "DESC";
  const isFullMasterSkuSearch =
    isMasterSkuSearch(search) && search.split("-").filter(Boolean).length >= 6;
  const normalizedMasterSkuSearch = search.toUpperCase();

  const client = await pool.connect();

  try {
    const filters: string[] = [];
    const params: Array<string | number | string[]> = [];

    if (search) {
      const isNumericId = /^\d+$/.test(search);
      if (isMasterSkuSearch(search)) {
        const directSkuPatterns = Array.from(
          new Set([
            `${normalizedMasterSkuSearch}%`,
            `${search.replace(/^CA-/i, "CL-").toUpperCase()}%`,
            `${search.replace(/^CA-/i, "AF-").toUpperCase()}%`,
          ]),
        );
        params.push(`%${search}%`, directSkuPatterns);
        const likeParamIndex = params.length - 1;
        const directSkuPatternsParamIndex = params.length;
        const masterSkuOrderMatchFilter = isFullMasterSkuSearch
          ? `so.id IN (
              SELECT DISTINCT direct_sku_match.order_id
              FROM ecommerce_data.sales_order_items direct_sku_match
              WHERE UPPER(direct_sku_match.sku) LIKE ANY($${directSkuPatternsParamIndex}::text[])
            )`
          : `so.order_number IN (
              SELECT DISTINCT sku_match.order_number
              FROM ecommerce_data.vw_sales_order_items_link_new sku_match
              WHERE sku_match.master_sku ILIKE $${likeParamIndex}
                AND sku_match.order_number IS NOT NULL
              UNION
              SELECT DISTINCT custom_match.order_number
              FROM ecommerce_data.vw_sales_order_items_custom_new custom_match
              WHERE custom_match.master_sku ILIKE $${likeParamIndex}
                AND custom_match.order_number IS NOT NULL
            )`;
        filters.push(
          `(
            COALESCE(so.order_number, '') ILIKE $${likeParamIndex}
            OR REPLACE(COALESCE(so.order_number, ''), '-', '') ILIKE REPLACE($${likeParamIndex}, '-', '')
            OR COALESCE(so.external_order_id, '') ILIKE $${likeParamIndex}
            OR REPLACE(COALESCE(so.external_order_id, ''), '-', '') ILIKE REPLACE($${likeParamIndex}, '-', '')
            OR ${masterSkuOrderMatchFilter}
          )`,
        );
      } else if (isOrderIdentifierSearch(search)) {
        const withoutHash = search.replace(/^#/, "");
        const withHash = withoutHash.startsWith("#") ? withoutHash : `#${withoutHash}`;
        const compact = withoutHash.replace(/-/g, "").toLowerCase();
        const exactValues = [search, withoutHash, withHash];
        const compactValues = [compact];
        const orderConditions: string[] = [];

        if (isNumericId) {
          params.push(Number(search));
          orderConditions.push(`so.id = $${params.length}`);
          exactValues.push(`#CL-${search}`, `CL-${search}`, `#${search}`);
          compactValues.push(`cl${search}`);
        }

        params.push(
          Array.from(new Set(exactValues.map((value) => value.toLowerCase()))),
          Array.from(new Set(compactValues)),
        );
        const exactParamIndex = params.length - 1;
        const compactParamIndex = params.length;

        orderConditions.push(
          `LOWER(COALESCE(so.order_number, '')) = ANY($${exactParamIndex}::text[])`,
          `LOWER(COALESCE(so.external_order_id, '')) = ANY($${exactParamIndex}::text[])`,
          `LOWER(REPLACE(REPLACE(COALESCE(so.order_number, ''), '#', ''), '-', '')) = ANY($${compactParamIndex}::text[])`,
          `LOWER(REPLACE(REPLACE(COALESCE(so.external_order_id, ''), '#', ''), '-', '')) = ANY($${compactParamIndex}::text[])`,
        );

        filters.push(`(${orderConditions.join(" OR ")})`);
      } else {
        params.push(`%${search}%`);
        const likeParamIndex = params.length;
        const masterSkuFilter = /^[\d-]+$/.test(search)
          ? ""
          : `OR EXISTS (
                    SELECT 1
                    FROM ecommerce_data.vw_sales_order_items sku_lookup
                    WHERE sku_lookup.order_sku = search_soi.sku
                      AND sku_lookup.master_sku ILIKE $${likeParamIndex}
                  )`;
        filters.push(
          `(
            COALESCE(so.order_number, '') ILIKE $${likeParamIndex}
            OR REPLACE(COALESCE(so.order_number, ''), '-', '') ILIKE REPLACE($${likeParamIndex}, '-', '')
            OR COALESCE(so.external_order_id, '') ILIKE $${likeParamIndex}
            OR REPLACE(COALESCE(so.external_order_id, ''), '-', '') ILIKE REPLACE($${likeParamIndex}, '-', '')
            OR EXISTS (
              SELECT 1
              FROM ecommerce_data.sales_order_items search_soi
              WHERE search_soi.order_id = so.id
                AND (
                  COALESCE(search_soi.sku, '') ILIKE $${likeParamIndex}
                  ${masterSkuFilter}
                )
            )
          )`,
        );
      }
    }

    if (platformSource && platformSource !== "all") {
      params.push(platformSource);
      filters.push(`so.platform_source::text = $${params.length}`);
    }

    const orderStatus = options.orderStatus?.trim() ?? "";
    if (orderStatus && orderStatus !== "all") {
      params.push(orderStatus);
      filters.push(`so.order_status = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      filters.push(`${orderDateDisplaySql} >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      filters.push(
        `${orderDateDisplaySql} < ($${params.length}::date + INTERVAL '1 day')`,
      );
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    // Fix A+B: fire summary and meta on pool (separate connections) in parallel with main query
    // totalUnits is intentionally omitted — joining sales_order_items for a full aggregate
    // over all filtered orders adds 8+ seconds; the UI computes it from the displayed page rows.
    const summaryPromise = pool.query<{
      total_orders: string;
      total_revenue: string | null;
      total_platforms: string;
    }>(
      `SELECT
        COUNT(*)::text AS total_orders,
        COALESCE(SUM(so.total_price), 0)::text AS total_revenue,
        COUNT(DISTINCT so.platform_source)::text AS total_platforms
      FROM ecommerce_data.sales_orders so
      ${whereClause}`,
      params,
    );

    const metaPromise = options.skipMeta
      ? Promise.resolve(null)
      : Promise.all([
          pool.query<{ platform_source: string }>(
            `SELECT DISTINCT platform_source::text AS platform_source
             FROM ecommerce_data.sales_orders
             ORDER BY platform_source::text ASC`,
          ),
          pool.query<{ order_status: string }>(
            `SELECT DISTINCT order_status
             FROM ecommerce_data.sales_orders
             WHERE order_status IS NOT NULL
             ORDER BY order_status ASC`,
          ),
        ]);

    const queryParams = options.exportAll
      ? [...params]
      : [...params, limit, offset];

    const result = await client.query<{
      id: number;
      platform_source: string;
      external_order_id: string | null;
      order_number: string | null;
      order_date: Date | string | null;
      order_date_display: string | null;
      order_status: string | null;
      total_price: string | null;
      currency: string | null;
      financial_status: string | null;
      buyer_email: string | null;
      shipping_country: string | null;
      sales_channel: string | null;
    }>(
      `SELECT
        so.id,
        so.platform_source::text AS platform_source,
        so.external_order_id,
        so.order_number,
        so.order_date,
        to_char(so.order_date AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS order_date_display,
        so.order_status,
        COALESCE(so.total_price, 0)::text AS total_price,
        so.currency::text AS currency,
        so.financial_status,
        COALESCE(so.buyer_email, so.customer_email) AS buyer_email,
        so.shipping_country,
        so.sales_channel
      FROM ecommerce_data.sales_orders so
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}, so.id DESC
      ${options.exportAll ? "" : `LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`}`,
      queryParams,
    );
    const orderIds = result.rows.map((r) => r.id);

    const resolveOrderItemData = async (): Promise<{
      masterSkuMap: Map<number, { first: string; count: number }>;
      countsMap: Map<number, { lineCount: number; unitCount: number }>;
      webSkuMap: Map<number, { first: string; count: number }>;
    }> => {
      const masterSkuMap = new Map<number, { first: string; count: number }>();
      const countsMap = new Map<number, { lineCount: number; unitCount: number }>();
      const webSkuMap = new Map<number, { first: string; count: number }>();
      if (orderIds.length === 0) return { masterSkuMap, countsMap, webSkuMap };

      if (isFullMasterSkuSearch) {
        const rows = await client.query<{
          order_id: number;
          line_count: string;
          unit_count: string;
          order_skus: string[] | null;
        }>(
          `SELECT
             soi.order_id,
             COUNT(soi.id)::text AS line_count,
             COALESCE(SUM(soi.net_quantity), 0)::text AS unit_count,
             array_agg(DISTINCT soi.sku) FILTER (WHERE soi.sku IS NOT NULL) AS order_skus
           FROM ecommerce_data.sales_order_items soi
           WHERE soi.order_id = ANY($1)
           GROUP BY soi.order_id`,
          [orderIds],
        );

        for (const row of rows.rows) {
          countsMap.set(row.order_id, {
            lineCount: Number(row.line_count),
            unitCount: Number(row.unit_count),
          });
          const wskus = row.order_skus;
          if (wskus && wskus.length > 0) {
            const sorted = [...wskus].sort();
            webSkuMap.set(row.order_id, { first: sorted[0], count: sorted.length });
          }
          masterSkuMap.set(row.order_id, { first: normalizedMasterSkuSearch, count: 1 });
        }

        return { masterSkuMap, countsMap, webSkuMap };
      }

      // Inline the view logic with an upfront order_id filter so only the
      // 20 returned rows are processed — avoids a full vw_sales_order_items scan.
      const rows = await client.query<{
        order_id: number;
        line_count: string;
        unit_count: string;
        order_skus: string[] | null;
        master_skus: string[] | null;
      }>(
        `WITH order_items AS (
           SELECT soi.order_id, soi.id, COALESCE(soi.net_quantity, 0) AS net_quantity, soi.sku AS order_sku
           FROM ecommerce_data.sales_order_items soi
           WHERE soi.order_id = ANY($1)
         ),
         item_counts AS (
           SELECT order_id, COUNT(id)::text AS line_count, SUM(net_quantity)::text AS unit_count
           FROM order_items GROUP BY order_id
         ),
         normalized AS (
           SELECT
             oi.order_id, oi.order_sku,
             CASE
               WHEN (length(oi.order_sku) >= 31) AND (oi.order_sku LIKE 'CL-SC-10-%') THEN
                 'CL-SC-10-' || sz.cfront_size || '-' || sz.crear_size || '-' ||
                 array_to_string((string_to_array(oi.order_sku, '-'))[8:10], '-')
               WHEN oi.order_sku LIKE 'CL-SC-10-%' THEN
                 CASE
                   WHEN (oi.order_sku LIKE ('%' || sz.cfront_size || '%')
                      OR oi.order_sku LIKE ('%' || sz.crear_size || '%')
                      OR oi.order_sku LIKE ('%' || sz.cthird_size || '%')) THEN oi.order_sku
                   WHEN (sz.crear_size NOT LIKE '%NEW%' AND sz.crear_size NOT LIKE '%INV%'
                      AND (oi.order_sku LIKE 'CL-SC-10-B-%' OR oi.order_sku LIKE 'CL-SC-10-R-%'))
                     THEN 'CL-SC-10-' || sz.crear_size || '-' || array_to_string((string_to_array(oi.order_sku, '-'))[6:8], '-')
                   WHEN oi.order_sku LIKE 'CL-SC-10-F-%'
                     THEN 'CL-SC-10-' || sz.cfront_size || '-' || array_to_string((string_to_array(oi.order_sku, '-'))[6:8], '-')
                   WHEN (sz.cthird_size NOT LIKE '%NEW%' AND sz.cthird_size NOT LIKE '%INV%' AND oi.order_sku LIKE 'CL-SC-10-E-%')
                     THEN 'CL-SC-10-' || sz.cthird_size || '-' || array_to_string((string_to_array(oi.order_sku, '-'))[6:8], '-')
                   ELSE oi.order_sku
                 END
               ELSE NULL
             END AS new_sku
           FROM order_items oi
           LEFT JOIN size_chart_dev.seat_cover_size_chart_temp sz
             ON sz.f_number = regexp_replace(oi.order_sku, '.*-(\\d+)$', '\\1')
           WHERE oi.order_sku IS NOT NULL
         ),
         with_master AS (
           SELECT n.order_id, n.order_sku, COALESCE(n.new_sku, n.order_sku) AS forecasting_sku,
                  fn.master_sku_parse1
           FROM normalized n,
           LATERAL size_chart.fn_extract_master_sku_from_web_sku(COALESCE(n.new_sku, n.order_sku)::varchar)
             fn(master_sku_parse1, master_sku_parse2, master_sku_parse3)
         ),
         master_final AS (
           SELECT DISTINCT order_id, master_sku_parse1 AS master_sku
           FROM with_master WHERE master_sku_parse1 IS NOT NULL AND master_sku_parse1 != ''
           UNION
           SELECT DISTINCT wm.order_id, kc.component_sku::text AS master_sku
           FROM with_master wm
           JOIN ecommerce_data.shiphero_kit_components kc ON wm.forecasting_sku = kc.parent_kit_sku::text
           WHERE (wm.master_sku_parse1 IS NULL OR wm.master_sku_parse1 = '')
         )
         SELECT ic.order_id, ic.line_count, ic.unit_count,
                array_agg(DISTINCT n.order_sku) FILTER (WHERE n.order_sku IS NOT NULL) AS order_skus,
                array_agg(DISTINCT mf.master_sku) FILTER (WHERE mf.master_sku IS NOT NULL) AS master_skus
         FROM item_counts ic
         LEFT JOIN normalized n ON n.order_id = ic.order_id
         LEFT JOIN master_final mf ON mf.order_id = ic.order_id
         GROUP BY ic.order_id, ic.line_count, ic.unit_count`,
        [orderIds],
      );

      for (const row of rows.rows) {
        countsMap.set(row.order_id, {
          lineCount: Number(row.line_count),
          unitCount: Number(row.unit_count),
        });
        const wskus = row.order_skus;
        if (wskus && wskus.length > 0) {
          const sorted = [...wskus].sort();
          webSkuMap.set(row.order_id, { first: sorted[0], count: sorted.length });
        }
        const skus = row.master_skus;
        if (skus && skus.length > 0) {
          const sorted = [...skus].sort();
          masterSkuMap.set(row.order_id, { first: sorted[0], count: sorted.length });
        }
      }

      return { masterSkuMap, countsMap, webSkuMap };
    };

    const [summaryResult, metaResult, { masterSkuMap: orderMasterSkuMap, countsMap: orderCountsMap, webSkuMap: orderWebSkuMap }] = await Promise.all([
      summaryPromise,
      metaPromise,
      resolveOrderItemData(),
    ]);

    let platformSources: string[] = [];
    let orderStatuses: string[] = [];
    if (metaResult) {
      platformSources = metaResult[0].rows.map((r) => r.platform_source);
      orderStatuses = metaResult[1].rows.map((r) => r.order_status);
    }

    const summary = summaryResult.rows[0];

    return {
      rows: result.rows.map((row) => {
        const msku = orderMasterSkuMap.get(row.id);
        const wsku = orderWebSkuMap.get(row.id);
        return {
        id: row.id,
        platformSource: row.platform_source,
        externalOrderId: row.external_order_id,
        orderNumber: row.order_number,
        orderDate: row.order_date_display ?? (
          row.order_date instanceof Date
            ? row.order_date.toISOString()
            : row.order_date
        ),
        orderStatus: row.order_status,
        totalPrice: Number(row.total_price ?? 0),
        currency: row.currency,
        financialStatus: row.financial_status,
        buyerEmail: row.buyer_email,
        shippingCountry: row.shipping_country,
        salesChannel: row.sales_channel,
        lineCount: orderCountsMap.get(row.id)?.lineCount ?? 0,
        unitCount: orderCountsMap.get(row.id)?.unitCount ?? 0,
        webSku: wsku?.first ?? null,
        webSkuCount: wsku?.count ?? 0,
        masterSku: msku?.first ?? null,
        masterSkuCount: msku?.count ?? 0,
        };
      }),
      totalRows: Number(summary?.total_orders ?? 0),
      platformSources,
      orderStatuses,
      summary: {
        totalOrders: Number(summary?.total_orders ?? 0),
        totalRevenue: Number(summary?.total_revenue ?? 0),
        totalUnits: 0,
        totalPlatforms: Number(summary?.total_platforms ?? 0),
      },
    };
  } finally {
    client.release();
  }
}

export async function getSalesOrderDetail(orderId: number): Promise<{
  id: number;
  platformSource: string;
  externalOrderId: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  totalPrice: number;
  currency: string | null;
  financialStatus: string | null;
  buyerEmail: string | null;
  shippingCountry: string | null;
  fulfillmentChannel: string | null;
  salesChannel: string | null;
  subtotalPrice: number;
  shippingPrice: number;
  taxPrice: number;
  lineItems: SalesOrderItemRow[];
} | null> {
  const pool = getLookupPool();

  if (!pool) {
    throw new Error("No lookup database connection configured");
  }

  const client = await pool.connect();

  try {
    const [orderResult, itemsResult] = await Promise.all([
      client.query<{
        id: number;
        platform_source: string;
        external_order_id: string | null;
        order_number: string | null;
        order_date: Date | string | null;
        order_date_display: string | null;
        order_status: string | null;
        total_price: string | null;
        currency: string | null;
        financial_status: string | null;
        buyer_email: string | null;
        shipping_country: string | null;
        fulfillment_channel: string | null;
        sales_channel: string | null;
      }>(
        `SELECT
          id,
          platform_source::text AS platform_source,
          external_order_id,
          order_number,
          order_date,
          to_char(order_date AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS order_date_display,
          order_status,
          COALESCE(total_price, 0)::text AS total_price,
          currency::text AS currency,
          financial_status,
          COALESCE(buyer_email, customer_email) AS buyer_email,
          shipping_country,
          fulfillment_channel,
          sales_channel
        FROM ecommerce_data.sales_orders
        WHERE id = $1`,
        [orderId],
      ),
      client.query<{
        id: number;
        order_id: number;
        external_line_item_id: string | null;
        sku: string | null;
        master_sku: string | null;
        product_name: string | null;
        quantity: number | null;
        unit_price: string | null;
        currency: string | null;
        shipping_price: string | null;
        item_status: string | null;
        item_tax: string | null;
        refunded_quantity: number | null;
        net_quantity: number | null;
        fulfilled_quantity: number | null;
        fulfillment_status: string | null;
      }>(
        `WITH normalized AS (
           SELECT
             soi.id, soi.order_id, soi.external_line_item_id, soi.sku, soi.product_name,
             soi.quantity, soi.unit_price, soi.currency, soi.shipping_price, soi.item_status,
             soi.item_tax, soi.refunded_quantity, soi.net_quantity, soi.fulfilled_quantity,
             soi.fulfillment_status,
             CASE
               WHEN (length(soi.sku) >= 31) AND (soi.sku LIKE 'CL-SC-10-%') THEN
                 'CL-SC-10-' || sz.cfront_size || '-' || sz.crear_size || '-' ||
                 array_to_string((string_to_array(soi.sku, '-'))[8:10], '-')
               WHEN soi.sku LIKE 'CL-SC-10-%' THEN
                 CASE
                   WHEN (soi.sku LIKE ('%' || sz.cfront_size || '%')
                      OR soi.sku LIKE ('%' || sz.crear_size || '%')
                      OR soi.sku LIKE ('%' || sz.cthird_size || '%')) THEN soi.sku
                   WHEN (sz.crear_size NOT LIKE '%NEW%' AND sz.crear_size NOT LIKE '%INV%'
                      AND (soi.sku LIKE 'CL-SC-10-B-%' OR soi.sku LIKE 'CL-SC-10-R-%'))
                     THEN 'CL-SC-10-' || sz.crear_size || '-' || array_to_string((string_to_array(soi.sku, '-'))[6:8], '-')
                   WHEN soi.sku LIKE 'CL-SC-10-F-%'
                     THEN 'CL-SC-10-' || sz.cfront_size || '-' || array_to_string((string_to_array(soi.sku, '-'))[6:8], '-')
                   WHEN (sz.cthird_size NOT LIKE '%NEW%' AND sz.cthird_size NOT LIKE '%INV%' AND soi.sku LIKE 'CL-SC-10-E-%')
                     THEN 'CL-SC-10-' || sz.cthird_size || '-' || array_to_string((string_to_array(soi.sku, '-'))[6:8], '-')
                   ELSE soi.sku
                 END
               ELSE NULL
             END AS new_sku
           FROM ecommerce_data.sales_order_items soi
           LEFT JOIN size_chart_dev.seat_cover_size_chart_temp sz
             ON sz.f_number = regexp_replace(soi.sku, '.*-(\\d+)$', '\\1')
           WHERE soi.order_id = $1 AND soi.sku IS NOT NULL
         ),
         with_master AS (
           SELECT n.*,
                  COALESCE(n.new_sku, n.sku) AS forecasting_sku,
                  fn.master_sku_parse1
           FROM normalized n,
           LATERAL size_chart.fn_extract_master_sku_from_web_sku(COALESCE(n.new_sku, n.sku)::varchar)
             fn(master_sku_parse1, master_sku_parse2, master_sku_parse3)
         )
         SELECT
           wm.id, wm.order_id, wm.external_line_item_id, wm.sku,
           CASE
             WHEN wm.master_sku_parse1 IS NOT NULL AND wm.master_sku_parse1 != ''
               THEN wm.master_sku_parse1
             ELSE (SELECT kc.component_sku::text FROM ecommerce_data.shiphero_kit_components kc
                   WHERE kc.parent_kit_sku::text = wm.forecasting_sku LIMIT 1)
           END AS master_sku,
           wm.product_name, wm.quantity,
           COALESCE(wm.unit_price, 0)::text AS unit_price,
           wm.currency::text AS currency,
           COALESCE(wm.shipping_price, 0)::text AS shipping_price,
           wm.item_status,
           COALESCE(wm.item_tax, 0)::text AS item_tax,
           wm.refunded_quantity, wm.net_quantity, wm.fulfilled_quantity, wm.fulfillment_status
         FROM with_master wm
         ORDER BY wm.id ASC`,
        [orderId],
      ),
    ]);

    if (orderResult.rows.length === 0) {
      return null;
    }

    const order = orderResult.rows[0];

    const lineItems = itemsResult.rows.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      externalLineItemId: item.external_line_item_id,
      sku: item.sku,
      masterSku: item.master_sku ?? null,
      productName: item.product_name,
      quantity: item.quantity ?? 0,
      unitPrice: Number(item.unit_price ?? 0),
      currency: item.currency,
      shippingPrice: Number(item.shipping_price ?? 0),
      itemStatus: item.item_status,
      itemTax: Number(item.item_tax ?? 0),
      refundedQuantity: item.refunded_quantity ?? 0,
      netQuantity: item.net_quantity ?? 0,
      fulfilledQuantity: item.fulfilled_quantity ?? 0,
      fulfillmentStatus: item.fulfillment_status,
    }));

    const totalPrice = Number(order.total_price ?? 0);
    const shippingPrice = lineItems.reduce(
      (sum, item) => sum + item.shippingPrice,
      0,
    );
    const itemTaxPrice = lineItems.reduce((sum, item) => sum + item.itemTax, 0);
    const calculatedSubtotal = lineItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const inferredTaxPrice = totalPrice - calculatedSubtotal - shippingPrice;
    const taxPrice =
      itemTaxPrice > 0 ? itemTaxPrice : Math.max(0, inferredTaxPrice);
    const subtotalPrice = calculatedSubtotal;

    return {
      id: order.id,
      platformSource: order.platform_source,
      externalOrderId: order.external_order_id,
      orderNumber: order.order_number,
      orderDate: order.order_date_display ?? (
        order.order_date instanceof Date
          ? order.order_date.toISOString()
          : order.order_date
      ),
      orderStatus: order.order_status,
      totalPrice: Number(order.total_price ?? 0),
      currency: order.currency,
      financialStatus: order.financial_status,
      buyerEmail: order.buyer_email,
      shippingCountry: order.shipping_country,
      fulfillmentChannel: order.fulfillment_channel,
      salesChannel: order.sales_channel,
      subtotalPrice,
      shippingPrice,
      taxPrice,
      lineItems,
    };
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
