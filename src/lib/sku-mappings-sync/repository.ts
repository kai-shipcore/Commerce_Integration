/**
 * Pure data access for the SKU Mappings sync pipeline. Moved out of the
 * shared src/lib/db/primary-db.ts (unrelated sync helpers stay there).
 *
 * Pulls ShipHero kit-component mappings from the Supabase lookup DB and
 * syncs shipcore.sc_sku_mappings (channel='shiphero'), pre-creating any
 * missing shipcore.sc_products rows so the FK from the mapping-history
 * trigger is satisfied.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";

export interface KitMapping {
  channel_sku: string;
  master_sku: string;
}

export const SkuMappingsSyncRepository = {
  async getKitComponentMappings(): Promise<Array<{ parent_kit_sku: string; component_sku: string }>> {
    const lookup = getLookupPool();
    if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

    const lookupClient = await lookup.connect();
    try {
      const result = await lookupClient.query<{ parent_kit_sku: string; component_sku: string }>(
        `SELECT parent_kit_sku, component_sku
         FROM ecommerce_data.shiphero_kit_components
         WHERE parent_kit_sku IS NOT NULL AND component_sku IS NOT NULL`,
      );
      return result.rows;
    } finally {
      lookupClient.release();
    }
  },

  async ensureProductsExist(distinctMasterSkus: string[]): Promise<void> {
    if (distinctMasterSkus.length === 0) return;
    const preClient = await getPrimaryPool().connect();
    try {
      await preClient.query("BEGIN");
      await preClient.query(
        `INSERT INTO shipcore.sc_products (master_sku, product_name, status, created_at, updated_at)
         SELECT s, s, 'active', NOW(), NOW() FROM unnest($1::text[]) AS s
         ON CONFLICT (master_sku) DO NOTHING`,
        [distinctMasterSkus],
      );
      await preClient.query("COMMIT");
    } catch (e) {
      await preClient.query("ROLLBACK");
      throw e;
    } finally {
      preClient.release();
    }
  },

  async syncMappings(uniqueMappings: KitMapping[]): Promise<{ mappingsUpserted: number; mappingsDeleted: number }> {
    const primaryClient = await getPrimaryPool().connect();
    try {
      await primaryClient.query("BEGIN");

      await primaryClient.query(`
        CREATE TEMP TABLE stg_mappings (channel_sku TEXT, master_sku TEXT) ON COMMIT DROP
      `);

      let mappingsUpserted = 0;
      let mappingsDeleted = 0;

      if (uniqueMappings.length > 0) {
        const channelSkus = uniqueMappings.map((m) => m.channel_sku);
        const masterSkus = uniqueMappings.map((m) => m.master_sku);
        await primaryClient.query(
          `INSERT INTO stg_mappings (channel_sku, master_sku)
           SELECT unnest($1::text[]), unnest($2::text[])`,
          [channelSkus, masterSkus],
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
  },
};
