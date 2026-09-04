import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { normalizeMasterSku, partMasterSkuSql } from "@/lib/planning/master-sku";

export type ProductKey = "cc" | "fm" | "sc" | "ac" | "swc";

export interface ProductRow {
  master_sku: string;
  product_name: string;
  category: string | null;
  category_code: string | null;
  status: string;
  sales_status: string | null;
  original_or_custom: string;
  moq: number | null;
  order_multiple: number | null;
  cbm_per_unit: string | null;
  case_qty: number | null;
  weight_kg: string | null;
}

export interface ResolvedSkuMasterListQuery {
  page: number;
  limit: number;
  offset: number;
  search: string;
  productValues: string[];
  status: "all" | "active" | "inactive";
  salesType: "all" | "Original" | "Custom" | "Part";
  typeFilter: "all" | "Hold" | "Discontinued" | "TBD";
}

export interface ExcelSkuRow {
  masterSku: string;
  cbmPerUnit?: number;
  moq?: number;
  orderMultiple?: number;
}

export interface ExistingProductValues {
  cbmPerUnit: number | null;
  moq: number | null;
  orderMultiple: number | null;
}

export interface UpdateProductFields {
  moq: number | null;
  orderMultiple: number | null;
  cbmPerUnit: number | null;
  caseQty: number | null;
  weightKg: number | null;
  status: "active" | "inactive" | null;
  salesStatus: string | null | undefined;
}

type QueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const forecastDashboardViewSql = `
  CREATE VIEW shipcore.fc_forecast_dashboard AS
  SELECT p.master_sku,
      p.sub_category_code,
      p.status AS product_status,
      p.moq,
      p.cbm_per_unit,
      COALESCE(st.total_usable_qty, 0::numeric) AS stock_qty,
      COALESCE(st.total_backorder, 0::numeric) AS backorder_qty,
      COALESCE(ib.inbound_qty, 0::bigint) AS inbound_qty,
      ib.nearest_eta,
      fb.adjusted_daily_forecast AS daily_forecast,
      fb.seasonality_factor,
      CASE
        WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)
        ELSE NULL::numeric
      END AS days_of_cover,
      CURRENT_DATE +
      CASE
        WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)::integer
        ELSE 9999
      END AS est_sold_out_date
    FROM shipcore.fc_products p
      LEFT JOIN shipcore.fc_stock_total st ON st.master_sku::text = p.master_sku::text
      LEFT JOIN shipcore.fc_inbound_qty ib ON ib.master_sku::text = p.master_sku::text
      LEFT JOIN LATERAL (
        SELECT fc_forecast_baselines.adjusted_daily_forecast,
          fc_forecast_baselines.seasonality_factor
        FROM shipcore.fc_forecast_baselines
        WHERE fc_forecast_baselines.master_sku::text = p.master_sku::text
        ORDER BY fc_forecast_baselines.forecast_date DESC
        LIMIT 1
      ) fb ON true
    WHERE p.status = 'active'::shipcore.fc_product_status
`;

// Manual override only (Hold/Discontinued/TBD). SWC is an item/category designation (it lives in
// the category filter bar instead, matched directly against the raw column below) rather than a
// lifecycle status, so it's excluded here. Legacy rows where p.sales_status was mistakenly
// written as 'Original'/'Custom' (a footgun in the old single-dropdown UI) are also treated as having
// no override, same as NULL — Original/Custom live in originalOrCustomSql.
const overrideStatusSql = `(CASE WHEN p.sales_status IN ('Hold', 'Discontinued', 'TBD') THEN p.sales_status ELSE NULL END)`;
// Original vs Custom is derived purely from actual order/velocity data (the is_custom flag baked
// into fc_stats/fc_stats_custom), independent of any manual override on fc_products.
// Replacement parts are a third sales type, and they take precedence over the
// order-derived value: a part SKU is a part whether or not anyone has ordered
// one (see partMasterSkuSql — the classification is derived from the SKU
// itself, since nothing has written fc_products.sales_status = 'Part' since
// fc_replacement_parts was dropped).
const originalOrCustomSql = `CASE WHEN ${partMasterSkuSql("p.master_sku")} THEN 'Part' ELSE COALESCE((SELECT sales_status FROM shipcore.fc_stats WHERE master_sku = p.master_sku LIMIT 1), (SELECT sales_status FROM shipcore.fc_stats_custom WHERE master_sku = p.master_sku LIMIT 1), 'Original') END`;

const PRODUCT_CATEGORY_MAP: Record<string, string> = { cc: "CC", fm: "FM", sc: "SC", ac: "AC", swc: "SWC" };

const PRODUCT_ROW_SELECT_SQL = `
  p.master_sku,
  p.product_name,
  p.category,
  p.category_code,
  p.status::text AS status,
  ${overrideStatusSql} AS sales_status,
  ${originalOrCustomSql} AS original_or_custom,
  p.moq,
  p.order_multiple,
  p.cbm_per_unit::text AS cbm_per_unit,
  p.case_qty,
  p.weight_kg::text AS weight_kg
`;

/**
 * Pure product-classification rule: infers category/MOQ/CBM defaults from a
 * master SKU's naming pattern. Used both when shaping DB rows for display
 * (fallback for unset fields) and when building rows to insert during sync/
 * Excel import.
 */
export function inferProduct(masterSku: string): {
  productKey: ProductKey;
  category: string;
  categoryCode: string;
  moq: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
} {
  const sku = masterSku.toUpperCase();

  if (sku.includes("SWC")) {
    return { productKey: "swc", category: "SWC", categoryCode: "SWC", moq: 1, cbmPerUnit: 0.078, caseQty: 1, weightKg: 2.8 };
  }

  if (sku.startsWith("CC-") || sku === "C-SJ-GR-7") {
    return { productKey: "cc", category: "Car Cover", categoryCode: "CC", moq: 3, cbmPerUnit: 0.078, caseQty: 3, weightKg: 2.8 };
  }

  if (sku.startsWith("CA-SC-") || sku.startsWith("CL-SC-")) {
    return { productKey: "sc", category: "Seat Cover", categoryCode: "SC", moq: 5, cbmPerUnit: 0.048, caseQty: 1, weightKg: 0.9 };
  }

  if (sku.startsWith("CA-FM-")) {
    return { productKey: "fm", category: "Floor Mat", categoryCode: "FM", moq: 5, cbmPerUnit: 0.125, caseQty: 1, weightKg: 1.4 };
  }

  return { productKey: "ac", category: "Accessories", categoryCode: "AC", moq: 1, cbmPerUnit: 0.05, caseQty: 1, weightKg: 0.5 };
}

async function ensureCbmPrecision(client: QueryClient) {
  const result = await client.query(`
    SELECT numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'shipcore'
      AND table_name = 'fc_products'
      AND column_name = 'cbm_per_unit'
  `);
  const scale = Number(result.rows[0]?.numeric_scale ?? 0);

  if (scale < 6) {
    await client.query("DROP VIEW IF EXISTS shipcore.fc_forecast_dashboard");
    await client.query(`
      ALTER TABLE shipcore.fc_products
      ALTER COLUMN cbm_per_unit TYPE NUMERIC(14,6)
      USING cbm_per_unit::NUMERIC(14,6)
    `);
    await client.query(forecastDashboardViewSql);
  }
}

/**
 * Pure data access for the SKU Master admin feature (`shipcore.fc_products`
 * on the primary DB). Caching/validation/audit orchestration are Service
 * concerns (see sku-master/service.ts) — this repository only runs queries.
 */
export const SkuMasterRepository = {
  async findBySku(masterSku: string): Promise<ProductRow | null> {
    const pool = getPrimaryPool();
    const result = await pool.query<ProductRow>(
      `SELECT ${PRODUCT_ROW_SELECT_SQL}
       FROM shipcore.fc_products p
       WHERE p.master_sku = $1 AND p.status = 'active'
       LIMIT 1`,
      [masterSku]
    );
    return result.rows[0] ?? null;
  },

  buildListFilters(resolved: ResolvedSkuMasterListQuery): { whereClause: string; params: unknown[] } {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (resolved.status !== "all") {
      params.push(resolved.status);
      filters.push(`p.status = $${params.length}::shipcore.fc_product_status`);
    }

    if (resolved.search) {
      params.push(`%${resolved.search}%`);
      filters.push(`p.master_sku ILIKE $${params.length}`);
    }

    // Merged category filter: SWC is a real category_code value (see "swc" in
    // PRODUCT_CATEGORY_MAP), so it flows through categoryCodes like the others.
    const categoryCodes = resolved.productValues
      .map((v) => PRODUCT_CATEGORY_MAP[v])
      .filter((code): code is string => Boolean(code));

    if (categoryCodes.length) {
      params.push(categoryCodes);
      filters.push(`p.category_code = ANY($${params.length}::text[])`);
    }

    if (resolved.salesType !== "all") {
      params.push(resolved.salesType);
      filters.push(`${originalOrCustomSql} = $${params.length}`);
    }

    if (resolved.typeFilter !== "all") {
      params.push(resolved.typeFilter);
      filters.push(`${overrideStatusSql} = $${params.length}`);
    }

    return { whereClause: filters.length > 0 ? filters.join(" AND ") : "TRUE", params };
  },

  async countProducts(resolved: ResolvedSkuMasterListQuery): Promise<number> {
    const pool = getPrimaryPool();
    const { whereClause, params } = this.buildListFilters(resolved);
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM shipcore.fc_products p WHERE ${whereClause}`,
      params
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  async listProducts(resolved: ResolvedSkuMasterListQuery): Promise<ProductRow[]> {
    const pool = getPrimaryPool();
    const { whereClause, params } = this.buildListFilters(resolved);
    const dataParams = [...params, resolved.limit, resolved.offset];
    const limitParam = dataParams.length - 1;
    const offsetParam = dataParams.length;

    const result = await pool.query<ProductRow>(
      `SELECT ${PRODUCT_ROW_SELECT_SQL}
       FROM shipcore.fc_products p
       WHERE ${whereClause}
       ORDER BY p.category_code NULLS LAST, p.master_sku
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      dataParams
    );
    return result.rows;
  },

  async getDistinctMasterSkusFromInventory(): Promise<{ sourceRowCount: number; masterSkus: string[] }> {
    const lookup = getLookupPool();
    if (!lookup) {
      throw new Error("SUPABASE_LOOKUP_DATABASE_URL is not configured");
    }
    const client = await lookup.connect();
    try {
      const source = await client.query<{ master_sku: string }>(
        `SELECT DISTINCT btrim(master_sku) AS master_sku
         FROM ecommerce_data.coverland_inventory_by_warehouse
         WHERE master_sku IS NOT NULL AND btrim(master_sku) <> ''
         ORDER BY btrim(master_sku)`
      );
      return {
        sourceRowCount: source.rowCount ?? source.rows.length,
        masterSkus: source.rows.map((row) => normalizeMasterSku(row.master_sku)),
      };
    } finally {
      client.release();
    }
  },

  async upsertProductsFromSync(masterSkus: string[]): Promise<{ upserted: number }> {
    const primary = getPrimaryPool();
    const client = await primary.connect();

    const rows = [...new Map(masterSkus.map((masterSku) => [masterSku, { masterSku, ...inferProduct(masterSku) }])).values()];

    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE stg_fc_products (
          master_sku TEXT,
          product_name TEXT,
          category TEXT,
          category_code TEXT,
          moq INT,
          order_multiple INT,
          cbm_per_unit NUMERIC,
          case_qty INT,
          weight_kg NUMERIC
        ) ON COMMIT DROP
      `);

      if (rows.length > 0) {
        await client.query(
          `INSERT INTO stg_fc_products
             (master_sku, product_name, category, category_code, moq, order_multiple, cbm_per_unit, case_qty, weight_kg)
           SELECT
             unnest($1::text[]),
             unnest($2::text[]),
             unnest($3::text[]),
             unnest($4::text[]),
             unnest($5::int[]),
             unnest($6::int[]),
             unnest($7::numeric[]),
             unnest($8::int[]),
             unnest($9::numeric[])`,
          [
            rows.map((row) => row.masterSku),
            rows.map((row) => row.masterSku),
            rows.map((row) => row.category),
            rows.map((row) => row.categoryCode),
            rows.map((row) => row.moq),
            rows.map((row) => row.moq),
            rows.map((row) => row.cbmPerUnit),
            rows.map((row) => row.caseQty),
            rows.map((row) => row.weightKg),
          ]
        );
      }

      const upsert = await client.query(`
        INSERT INTO shipcore.fc_products (
          master_sku, product_name, category, category_code, status,
          moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
          created_at, updated_at
        )
        SELECT
          master_sku, product_name, category, category_code, 'active',
          moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
          NOW(), NOW()
        FROM stg_fc_products
        ON CONFLICT (master_sku) DO UPDATE SET
          product_name = COALESCE(NULLIF(shipcore.fc_products.product_name, ''), EXCLUDED.product_name),
          category = COALESCE(shipcore.fc_products.category, EXCLUDED.category),
          category_code = COALESCE(shipcore.fc_products.category_code, EXCLUDED.category_code),
          status = 'active',
          updated_at = NOW()
      `);

      await client.query("COMMIT");
      return { upserted: upsert.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Pure backfill for master SKUs discovered in real inventory/sales/pre-order
   * data (see refreshStats) that have no `fc_products` row at all yet — the
   * gap that let 30 real SKUs go unclassified until a manual audit caught it.
   * Unlike upsertProductsFromSync, this never touches a SKU that already has
   * a row: it only INSERTs where none exists, so it can safely run on every
   * automatic "Sync" without silently reactivating a SKU someone deliberately
   * marked inactive via deactivateProduct.
   */
  async insertMissingProducts(masterSkus: string[]): Promise<{ inserted: number }> {
    const primary = getPrimaryPool();
    const client = await primary.connect();

    const rows = [...new Map(masterSkus.map((masterSku) => [masterSku, { masterSku, ...inferProduct(masterSku) }])).values()];

    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE stg_fc_products_backfill (
          master_sku TEXT,
          product_name TEXT,
          category TEXT,
          category_code TEXT,
          moq INT,
          order_multiple INT,
          cbm_per_unit NUMERIC,
          case_qty INT,
          weight_kg NUMERIC
        ) ON COMMIT DROP
      `);

      if (rows.length > 0) {
        await client.query(
          `INSERT INTO stg_fc_products_backfill
             (master_sku, product_name, category, category_code, moq, order_multiple, cbm_per_unit, case_qty, weight_kg)
           SELECT
             unnest($1::text[]),
             unnest($2::text[]),
             unnest($3::text[]),
             unnest($4::text[]),
             unnest($5::int[]),
             unnest($6::int[]),
             unnest($7::numeric[]),
             unnest($8::int[]),
             unnest($9::numeric[])`,
          [
            rows.map((row) => row.masterSku),
            rows.map((row) => row.masterSku),
            rows.map((row) => row.category),
            rows.map((row) => row.categoryCode),
            rows.map((row) => row.moq),
            rows.map((row) => row.moq),
            rows.map((row) => row.cbmPerUnit),
            rows.map((row) => row.caseQty),
            rows.map((row) => row.weightKg),
          ]
        );
      }

      const inserted = await client.query(`
        INSERT INTO shipcore.fc_products (
          master_sku, product_name, category, category_code, status,
          moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
          created_at, updated_at
        )
        SELECT
          stg.master_sku, stg.product_name, stg.category, stg.category_code, 'active',
          stg.moq, stg.order_multiple, stg.cbm_per_unit, stg.case_qty, stg.weight_kg,
          NOW(), NOW()
        FROM stg_fc_products_backfill stg
        WHERE NOT EXISTS (
          SELECT 1 FROM shipcore.fc_products p WHERE p.master_sku = stg.master_sku
        )
        ON CONFLICT (master_sku) DO NOTHING
      `);

      await client.query("COMMIT");
      return { inserted: inserted.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateProduct(masterSku: string, fields: UpdateProductFields): Promise<boolean> {
    const pool = getPrimaryPool();
    const result = await pool.query(
      `UPDATE shipcore.fc_products
       SET moq = COALESCE($2, moq),
           order_multiple = COALESCE($3, order_multiple),
           cbm_per_unit = COALESCE($4, cbm_per_unit),
           case_qty = COALESCE($5, case_qty),
           weight_kg = COALESCE($6, weight_kg),
           status = COALESCE($7::shipcore.fc_product_status, status),
           sales_status = CASE WHEN $8::text IS NOT NULL THEN $8::text ELSE sales_status END,
           updated_at = NOW()
       WHERE master_sku = $1
       RETURNING master_sku`,
      [
        masterSku,
        fields.moq,
        fields.orderMultiple,
        fields.cbmPerUnit,
        fields.caseQty,
        fields.weightKg,
        fields.status,
        fields.salesStatus ?? null,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async findExistingValuesBySkus(masterSkus: string[]): Promise<Map<string, ExistingProductValues>> {
    const pool = getPrimaryPool();
    const result = await pool.query<{
      master_sku: string;
      cbm_per_unit: string | null;
      moq: number | null;
      order_multiple: number | null;
    }>(
      `SELECT master_sku, cbm_per_unit::text, moq, order_multiple
       FROM shipcore.fc_products
       WHERE master_sku = ANY($1::text[])`,
      [masterSkus]
    );
    return new Map(
      result.rows.map((row) => [
        row.master_sku,
        {
          cbmPerUnit: row.cbm_per_unit == null ? null : Number(row.cbm_per_unit),
          moq: row.moq,
          orderMultiple: row.order_multiple,
        },
      ])
    );
  },

  async applyExcelImport(rows: ExcelSkuRow[]): Promise<{ updated: number; inserted: number }> {
    const pool = getPrimaryPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE stg_excel_sku (
          master_sku TEXT PRIMARY KEY,
          product_name TEXT,
          category TEXT,
          category_code TEXT,
          imported_moq INT,
          imported_order_multiple INT,
          imported_cbm_per_unit NUMERIC,
          default_moq INT,
          default_order_multiple INT,
          default_cbm_per_unit NUMERIC,
          case_qty INT,
          weight_kg NUMERIC
        ) ON COMMIT DROP
      `);

      await ensureCbmPrecision(client);

      const inferredRows = rows.map((row) => {
        const defaults = inferProduct(row.masterSku);
        return {
          ...defaults,
          masterSku: row.masterSku,
          importedCbmPerUnit: row.cbmPerUnit ?? null,
          importedMoq: row.moq ?? null,
          importedOrderMultiple: row.orderMultiple ?? null,
        };
      });

      await client.query(
        `INSERT INTO stg_excel_sku
           (master_sku, product_name, category, category_code,
            imported_moq, imported_order_multiple, imported_cbm_per_unit,
            default_moq, default_order_multiple, default_cbm_per_unit,
            case_qty, weight_kg)
         SELECT
           unnest($1::text[]),
           unnest($2::text[]),
           unnest($3::text[]),
           unnest($4::text[]),
           unnest($5::int[]),
           unnest($6::int[]),
           unnest($7::numeric[]),
           unnest($8::int[]),
           unnest($9::int[]),
           unnest($10::numeric[]),
           unnest($11::int[]),
           unnest($12::numeric[])`,
        [
          inferredRows.map((row) => row.masterSku),
          inferredRows.map((row) => row.masterSku),
          inferredRows.map((row) => row.category),
          inferredRows.map((row) => row.categoryCode),
          inferredRows.map((row) => row.importedMoq),
          inferredRows.map((row) => row.importedOrderMultiple),
          inferredRows.map((row) => row.importedCbmPerUnit),
          inferredRows.map((row) => row.moq),
          inferredRows.map((row) => row.moq),
          inferredRows.map((row) => row.cbmPerUnit),
          inferredRows.map((row) => row.caseQty),
          inferredRows.map((row) => row.weightKg),
        ]
      );

      const updatedResult = await client.query(`
        UPDATE shipcore.fc_products product
        SET
          cbm_per_unit = COALESCE(stg.imported_cbm_per_unit, product.cbm_per_unit),
          moq = COALESCE(stg.imported_moq, product.moq),
          order_multiple = COALESCE(stg.imported_order_multiple, product.order_multiple),
          product_name = COALESCE(NULLIF(product.product_name, ''), stg.product_name),
          category = COALESCE(product.category, stg.category),
          category_code = COALESCE(product.category_code, stg.category_code),
          updated_at = NOW()
        FROM stg_excel_sku stg
        WHERE product.master_sku = stg.master_sku
      `);

      const insertedResult = await client.query(`
        INSERT INTO shipcore.fc_products (
          master_sku, product_name, category, category_code, status,
          moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
          created_at, updated_at
        )
        SELECT
          master_sku, product_name, category, category_code, 'active',
          COALESCE(imported_moq, default_moq),
          COALESCE(imported_order_multiple, default_order_multiple),
          COALESCE(imported_cbm_per_unit, default_cbm_per_unit),
          case_qty, weight_kg,
          NOW(), NOW()
        FROM stg_excel_sku stg
        WHERE NOT EXISTS (
          SELECT 1 FROM shipcore.fc_products product WHERE product.master_sku = stg.master_sku
        )
        ON CONFLICT (master_sku) DO NOTHING
      `);

      await client.query("COMMIT");
      return { updated: updatedResult.rowCount ?? 0, inserted: insertedResult.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async deactivateProduct(masterSku: string): Promise<void> {
    const pool = getPrimaryPool();
    await pool.query(
      `UPDATE shipcore.fc_products
       SET status = 'inactive', updated_at = NOW()
       WHERE master_sku = $1`,
      [masterSku]
    );
  },
};
