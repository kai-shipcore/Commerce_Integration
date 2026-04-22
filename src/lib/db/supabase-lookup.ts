/**
 * Code Guide:
 * Database helper module.
 * Connection setup and external lookup helpers live here so data access stays consistent across the app.
 */

import { Pool } from "pg";
import { readFile } from "node:fs/promises";

// Separate connection pool for the Supabase project with size_chart_dev schema
let lookupPool: Pool | null = null;

function getLookupConnectionString(): string | null {
  return process.env.SUPABASE_LOOKUP_DATABASE_URL || process.env.DATABASE_URL || null;
}

function getLookupPool(): Pool | null {
  const connectionString = getLookupConnectionString();

  if (!connectionString) {
    return null;
  }

  if (!lookupPool) {
    lookupPool = new Pool({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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
}

export interface SalesOrderItemRow {
  id: number;
  orderId: number;
  externalLineItemId: string | null;
  sku: string | null;
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
  startDate?: string;
  endDate?: string;
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

/**
 * Lookup master SKUs using the size_chart.fn_extract_master_sku_from_web_sku function
 * from the separate Supabase project
 */
export async function lookupMasterSkusFromSupabase(
  webSkus: string[]
): Promise<Map<string, { parse1: string; parse2: string | null; parse3: string | null }> | null> {
  const pool = getLookupPool();

  if (!pool) {
    console.warn("No lookup database connection configured. Master SKU lookup disabled.");
    return null;
  }

  if (webSkus.length === 0) {
    return new Map();
  }

  const masterSkuMap = new Map<string, { parse1: string; parse2: string | null; parse3: string | null }>();

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
        [webSkus]
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
    console.error("Error looking up master SKUs from Supabase:", getErrorMessage(error));

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
export async function testLookupConnection(): Promise<{
  available: boolean;
  error?: string;
}> {
  const pool = getLookupPool();

  if (!pool) {
    return {
      available: false,
      error: "No lookup database connection configured"
    };
  }

  try {
    const client = await pool.connect();
    try {
      // Test the function exists
      await client.query(
        `SELECT (size_chart.fn_extract_master_sku_from_web_sku('test')).master_sku_parse1`
      );
      return { available: true };
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    return {
      available: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * Read the external inventory snapshot from the lookup database.
 */
export async function getCoverlandInventory(
  options: CoverlandInventoryQueryOptions = {}
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
    options.sortBy && options.sortBy in sortByMap ? options.sortBy : "masterSku";
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
        `(master_sku ILIKE $${params.length} OR COALESCE(warehouse_code, '') ILIKE $${params.length})`
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

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

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
      params
    );

    const warehouseResult = await client.query<{ warehouse: string | null }>(
      `SELECT DISTINCT warehouse_code AS warehouse
      FROM shipcore.sc_inventory_snapshot
      WHERE warehouse_code IS NOT NULL AND warehouse_code <> ''
      ORDER BY warehouse_code ASC`
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
            paginationParams
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
            paginationParams
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
          "warehouse_count" in row ? Number(row.warehouse_count ?? 0) : undefined,
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
  sqlFilePath: string
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
  options: SalesOrdersQueryOptions = {}
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
      options.sortBy && options.sortBy in sortByMap ? options.sortBy : "orderDate"
    ];
  const sortOrder = options.sortOrder === "asc" ? "ASC" : "DESC";

  const client = await pool.connect();

  try {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(
          COALESCE(so.order_number, '') ILIKE $${params.length}
          OR COALESCE(so.external_order_id, '') ILIKE $${params.length}
          OR COALESCE(so.buyer_email, '') ILIKE $${params.length}
          OR COALESCE(so.customer_email, '') ILIKE $${params.length}
        )`
      );
    }

    if (platformSource && platformSource !== "all") {
      params.push(platformSource);
      filters.push(`so.platform_source::text = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      filters.push(`so.order_date >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      filters.push(`so.order_date < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

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
      FROM shipcore.sc_sales_orders so
      LEFT JOIN (
        SELECT order_id, COALESCE(SUM(net_quantity), 0) AS unit_count
        FROM ecommerce_data.sales_order_items
        GROUP BY order_id
      ) item_totals ON item_totals.order_id = so.id
      ${whereClause}`,
      params
    );

    const platformResult = await client.query<{ platform_source: string }>(
      `SELECT DISTINCT platform_source::text AS platform_source
       FROM ecommerce_data.sales_orders
       ORDER BY platform_source::text ASC`
    );

    const queryParams = options.exportAll ? [...params] : [...params, limit, offset];

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
      queryParams
    );

    const summary = summaryResult.rows[0];

    return {
      rows: result.rows.map((row) => ({
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
      })),
      totalRows: Number(summary?.total_orders ?? 0),
      platformSources: platformResult.rows.map((row) => row.platform_source),
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

export async function getSalesOrderDetail(
  orderId: number
): Promise<{
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
  lineItems: SalesOrderItemRow[];
} | null> {
  const pool = getLookupPool();

  if (!pool) {
    throw new Error("No lookup database connection configured");
  }

  const client = await pool.connect();

  try {
    const orderResult = await client.query<{
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
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return null;
    }

    const itemsResult = await client.query<{
      id: number;
      order_id: number;
      external_line_item_id: string | null;
      sku: string | null;
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
        id,
        order_id,
        external_line_item_id,
        sku,
        product_name,
        quantity,
        COALESCE(unit_price, 0)::text AS unit_price,
        currency::text AS currency,
        COALESCE(shipping_price, 0)::text AS shipping_price,
        item_status,
        COALESCE(item_tax, 0)::text AS item_tax,
        refunded_quantity,
        net_quantity,
        fulfilled_quantity,
        fulfillment_status
      FROM ecommerce_data.sales_order_items
      WHERE order_id = $1
      ORDER BY id ASC`,
      [orderId]
    );

    const order = orderResult.rows[0];

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
      lineItems: itemsResult.rows.map((item) => ({
        id: item.id,
        orderId: item.order_id,
        externalLineItemId: item.external_line_item_id,
        sku: item.sku,
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
      })),
    };
  } finally {
    client.release();
  }
}
