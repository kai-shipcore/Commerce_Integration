import { getLookupPool } from "@/lib/db/supabase-lookup";

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

// Single source of truth for valid sort keys — Service validates incoming
// sortBy against this array; Repository's SORT_BY_MAP below maps each key to
// its actual SQL column (the `Record<OrdersSortBy, string>` annotation there
// forces it to stay in sync with this list at compile time).
export const ORDERS_SORT_KEYS = [
  "orderDate",
  "orderNumber",
  "platformSource",
  "orderStatus",
  "financialStatus",
  "totalPrice",
  "salesChannel",
  "shippingCountry",
  "buyerEmail",
] as const;

export type OrdersSortBy = (typeof ORDERS_SORT_KEYS)[number];

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
  sortBy?: OrdersSortBy;
  sortOrder?: "asc" | "desc";
}

/**
 * Fully-normalized query params, as resolved by OrderService before calling
 * the repository. Repository trusts these values as-is — no re-clamping or
 * re-defaulting — mirroring InventoryRepository's Resolved*Query pattern.
 */
export interface ResolvedOrdersQuery {
  page: number;
  limit: number;
  exportAll: boolean;
  search: string;
  platformSource: string;
  orderStatus: string;
  startDate: string;
  endDate: string;
  skipMeta: boolean;
  sortBy: OrdersSortBy;
  sortOrder: "asc" | "desc";
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

export interface SalesOrderDetail {
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

/**
 * Pure data access for sales orders, sourced from the legacy Supabase lookup
 * DB (`ecommerce_data.sales_orders` / `sales_order_items`). Caching is a
 * Service-layer concern (see order.service.ts).
 */
export const OrderRepository = {
  async queryOrders(resolved: ResolvedOrdersQuery): Promise<SalesOrdersQueryResult> {
    const pool = getLookupPool();

    if (!pool) {
      throw new Error("No lookup database connection configured");
    }

    const { page, limit, search, platformSource, orderStatus, startDate, endDate, exportAll, skipMeta } = resolved;
    const offset = (page - 1) * limit;
    const orderDateDisplaySql =
      "(((so.order_date AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')";
    const sortByMap: Record<OrdersSortBy, string> = {
      orderDate: "so.order_date",
      orderNumber: "so.order_number",
      platformSource: "so.platform_source",
      orderStatus: "so.order_status",
      financialStatus: "so.financial_status",
      totalPrice: "so.total_price",
      salesChannel: "so.sales_channel",
      shippingCountry: "so.shipping_country",
      buyerEmail: "buyer_email",
    };
    const sortBy = sortByMap[resolved.sortBy];
    const sortOrder = resolved.sortOrder === "asc" ? "ASC" : "DESC";
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

      const metaPromise = skipMeta
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

      const queryParams = exportAll
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
        ${exportAll ? "" : `LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`}`,
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
  },

  async getOrderDetail(orderId: number): Promise<SalesOrderDetail | null> {
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
  },
};
