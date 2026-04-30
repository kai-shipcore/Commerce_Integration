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
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return primaryPool;
}

function inferCategory(sku: string): string | null {
  const parts = sku.split("-");
  if (parts[0] === "CC") return "CC";
  if (parts[1] === "FM") return "FM";
  if (parts[1] === "SC") return "SC";
  return null;
}

export async function syncInventorySnapshotCrossDb(): Promise<{ rowsSynced: number }> {
  // Step 1: Read from old Supabase (SUPABASE_LOOKUP_DATABASE_URL)
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<{
    master_sku: string;
    warehouse: string | null;
    on_hand: number;
    available: number;
    backorder: number;
    created_at: Date | string | null;
  }>;
  try {
    const result = await lookupClient.query(`
      SELECT
        master_sku,
        warehouse,
        COALESCE(on_hand, 0)   AS on_hand,
        COALESCE(available, 0) AS available,
        COALESCE(backorder, 0) AS backorder,
        created_at
      FROM ecommerce_data.coverland_inventory
    `);
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  // Step 2: Write to new DB (DATABASE_URL)
  const primary = getPrimaryPool();
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    // Upsert products
    const distinctSkus = [...new Set(rows.map((r) => r.master_sku))];
    if (distinctSkus.length > 0) {
      await primaryClient.query(
        `INSERT INTO shipcore.sc_products (master_sku, product_name, status, updated_at)
         SELECT sku, 'Product ' || sku, 'active', NOW()
         FROM unnest($1::text[]) AS sku
         ON CONFLICT (master_sku) DO UPDATE SET
           product_name = EXCLUDED.product_name,
           status       = EXCLUDED.status,
           updated_at   = NOW()`,
        [distinctSkus]
      );
    }

    // Upsert warehouses
    const distinctWarehouses = [
      ...new Set(rows.map((r) => r.warehouse).filter(Boolean)),
    ] as string[];
    if (distinctWarehouses.length > 0) {
      await primaryClient.query(
        `INSERT INTO shipcore.sc_warehouses (warehouse_code, warehouse_name, warehouse_type, is_active, updated_at)
         SELECT wh, wh || ' Warehouse', '3PL', true, NOW()
         FROM unnest($1::text[]) AS wh
         ON CONFLICT (warehouse_code) DO UPDATE SET
           warehouse_name = EXCLUDED.warehouse_name,
           warehouse_type = EXCLUDED.warehouse_type,
           is_active      = EXCLUDED.is_active,
           updated_at     = NOW()`,
        [distinctWarehouses]
      );
    }

    // Truncate and batch-insert inventory snapshot
    await primaryClient.query("TRUNCATE TABLE shipcore.sc_inventory_snapshot");

    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch
        .map((_, j) => {
          const b = j * 6;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, 0, 0, $${b + 4}, $${b + 6}, NOW())`;
        })
        .join(", ");
      const params = batch.flatMap((r) => [
        r.master_sku,
        r.warehouse,
        r.on_hand,
        r.available,
        r.backorder,
        r.created_at,
      ]);
      await primaryClient.query(
        `INSERT INTO shipcore.sc_inventory_snapshot
           (master_sku, warehouse_code, on_hand_qty, available_qty, backorder_qty,
            reserved_qty, manual_adjustment_qty, final_usable_qty, created_at, snapshot_at)
         VALUES ${placeholders}`,
        params
      );
    }

    await primaryClient.query("COMMIT");
  } catch (e) {
    await primaryClient.query("ROLLBACK");
    throw e;
  } finally {
    primaryClient.release();
  }

  return { rowsSynced: rows.length };
}

export async function syncProducts(): Promise<{
  productsUpserted: number;
  productsDeleted: number;
}> {
  // Step 1: Read from Supabase via LATERAL join to extract distinct master SKUs
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<{
    master_sku_parse1: string;
    master_sku_parse2: string;
    master_sku_parse3: string;
  }>;
  try {
    const result = await lookupClient.query(`
      SELECT d.*
      FROM ecommerce_data.shopify_data aa,
      LATERAL size_chart.fn_extract_master_sku_from_web_sku(aa.variant_sku) d
      WHERE aa.variant_sku IS NOT NULL
    `);
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  // Collect distinct master SKUs from all non-empty parses
  const masterSkuSet = new Set<string>();
  for (const row of rows) {
    if (row.master_sku_parse1) masterSkuSet.add(row.master_sku_parse1);
    if (row.master_sku_parse2) masterSkuSet.add(row.master_sku_parse2);
    if (row.master_sku_parse3) masterSkuSet.add(row.master_sku_parse3);
  }
  const distinctMasterSkus = [...masterSkuSet];

  // Step 2: Upsert sc_products in primary DB (transaction)
  const primary = getPrimaryPool();
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    const categories = distinctMasterSkus.map(inferCategory);

    await primaryClient.query(`
      CREATE TEMP TABLE stg_products (master_sku TEXT, category TEXT) ON COMMIT DROP
    `);

    if (distinctMasterSkus.length > 0) {
      await primaryClient.query(
        `INSERT INTO stg_products (master_sku, category)
         SELECT unnest($1::text[]), unnest($2::text[])`,
        [distinctMasterSkus, categories]
      );
    }

    await primaryClient.query(`CREATE INDEX ON stg_products (master_sku)`);

    const delProducts = await primaryClient.query(`
      DELETE FROM shipcore.sc_products p
      WHERE NOT EXISTS (SELECT 1 FROM stg_products s WHERE s.master_sku = p.master_sku)
    `);

    await primaryClient.query(`
      INSERT INTO shipcore.sc_products (master_sku, product_name, status, category, created_at, updated_at)
      SELECT master_sku, master_sku, 'active', category, NOW(), NOW() FROM stg_products
      ON CONFLICT (master_sku) DO UPDATE SET
        category   = EXCLUDED.category,
        updated_at = NOW()
    `);

    await primaryClient.query("COMMIT");

    return {
      productsUpserted: distinctMasterSkus.length,
      productsDeleted: delProducts.rowCount ?? 0,
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

      const ins = await primaryClient.query(`
        INSERT INTO shipcore.sc_sku_mappings (channel, channel_sku, master_sku)
        SELECT 'shiphero', channel_sku, master_sku FROM stg_mappings
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
