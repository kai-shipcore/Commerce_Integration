/**
 * Pure data access for the Products sync pipeline. Moved out of the shared
 * src/lib/db/primary-db.ts (which still holds unrelated sync helpers for
 * other domains — syncSkuMappings, getSalesOrdersPrimary — untouched).
 *
 * Pulls distinct master_sku + title pairs from the Supabase lookup DB
 * (Shopify + iCarCover sources) and upserts shipcore.sc_products.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";

interface LookupRow {
  master_sku: string;
  product_name: string;
  product_vehicle_id: number | null;
  sub_category: string | null;
  source_web_sku_example: string | null;
  f_number: string | null;
  vehicle_type_code: string | null;
  make_code: string | null;
  model_code: string | null;
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

export const ProductsSyncRepository = {
  async getLookupRows(): Promise<LookupRow[]> {
    const lookup = getLookupPool();
    if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

    const lookupClient = await lookup.connect();
    try {
      const result = await lookupClient.query<LookupRow>(`
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
      return result.rows;
    } finally {
      lookupClient.release();
    }
  },

  async upsertProducts(rows: LookupRow[]): Promise<void> {
    const distinctMasterSkus = rows.map((r) => r.master_sku);
    const productNames = rows.map((r) => r.product_name);
    const vehicleIds = rows.map((r) => r.product_vehicle_id ?? null);
    const brands = rows.map((r) => inferBrand(r.master_sku));
    const categories = distinctMasterSkus.map(inferCategory);
    const subCategories = rows.map((r) => r.sub_category ?? null);
    const sourceWebSkuExamples = rows.map((r) => r.source_web_sku_example ?? null);
    const fNumbers = rows.map((r) => r.f_number ?? null);
    const vehicleTypeCodes = rows.map((r) => r.vehicle_type_code ?? null);
    const makeCodes = rows.map((r) => r.make_code ?? null);
    const modelCodes = rows.map((r) => r.model_code ?? null);

    const primaryClient = await getPrimaryPool().connect();
    try {
      await primaryClient.query("BEGIN");

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
           subCategories, sourceWebSkuExamples, fNumbers, vehicleTypeCodes, makeCodes, modelCodes],
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
    } catch (e) {
      await primaryClient.query("ROLLBACK");
      throw e;
    } finally {
      primaryClient.release();
    }
  },
};
