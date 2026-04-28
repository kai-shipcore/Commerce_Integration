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

export async function syncProductsAndSkuMappings(): Promise<{
  productsUpserted: number;
  productsDeleted: number;
  mappingsUpserted: number;
  mappingsDeleted: number;
}> {
  // Step 1: Read from old Supabase via LATERAL join
  const lookup = getLookupPool();
  if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

  const lookupClient = await lookup.connect();
  let rows: Array<{
    variant_sku: string;
    master_sku_parse1: string;
    master_sku_parse2: string;
    master_sku_parse3: string;
  }>;
  try {
    const result = await lookupClient.query(`
      SELECT aa.variant_sku, d.*
      FROM ecommerce_data.shopify_data aa,
      LATERAL size_chart.fn_extract_master_sku_from_web_sku(aa.variant_sku) d
      WHERE aa.variant_sku IS NOT NULL
    `);
    rows = result.rows;
  } finally {
    lookupClient.release();
  }

  // Collect distinct master_skus from all non-empty parses
  const masterSkuSet = new Set<string>();
  for (const row of rows) {
    if (row.master_sku_parse1) masterSkuSet.add(row.master_sku_parse1);
    if (row.master_sku_parse2) masterSkuSet.add(row.master_sku_parse2);
    if (row.master_sku_parse3) masterSkuSet.add(row.master_sku_parse3);
  }
  const distinctMasterSkus = [...masterSkuSet];

  // Build mapping rows: one per (variant_sku, non-empty parse)
  const mappings: Array<{ channel_sku: string; master_sku: string }> = [];
  for (const row of rows) {
    for (const parse of [row.master_sku_parse1, row.master_sku_parse2, row.master_sku_parse3]) {
      if (parse) {
        mappings.push({ channel_sku: row.variant_sku, master_sku: parse });
      }
    }
  }

  // Deduplicate mappings (same channel_sku + master_sku from multiple source rows)
  const mappingSet = new Map<string, { channel_sku: string; master_sku: string }>();
  for (const m of mappings) {
    mappingSet.set(`${m.channel_sku}|${m.master_sku}`, m);
  }
  const uniqueMappings = [...mappingSet.values()];

  // Step 2: Staging-table UPSERT + DELETE in new DB (transaction)
  const primary = getPrimaryPool();
  const primaryClient = await primary.connect();
  try {
    await primaryClient.query("BEGIN");

    // Drop legacy index if still present
    await primaryClient.query(`DROP INDEX IF EXISTS shipcore.uq_sku_mapping`);

    // ── sc_products ──────────────────────────────────────────────
    const categories = distinctMasterSkus.map(inferCategory);

    // 1. Create staging table
    await primaryClient.query(`
      CREATE TEMP TABLE stg_products (master_sku TEXT, category TEXT) ON COMMIT DROP
    `);

    // 2. Bulk insert into staging
    if (distinctMasterSkus.length > 0) {
      await primaryClient.query(
        `INSERT INTO stg_products (master_sku, category)
         SELECT unnest($1::text[]), unnest($2::text[])`,
        [distinctMasterSkus, categories]
      );
    }

    // 3. Index staging for efficient DELETE
    await primaryClient.query(`CREATE INDEX ON stg_products (master_sku)`);

    // 4. Delete rows no longer in source
    const delProducts = await primaryClient.query(`
      DELETE FROM shipcore.sc_products p
      WHERE NOT EXISTS (SELECT 1 FROM stg_products s WHERE s.master_sku = p.master_sku)
    `);

    // 5. Upsert from staging to main
    await primaryClient.query(`
      INSERT INTO shipcore.sc_products (master_sku, product_name, status, category, created_at, updated_at)
      SELECT master_sku, master_sku, 'active', category, NOW(), NOW() FROM stg_products
      ON CONFLICT (master_sku) DO UPDATE SET
        category   = EXCLUDED.category,
        updated_at = NOW()
    `);

    // ── sc_sku_mappings ──────────────────────────────────────────
    // 1. Create staging table
    await primaryClient.query(`
      CREATE TEMP TABLE stg_mappings (channel_sku TEXT, master_sku TEXT) ON COMMIT DROP
    `);

    // 2. Bulk insert into staging
    let mappingsUpserted = 0;
    let mappingsDeleted = 0;
    if (uniqueMappings.length > 0) {
      const channelSkus = uniqueMappings.map((m) => m.channel_sku);
      const masterSkus2 = uniqueMappings.map((m) => m.master_sku);
      await primaryClient.query(
        `INSERT INTO stg_mappings (channel_sku, master_sku)
         SELECT unnest($1::text[]), unnest($2::text[])`,
        [channelSkus, masterSkus2]
      );

      // 3. Index staging for efficient DELETE
      await primaryClient.query(
        `CREATE INDEX ON stg_mappings (channel_sku, master_sku)`
      );

      // 4. Delete shopify mappings no longer in source
      const delMappings = await primaryClient.query(`
        DELETE FROM shipcore.sc_sku_mappings m
        WHERE m.channel = 'shopify'
          AND NOT EXISTS (
            SELECT 1 FROM stg_mappings s
            WHERE s.channel_sku = m.channel_sku AND s.master_sku = m.master_sku
          )
      `);
      mappingsDeleted = delMappings.rowCount ?? 0;

      // 5. Upsert from staging to main
      const ins = await primaryClient.query(`
        INSERT INTO shipcore.sc_sku_mappings (channel, channel_sku, master_sku)
        SELECT 'shopify', channel_sku, master_sku FROM stg_mappings
        ON CONFLICT DO NOTHING
      `);
      mappingsUpserted = ins.rowCount ?? 0;
    }

    await primaryClient.query("COMMIT");

    return {
      productsUpserted: distinctMasterSkus.length,
      productsDeleted: delProducts.rowCount ?? 0,
      mappingsUpserted,
      mappingsDeleted,
    };
  } catch (e) {
    await primaryClient.query("ROLLBACK");
    throw e;
  } finally {
    primaryClient.release();
  }
}
