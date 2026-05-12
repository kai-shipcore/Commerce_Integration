/**
 * Code Guide:
 * Connection pool and write helpers for the primary PostgreSQL database (DATABASE_URL).
 * All sync functions that write to the new DB live here.
 * Read-only helpers for the old Supabase lookup DB live in supabase-lookup.ts.
 */

import { Pool } from "pg";
import { getLookupPool } from "./supabase-lookup";

let primaryPool: Pool | null = null;

export function getPrimaryPool(): Pool {
  if (!primaryPool) {
    primaryPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "",
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return primaryPool;
}

function inferCategory(sku: string): string | null {
  const upper = sku.toUpperCase();
  // Strip ICC- prefix for pattern matching
  const normalized = upper.startsWith("ICC-") ? upper.slice(4) : upper;
  const parts = normalized.split("-");
  if (parts[0] === "CC") return "Car Cover";
  if (parts[0] === "FM" || parts[1] === "FM") return "Floor Mat";
  if (parts[0] === "SC" || parts[1] === "SC") return "Seat Cover";
  return null;
}

function inferBrand(sku: string): string {
  if (sku.startsWith("ICC-")) return "iCarCover";
  return "Coverland";
}

export async function syncProductVehicles(): Promise<{ upserted: number; deleted: number }> {
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<Record<string, unknown>>;
  try {
    const result = await lookupClient.query(`
      SELECT id, f_number, vehicle_type, year_generation,
             make, model, model_2,
             submodel_1_label, submodel_1, submodel_2_label, submodel_2,
             submodel_3_label, submodel_3, submodel_4_label, submodel_4,
             submodel_5_label, submodel_5, submodel_6_label, submodel_6,
             created_at, COALESCE(updated_at, created_at, NOW()) AS updated_at
      FROM size_chart.product_vehicle
    `);
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  const primary = getPrimaryPool();
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    await primaryClient.query(`
      CREATE TEMP TABLE stg_pv AS SELECT * FROM shipcore.sc_product_vehicle LIMIT 0
    `);

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 1000) {
        const batch = rows.slice(i, i + 1000);
        const values = batch.map((_, j) => {
          const base = j * 12;
          return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12})`;
        }).join(",");
        const params = batch.flatMap((r) => [
          r.id, r.f_number, r.vehicle_type, r.year_generation,
          r.make, r.model, r.model_2 ?? null,
          r.submodel_1_label ?? null, r.submodel_1 ?? null,
          r.submodel_2_label ?? null, r.submodel_2 ?? null,
          r.updated_at,
        ]);
        await primaryClient.query(
          `INSERT INTO stg_pv (id, f_number, vehicle_type, year_generation,
             make, model, model_2,
             submodel_1_label, submodel_1, submodel_2_label, submodel_2, updated_at)
           VALUES ${values}`,
          params
        );
      }
    }

    const del = await primaryClient.query(`
      DELETE FROM shipcore.sc_product_vehicle pv
      WHERE NOT EXISTS (SELECT 1 FROM stg_pv s WHERE s.id = pv.id)
    `);

    await primaryClient.query(`
      INSERT INTO shipcore.sc_product_vehicle
        (id, f_number, vehicle_type, year_generation,
         make, model, model_2, submodel_1_label, submodel_1,
         submodel_2_label, submodel_2, updated_at)
      SELECT id, f_number, vehicle_type, year_generation,
             make, model, model_2, submodel_1_label, submodel_1,
             submodel_2_label, submodel_2, updated_at
      FROM stg_pv
      ON CONFLICT (id) DO UPDATE SET
        f_number         = EXCLUDED.f_number,
        vehicle_type     = EXCLUDED.vehicle_type,
        year_generation  = EXCLUDED.year_generation,
        make             = EXCLUDED.make,
        model            = EXCLUDED.model,
        model_2          = EXCLUDED.model_2,
        submodel_1_label = EXCLUDED.submodel_1_label,
        submodel_1       = EXCLUDED.submodel_1,
        submodel_2_label = EXCLUDED.submodel_2_label,
        submodel_2       = EXCLUDED.submodel_2,
        updated_at       = EXCLUDED.updated_at
    `);

    await primaryClient.query("COMMIT");
    return { upserted: rows.length, deleted: del.rowCount ?? 0 };
  } catch (e) {
    await primaryClient.query("ROLLBACK");
    throw e;
  } finally {
    primaryClient.release();
  }
}

export async function syncProducts(): Promise<{
  productsUpserted: number;
  productsDeleted: number;
}> {
  // Step 1: Read distinct master_sku + title from size_chart.shopify_db (Supabase)
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<{
    master_sku: string;
    product_name: string;
    product_vehicle_id: number | null;
    sub_category: string | null;
    source_web_sku_example: string | null;
    f_number: string | null;
    vehicle_type_code: string | null;
    make_code: string | null;
    model_code: string | null;
  }>;
  try {
    const result = await lookupClient.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (s.master_sku)
          s.master_sku,
          s.title           AS product_name,
          s.product_vehicle_id,
          s.type            AS sub_category,
          s.variant_sku     AS source_web_sku_example,
          pv.f_number,
          pv.vehicle_type   AS vehicle_type_code,
          pv.make           AS make_code,
          pv.model          AS model_code
        FROM size_chart.shopify_db s
        LEFT JOIN size_chart.product_vehicle pv ON pv.id = s.product_vehicle_id
        WHERE s.master_sku IS NOT NULL AND s.title IS NOT NULL
        ORDER BY s.master_sku, s.updated_at DESC
      ) shopify

      UNION ALL

      SELECT * FROM (
        SELECT DISTINCT ON (variant_sku)
          variant_sku  AS master_sku,
          title        AS product_name,
          NULL::bigint AS product_vehicle_id,
          product_type AS sub_category,
          variant_sku  AS source_web_sku_example,
          NULL::text   AS f_number,
          NULL::text   AS vehicle_type_code,
          NULL::text   AS make_code,
          NULL::text   AS model_code
        FROM ecommerce_data.icc_shopify_data
        WHERE variant_sku IS NOT NULL AND title IS NOT NULL
        ORDER BY variant_sku
      ) icc
    `);
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  const distinctMasterSkus   = rows.map((r) => r.master_sku);
  const productNames         = rows.map((r) => r.product_name);
  const vehicleIds           = rows.map((r) => r.product_vehicle_id ?? null);
  const brands               = rows.map((r) => inferBrand(r.master_sku));
  const subCategories        = rows.map((r) => r.sub_category ?? null);
  const sourceWebSkuExamples = rows.map((r) => r.source_web_sku_example ?? null);
  const fNumbers             = rows.map((r) => r.f_number ?? null);
  const vehicleTypeCodes     = rows.map((r) => r.vehicle_type_code ?? null);
  const makeCodes            = rows.map((r) => r.make_code ?? null);
  const modelCodes           = rows.map((r) => r.model_code ?? null);

  // Step 2: Upsert sc_products in primary DB (transaction)
  const primary = getPrimaryPool();
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    const categories = distinctMasterSkus.map(inferCategory);

    await primaryClient.query(`
      CREATE TEMP TABLE stg_products (
        master_sku TEXT, product_name TEXT, category TEXT, brand TEXT,
        product_vehicle_id BIGINT, sub_category TEXT, source_web_sku_example TEXT,
        f_number TEXT, vehicle_type_code TEXT, make_code TEXT, model_code TEXT
      ) ON COMMIT DROP
    `);

    if (distinctMasterSkus.length > 0) {
      await primaryClient.query(
        `INSERT INTO stg_products
           (master_sku, product_name, category, brand, product_vehicle_id,
            sub_category, source_web_sku_example, f_number, vehicle_type_code, make_code, model_code)
         SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]), unnest($5::bigint[]),
                unnest($6::text[]), unnest($7::text[]), unnest($8::text[]), unnest($9::text[]), unnest($10::text[]), unnest($11::text[])`,
        [distinctMasterSkus, productNames, categories, brands, vehicleIds,
         subCategories, sourceWebSkuExamples, fNumbers, vehicleTypeCodes, makeCodes, modelCodes]
      );
    }

    await primaryClient.query(`CREATE INDEX ON stg_products (master_sku)`);

    await primaryClient.query(`
      INSERT INTO shipcore.sc_products (
        master_sku, product_name, status, category, brand, product_vehicle_id,
        sub_category, source_web_sku_example, f_number, vehicle_type_code, make_code, model_code,
        created_at, updated_at
      )
      SELECT
        master_sku, product_name, 'active', category, brand, product_vehicle_id,
        sub_category, source_web_sku_example, f_number, vehicle_type_code, make_code, model_code,
        NOW(), NOW()
      FROM stg_products
      ON CONFLICT (master_sku) DO UPDATE SET
        product_name           = EXCLUDED.product_name,
        category               = EXCLUDED.category,
        brand                  = EXCLUDED.brand,
        product_vehicle_id     = EXCLUDED.product_vehicle_id,
        sub_category           = EXCLUDED.sub_category,
        source_web_sku_example = EXCLUDED.source_web_sku_example,
        f_number               = EXCLUDED.f_number,
        vehicle_type_code      = EXCLUDED.vehicle_type_code,
        make_code              = EXCLUDED.make_code,
        model_code             = EXCLUDED.model_code,
        updated_at             = NOW()
    `);

    await primaryClient.query("COMMIT");

    return {
      productsUpserted: distinctMasterSkus.length,
      productsDeleted: 0,
    };
  } catch (e) {
    await primaryClient.query("ROLLBACK");
    throw e;
  } finally {
    primaryClient.release();
  }
}

export async function syncSkuMappings(): Promise<{
  mappingsUpserted: number;
  mappingsDeleted: number;
}> {
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<{ parent_kit_sku: string; component_sku: string }>;
  try {
    const result = await lookupClient.query(
      `SELECT parent_kit_sku, component_sku
       FROM ecommerce_data.shiphero_kit_components
       WHERE parent_kit_sku IS NOT NULL AND component_sku IS NOT NULL`
    );
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  // Deduplicate
  const mappingSet = new Map<string, { channel_sku: string; master_sku: string }>();
  for (const row of rows) {
    mappingSet.set(`${row.parent_kit_sku}|${row.component_sku}`, {
      channel_sku: row.parent_kit_sku,
      master_sku: row.component_sku,
    });
  }
  const uniqueMappings = [...mappingSet.values()];

  const distinctMasterSkus = [...new Set(uniqueMappings.map((m) => m.master_sku))];

  const primary = getPrimaryPool();

  // Step 1: commit sc_products rows first so the FK from sc_product_mapping_history
  // (via trg_sc_sku_mapping_history trigger) is satisfied at commit time of step 2.
  if (distinctMasterSkus.length > 0) {
    const preClient = await primary.connect();
    try {
      await preClient.query("BEGIN");
      await preClient.query(
        `INSERT INTO shipcore.sc_products (master_sku, product_name, status, created_at, updated_at)
         SELECT s, s, 'active', NOW(), NOW() FROM unnest($1::text[]) AS s
         ON CONFLICT (master_sku) DO NOTHING`,
        [distinctMasterSkus]
      );
      await preClient.query("COMMIT");
    } catch (e) {
      await preClient.query("ROLLBACK");
      throw e;
    } finally {
      preClient.release();
    }
  }

  // Step 2: sync sc_sku_mappings
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    await primaryClient.query(`
      CREATE TEMP TABLE stg_mappings (channel_sku TEXT, master_sku TEXT) ON COMMIT DROP
    `);

    let mappingsUpserted = 0;
    let mappingsDeleted = 0;

    if (uniqueMappings.length > 0) {
      const channelSkus = uniqueMappings.map((m) => m.channel_sku);
      const masterSkus  = uniqueMappings.map((m) => m.master_sku);
      await primaryClient.query(
        `INSERT INTO stg_mappings (channel_sku, master_sku)
         SELECT unnest($1::text[]), unnest($2::text[])`,
        [channelSkus, masterSkus]
      );

      await primaryClient.query(`CREATE INDEX ON stg_mappings (channel_sku, master_sku)`);

      const del = await primaryClient.query(`
        DELETE FROM shipcore.sc_sku_mappings m
        WHERE m.channel = 'shiphero'
          AND NOT EXISTS (
            SELECT 1 FROM stg_mappings s
            WHERE s.channel_sku = m.channel_sku AND s.master_sku = m.master_sku
          )
      `);
      mappingsDeleted = del.rowCount ?? 0;

      await primaryClient.query(`
        UPDATE shipcore.sc_sku_mappings m
        SET product_id = p.id
        FROM shipcore.sc_products p
        WHERE m.master_sku = p.master_sku
          AND m.channel = 'shiphero'
          AND m.product_id IS NULL
      `);

      const ins = await primaryClient.query(`
        INSERT INTO shipcore.sc_sku_mappings (channel, channel_sku, master_sku, product_id)
        SELECT 'shiphero', s.channel_sku, s.master_sku, p.id
        FROM stg_mappings s
        JOIN shipcore.sc_products p ON p.master_sku = s.master_sku
        ON CONFLICT DO NOTHING
      `);
      mappingsUpserted = ins.rowCount ?? 0;
    }

    await primaryClient.query("COMMIT");

    return { mappingsUpserted, mappingsDeleted };
  } catch (e) {
    await primaryClient.query("ROLLBACK");
    throw e;
  } finally {
    primaryClient.release();
  }
}

export async function getSalesOrdersPrimary(options: {
  page?: number;
  limit?: number;
  exportAll?: boolean;
  search?: string;
  platformSource?: string;
  orderStatus?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const pool = getPrimaryPool();
  const page = Math.max(1, options.page ?? 1);
  const limit = options.exportAll ? 100000 : Math.min(200, options.limit ?? 20);
  const offset = (page - 1) * limit;
  const sortOrder = options.sortOrder === "asc" ? "ASC" : "DESC";
  const sortColMap: Record<string, string> = {
    orderDate: "o.order_date",
    orderNumber: "o.order_number",
    platformSource: "o.platform_source",
    orderStatus: "o.order_status",
    totalPrice: "o.total_price",
    lineCount: "line_count",
    unitCount: "unit_count",
  };
  const sortCol = sortColMap[options.sortBy ?? "orderDate"] ?? "o.order_date";

  const filters: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (options.search?.trim()) {
    params.push(`%${options.search.trim()}%`);
    filters.push(
      `(COALESCE(o.order_number,'') ILIKE $${idx} OR COALESCE(o.external_order_id,'') ILIKE $${idx})`
    );
    idx++;
  }
  if (options.platformSource && options.platformSource !== "all") {
    params.push(options.platformSource);
    filters.push(`o.platform_source::text = $${idx++}`);
  }
  if (options.orderStatus && options.orderStatus !== "all") {
    params.push(options.orderStatus);
    filters.push(`o.order_status = $${idx++}`);
  }
  if (options.startDate) {
    params.push(options.startDate);
    filters.push(`o.order_date >= $${idx++}::date`);
  }
  if (options.endDate) {
    params.push(options.endDate);
    filters.push(`o.order_date < ($${idx++}::date + INTERVAL '1 day')`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const limitIdx = idx++;
  const offsetIdx = idx;

  const [summaryRes, platformRes, statusRes, dataRes, countRes] = await Promise.all([
    pool.query<{
      total_orders: number;
      total_revenue: string;
      total_units: number;
      total_platforms: number;
    }>(
      `SELECT COUNT(DISTINCT o.id)::int AS total_orders,
              COALESCE(SUM(o.total_price),0)::text AS total_revenue,
              COALESCE(SUM(sub.qty),0)::int AS total_units,
              COUNT(DISTINCT o.platform_source)::int AS total_platforms
       FROM shipcore.sc_sales_orders o
       LEFT JOIN (
         SELECT order_id, SUM(quantity) AS qty
         FROM shipcore.sc_sales_order_items GROUP BY order_id
       ) sub ON sub.order_id = o.id
       ${where}`,
      params
    ),
    pool.query<{ platform_source: string }>(
      `SELECT DISTINCT platform_source::text AS platform_source
       FROM shipcore.sc_sales_orders ORDER BY 1`
    ),
    pool.query<{ order_status: string }>(
      `SELECT DISTINCT order_status
       FROM shipcore.sc_sales_orders
       WHERE order_status IS NOT NULL ORDER BY 1`
    ),
    pool.query(
      `SELECT o.id, o.platform_source::text, o.external_order_id, o.order_number,
              o.order_date, o.order_status,
              COALESCE(o.total_price,0)::text AS total_price,
              o.currency::text,
              COUNT(i.id)::int AS line_count,
              COALESCE(SUM(i.quantity),0)::int AS unit_count
       FROM shipcore.sc_sales_orders o
       LEFT JOIN shipcore.sc_sales_order_items i ON i.order_id = o.id
       ${where}
       GROUP BY o.id, o.platform_source, o.external_order_id, o.order_number,
                o.order_date, o.order_status, o.total_price, o.currency
       ORDER BY ${sortCol} ${sortOrder}, o.id DESC
       ${options.exportAll ? "" : `LIMIT $${limitIdx} OFFSET $${offsetIdx}`}`,
      options.exportAll ? params : [...params, limit, offset]
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(DISTINCT o.id)::int AS total
       FROM shipcore.sc_sales_orders o ${where}`,
      params
    ),
  ]);

  const s = summaryRes.rows[0];
  return {
    rows: dataRes.rows.map((r) => ({
      id: r.id as number,
      platformSource: r.platform_source as string,
      externalOrderId: r.external_order_id as string | null,
      orderNumber: r.order_number as string | null,
      orderDate:
        r.order_date instanceof Date
          ? r.order_date.toISOString()
          : (r.order_date as string | null),
      orderStatus: r.order_status as string | null,
      totalPrice: Number(r.total_price ?? 0),
      currency: r.currency as string | null,
      lineCount: Number(r.line_count ?? 0),
      unitCount: Number(r.unit_count ?? 0),
    })),
    totalRows: countRes.rows[0].total,
    platformSources: platformRes.rows.map((r) => r.platform_source),
    orderStatuses: statusRes.rows.map((r) => r.order_status),
    summary: {
      totalOrders: s.total_orders,
      totalRevenue: Number(s.total_revenue ?? 0),
      totalUnits: s.total_units,
      totalPlatforms: s.total_platforms,
    },
  };
}

export async function getSalesOrderDetailPrimary(orderId: number) {
  const pool = getPrimaryPool();
  const [orderRes, itemsRes] = await Promise.all([
    pool.query(
      `SELECT id, platform_source::text, external_order_id, order_number,
              order_date, order_status, total_price, currency::text,
              fulfillment_channel, cancelled_at
       FROM shipcore.sc_sales_orders WHERE id = $1`,
      [orderId]
    ),
    pool.query(
      `SELECT id, master_sku, channel_sku, product_name, quantity,
              unit_price, line_total, fulfillment_status
       FROM shipcore.sc_sales_order_items
       WHERE order_id = $1 ORDER BY id`,
      [orderId]
    ),
  ]);

  if (!orderRes.rows.length) return null;

  const o = orderRes.rows[0];
  return {
    id: o.id as number,
    platformSource: o.platform_source as string,
    externalOrderId: o.external_order_id as string | null,
    orderNumber: o.order_number as string | null,
    orderDate:
      o.order_date instanceof Date
        ? o.order_date.toISOString()
        : (o.order_date as string | null),
    orderStatus: o.order_status as string | null,
    totalPrice: Number(o.total_price ?? 0),
    currency: o.currency as string | null,
    fulfillmentChannel: o.fulfillment_channel as string | null,
    cancelledAt:
      o.cancelled_at instanceof Date
        ? o.cancelled_at.toISOString()
        : (o.cancelled_at as string | null),
    lineItems: itemsRes.rows.map((i) => ({
      id: i.id as number,
      masterSku: i.master_sku as string | null,
      channelSku: i.channel_sku as string | null,
      productName: i.product_name as string | null,
      quantity: Number(i.quantity ?? 0),
      unitPrice: Number(i.unit_price ?? 0),
      lineTotal: Number(i.line_total ?? 0),
      fulfillmentStatus: i.fulfillment_status as string | null,
    })),
  };
}
