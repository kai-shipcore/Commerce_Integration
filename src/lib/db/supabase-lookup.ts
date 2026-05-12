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
    | "lineCount"
    | "unitCount"
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
    warehouse: "warehouse_code",
    warehouseCount: "warehouse_count",
    onHand: "on_hand_qty",
    allocated: "reserved_qty",
    available: "available_qty",
    backorder: "backorder_qty",
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

  const client = await pool.connect();

  try {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(master_sku ILIKE $${params.length} OR COALESCE(warehouse_code, '') ILIKE $${params.length})`,
      );
    }

    if (warehouse && warehouse !== "all") {
      if (warehouse === "Unspecified") {
        filters.push(`(warehouse_code IS NULL OR warehouse_code = '')`);
      } else {
        params.push(warehouse);
        filters.push(`warehouse_code = $${params.length}`);
      }
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const summaryResult = await client.query<{
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
        COUNT(DISTINCT master_sku)::text AS total_products,
        COUNT(DISTINCT NULLIF(warehouse_code, ''))::text AS total_warehouses,
        COALESCE(SUM(on_hand_qty), 0)::text AS total_on_hand,
        COALESCE(SUM(reserved_qty), 0)::text AS total_allocated,
        COALESCE(SUM(available_qty), 0)::text AS total_available,
        COALESCE(SUM(backorder_qty), 0)::text AS total_backorder
      FROM shipcore.sc_inventory_snapshot
      ${whereClause}`,
      params,
    );

    const warehouseResult = await client.query<{ warehouse: string | null }>(
      `SELECT DISTINCT warehouse_code AS warehouse
      FROM shipcore.sc_inventory_snapshot
      WHERE warehouse_code IS NOT NULL AND warehouse_code <> ''
      ORDER BY warehouse_code ASC`,
    );

    const paginationParams = [...params];

    if (!options.exportAll) {
      paginationParams.push(limit);
      paginationParams.push(offset);
    }

    const result =
      groupBy === "product"
        ? await client.query<{
            master_sku: string;
            on_hand: number | null;
            allocated: number | null;
            available: number | null;
            backorder: number | null;
            warehouse_count: string;
            created_at: Date | string | null;
          }>(
            `SELECT
              master_sku,
              COALESCE(SUM(on_hand_qty), 0) AS on_hand,
              COALESCE(SUM(reserved_qty), 0) AS allocated,
              COALESCE(SUM(available_qty), 0) AS available,
              COALESCE(SUM(backorder_qty), 0) AS backorder,
              COUNT(DISTINCT NULLIF(warehouse_code, ''))::text AS warehouse_count,
              MAX(created_at) AS created_at
            FROM shipcore.sc_inventory_snapshot
            ${whereClause}
            GROUP BY master_sku
            ORDER BY ${sortBy} ${sortOrder}, master_sku ASC
            ${options.exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
            paginationParams,
          )
        : await client.query<{
            master_sku: string;
            on_hand: number | null;
            allocated: number | null;
            available: number | null;
            backorder: number | null;
            warehouse: string | null;
            created_at: Date | string | null;
          }>(
            `SELECT
              master_sku,
              on_hand_qty AS on_hand,
              reserved_qty AS allocated,
              available_qty AS available,
              backorder_qty AS backorder,
              warehouse_code AS warehouse,
              created_at
            FROM shipcore.sc_inventory_snapshot
            ${whereClause}
            ORDER BY ${sortBy} ${sortOrder}, master_sku ASC
            ${options.exportAll ? "" : `LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`}`,
            paginationParams,
          );

    const summary = summaryResult.rows[0];

    return {
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
  } finally {
    client.release();
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
  const sortByMap = {
    orderDate: "so.order_date",
    orderNumber: "so.order_number",
    platformSource: "so.platform_source",
    orderStatus: "so.order_status",
    financialStatus: "so.financial_status",
    totalPrice: "so.total_price",
    lineCount: "line_count",
    unitCount: "unit_count",
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

  const client = await pool.connect();

  try {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      const likeParamIndex = params.length;
      const orderIdFilter = /^\d+$/.test(search)
        ? `OR so.id = $${params.push(Number(search))}`
        : "";
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
          OR COALESCE(so.buyer_email, '') ILIKE $${likeParamIndex}
          OR COALESCE(so.customer_email, '') ILIKE $${likeParamIndex}
          ${orderIdFilter}
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
      filters.push(`so.order_date >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      filters.push(
        `so.order_date < ($${params.length}::date + INTERVAL '1 day')`,
      );
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const summaryResult = await client.query<{
      total_orders: string;
      total_revenue: string | null;
      total_units: string | null;
      total_platforms: string;
    }>(
      `SELECT
        COUNT(DISTINCT so.id)::text AS total_orders,
        COALESCE(SUM(so.total_price), 0)::text AS total_revenue,
        COALESCE(SUM(item_totals.unit_count), 0)::text AS total_units,
        COUNT(DISTINCT so.platform_source)::text AS total_platforms
      FROM ecommerce_data.sales_orders so
      LEFT JOIN (
        SELECT order_id, COALESCE(SUM(net_quantity), 0) AS unit_count
        FROM ecommerce_data.sales_order_items
        GROUP BY order_id
      ) item_totals ON item_totals.order_id = so.id
      ${whereClause}`,
      params,
    );

    let platformSources: string[] = [];
    let orderStatuses: string[] = [];
    if (!options.skipMeta) {
      const [platformResult, orderStatusResult] = await Promise.all([
        client.query<{ platform_source: string }>(
          `SELECT DISTINCT platform_source::text AS platform_source
           FROM ecommerce_data.sales_orders
           ORDER BY platform_source::text ASC`,
        ),
        client.query<{ order_status: string }>(
          `SELECT DISTINCT order_status
           FROM ecommerce_data.sales_orders
           WHERE order_status IS NOT NULL
           ORDER BY order_status ASC`,
        ),
      ]);
      platformSources = platformResult.rows.map((r) => r.platform_source);
      orderStatuses = orderStatusResult.rows.map((r) => r.order_status);
    }

    const queryParams = options.exportAll
      ? [...params]
      : [...params, limit, offset];

    const result = await client.query<{
      id: number;
      platform_source: string;
      external_order_id: string | null;
      order_number: string | null;
      order_date: Date | string | null;
      order_status: string | null;
      total_price: string | null;
      currency: string | null;
      financial_status: string | null;
      buyer_email: string | null;
      shipping_country: string | null;
      sales_channel: string | null;
      line_count: string | number;
      unit_count: string | number;
    }>(
      `SELECT
        so.id,
        so.platform_source::text AS platform_source,
        so.external_order_id,
        so.order_number,
        so.order_date,
        so.order_status,
        COALESCE(so.total_price, 0)::text AS total_price,
        so.currency::text AS currency,
        so.financial_status,
        COALESCE(so.buyer_email, so.customer_email) AS buyer_email,
        so.shipping_country,
        so.sales_channel,
        COUNT(soi.id) AS line_count,
        COALESCE(SUM(soi.net_quantity), 0) AS unit_count
      FROM ecommerce_data.sales_orders so
      LEFT JOIN ecommerce_data.sales_order_items soi ON soi.order_id = so.id
      ${whereClause}
      GROUP BY
        so.id,
        so.platform_source,
        so.external_order_id,
        so.order_number,
        so.order_date,
        so.order_status,
        so.total_price,
        so.currency,
        so.financial_status,
        COALESCE(so.buyer_email, so.customer_email),
        so.shipping_country,
        so.sales_channel
      ORDER BY ${sortBy} ${sortOrder}, so.id DESC
      ${options.exportAll ? "" : `LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`}`,
      queryParams,
    );

    const summary = summaryResult.rows[0];

    // Post-query: resolve master SKUs for the returned page of orders.
    // Two targeted queries (order_id list + sku list) are far cheaper than
    // joining vw_sales_order_items in the main GROUP BY query.
    const orderIds = result.rows.map((r) => r.id);
    const orderMasterSkuMap = new Map<number, { first: string; count: number }>();
    if (orderIds.length > 0) {
      const itemSkuRows = await client.query<{ order_id: number; sku: string }>(
        `SELECT DISTINCT order_id, sku
         FROM ecommerce_data.sales_order_items
         WHERE order_id = ANY($1) AND sku IS NOT NULL`,
        [orderIds],
      );
      if (itemSkuRows.rows.length > 0) {
        const distinctSkus = [...new Set(itemSkuRows.rows.map((r) => r.sku))];
        const skuToMaster = await lookupMasterSkusByOrderSkus(distinctSkus);
        const orderSkusMap = new Map<number, Set<string>>();
        for (const { order_id, sku } of itemSkuRows.rows) {
          const master = skuToMaster.get(sku);
          if (!master) continue;
          const set = orderSkusMap.get(order_id) ?? new Set<string>();
          set.add(master);
          orderSkusMap.set(order_id, set);
        }
        for (const [orderId, masters] of orderSkusMap) {
          const sorted = [...masters].sort();
          orderMasterSkuMap.set(orderId, { first: sorted[0], count: sorted.length });
        }
      }
    }

    return {
      rows: result.rows.map((row) => {
        const msku = orderMasterSkuMap.get(row.id);
        return {
        id: row.id,
        platformSource: row.platform_source,
        externalOrderId: row.external_order_id,
        orderNumber: row.order_number,
        orderDate:
          row.order_date instanceof Date
            ? row.order_date.toISOString()
            : row.order_date,
        orderStatus: row.order_status,
        totalPrice: Number(row.total_price ?? 0),
        currency: row.currency,
        financialStatus: row.financial_status,
        buyerEmail: row.buyer_email,
        shippingCountry: row.shipping_country,
        salesChannel: row.sales_channel,
        lineCount: Number(row.line_count ?? 0),
        unitCount: Number(row.unit_count ?? 0),
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
        totalUnits: Number(summary?.total_units ?? 0),
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
        `SELECT
          soi.id,
          soi.order_id,
          soi.external_line_item_id,
          soi.sku,
          (SELECT v.master_sku
           FROM ecommerce_data.vw_sales_order_items v
           WHERE v.order_sku = soi.sku AND v.master_sku IS NOT NULL
           LIMIT 1) AS master_sku,
          soi.product_name,
          soi.quantity,
          COALESCE(soi.unit_price, 0)::text AS unit_price,
          soi.currency::text AS currency,
          COALESCE(soi.shipping_price, 0)::text AS shipping_price,
          soi.item_status,
          COALESCE(soi.item_tax, 0)::text AS item_tax,
          soi.refunded_quantity,
          soi.net_quantity,
          soi.fulfilled_quantity,
          soi.fulfillment_status
        FROM ecommerce_data.sales_order_items soi
        WHERE soi.order_id = $1
        ORDER BY soi.id ASC`,
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
      orderDate:
        order.order_date instanceof Date
          ? order.order_date.toISOString()
          : order.order_date,
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

export async function lookupMasterSkusByOrderSkus(
  channelSkus: string[],
): Promise<Map<string, string>> {
  if (!channelSkus.length) return new Map();
  const pool = getLookupPool();
  if (!pool) return new Map();
  try {
    const res = await pool.query<{ order_sku: string; master_sku: string }>(
      `SELECT DISTINCT ON (order_sku) order_sku, master_sku
       FROM ecommerce_data.vw_sales_order_items
       WHERE order_sku = ANY($1)
         AND master_sku IS NOT NULL`,
      [channelSkus],
    );
    return new Map(res.rows.map((r) => [r.order_sku, r.master_sku]));
  } catch (err) {
    console.error("[lookupMasterSkusByOrderSkus] query error:", err);
    return new Map();
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
    "(order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'",
    "(order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'",
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
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_90d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_60d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_30d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_15d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_7d
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
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'",
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'",
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
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_90d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_60d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_30d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_15d,
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::text AS total_7d
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
    "(order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'",
    "(order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'",
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
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
        COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'",
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'",
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
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '61 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_60d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '31 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_30d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '16 days' AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_15d,
        COUNT(CASE WHEN (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '8 days'  AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_7d
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
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'",
    "(v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'",
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
         COUNT(CASE WHEN (order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days' AND (order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days' THEN 1 END)::int AS qty_90d
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
         AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'
         AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'
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
           AND (c.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'
           AND (c.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'
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
           AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '91 days'
           AND (v.order_date AT TIME ZONE 'America/Los_Angeles')::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '2 days'
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
