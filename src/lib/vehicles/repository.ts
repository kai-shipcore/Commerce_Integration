/**
 * Pure data access for shipcore.sc_product_vehicle (the Vehicles admin
 * page). Raw SQL only — no Prisma model exists for this table.
 *
 * syncFromLookup() was moved here from src/lib/db/primary-db.ts (it lived
 * alongside unrelated sync helpers for other domains — syncProducts,
 * syncSkuMappings — which are untouched and stay there).
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";

export const VEHICLE_INSERT_COLUMNS = [
  "f_number",
  "vehicle_type",
  "year_generation",
  "make",
  "model",
  "model_2",
  "submodel_1_label", "submodel_1",
  "submodel_2_label", "submodel_2",
  "submodel_3_label", "submodel_3",
  "submodel_4_label", "submodel_4",
  "submodel_5_label", "submodel_5",
  "submodel_6_label", "submodel_6",
] as const;

export const VEHICLE_UPDATE_COLUMNS = [
  "vehicle_type",
  "year_generation",
  "make",
  "model",
  "model_2",
  "submodel_1_label", "submodel_1",
  "submodel_2_label", "submodel_2",
  "submodel_3_label", "submodel_3",
  "submodel_4_label", "submodel_4",
  "submodel_5_label", "submodel_5",
  "submodel_6_label", "submodel_6",
] as const;

export const VehiclesRepository = {
  async listVehicles(): Promise<Record<string, unknown>[]> {
    const result = await getPrimaryPool().query(`
      SELECT
        id, f_number, vehicle_type, year_generation,
        make, model, model_2,
        submodel_1_label, submodel_1,
        submodel_2_label, submodel_2,
        submodel_3_label, submodel_3,
        submodel_4_label, submodel_4,
        submodel_5_label, submodel_5,
        submodel_6_label, submodel_6,
        updated_at
      FROM shipcore.sc_product_vehicle
      ORDER BY make, model, f_number
    `);
    return result.rows;
  },

  async insertVehicle(cols: string[], values: unknown[]): Promise<void> {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await getPrimaryPool().query(
      `INSERT INTO shipcore.sc_product_vehicle (${cols.join(", ")}) VALUES (${placeholders})`,
      values,
    );
  },

  async updateVehicle(id: number, setClauses: string[], values: unknown[]): Promise<void> {
    await getPrimaryPool().query(
      `UPDATE shipcore.sc_product_vehicle SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
      values,
    );
  },

  async listDistinctMakes(): Promise<string[]> {
    const result = await getPrimaryPool().query<{ make: string }>(
      `SELECT DISTINCT make FROM shipcore.sc_product_vehicle
       WHERE make IS NOT NULL
       ORDER BY make`,
    );
    return result.rows.map((r) => r.make);
  },

  async listDistinctModelsForMake(make: string): Promise<string[]> {
    const result = await getPrimaryPool().query<{ model: string }>(
      `SELECT DISTINCT model FROM shipcore.sc_product_vehicle
       WHERE make = $1 AND model IS NOT NULL
       ORDER BY model`,
      [make],
    );
    return result.rows.map((r) => r.model);
  },

  async syncFromLookup(): Promise<{ upserted: number; deleted: number }> {
    const lookup = getLookupPool();
    if (!lookup) throw new Error("Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured");

    const lookupClient = await lookup.connect();
    let rows: Array<Record<string, unknown>>;
    try {
      const result = await lookupClient.query(`
        SELECT f_number, vehicle_type, year_generation,
               make, model, model_2,
               submodel_1_label, submodel_1, submodel_2_label, submodel_2,
               submodel_3_label, submodel_3, submodel_4_label, submodel_4,
               submodel_5_label, submodel_5, submodel_6_label, submodel_6,
               COALESCE(updated_at, created_at, NOW()) AS updated_at
        FROM size_chart.product_vehicle
      `);
      // f_number, make, model are NOT NULL in target — skip incomplete rows
      rows = result.rows.filter((r) => r.f_number && r.make && r.model);
    } finally {
      lookupClient.release();
    }

    const primary = getPrimaryPool();
    const primaryClient = await primary.connect();
    try {
      await primaryClient.query("BEGIN");

      // Sync sequence to current max id to prevent pkey collisions on new inserts
      await primaryClient.query(`
        SELECT setval(
          'shipcore.sc_product_vehicle_id_seq',
          COALESCE((SELECT MAX(id) FROM shipcore.sc_product_vehicle), 0)
        )
      `);

      // Staging table holds only f_numbers for the DELETE step
      await primaryClient.query(`
        CREATE TEMP TABLE stg_pv_keys (f_number TEXT) ON COMMIT DROP
      `);

      if (rows.length > 0) {
        const fNumbers = rows.map((r) => r.f_number as string);
        // Insert f_numbers in batches of 5000
        for (let i = 0; i < fNumbers.length; i += 5000) {
          const batch = fNumbers.slice(i, i + 5000);
          await primaryClient.query(
            `INSERT INTO stg_pv_keys (f_number) SELECT unnest($1::text[])`,
            [batch],
          );
        }

        // Upsert into sc_product_vehicle using f_number as conflict key
        // id is auto-generated by the sequence — do not insert it
        for (let i = 0; i < rows.length; i += 1000) {
          const batch = rows.slice(i, i + 1000);
          const cols = 19; // columns per row
          const placeholders = batch.map((_, j) => {
            const b = j * cols;
            return `(${Array.from({ length: cols }, (__, k) => `$${b + k + 1}`).join(",")})`;
          }).join(",");
          const params = batch.flatMap((r) => [
            r.f_number,
            r.vehicle_type ?? null,
            r.year_generation ?? null,
            r.make,
            r.model,
            r.model_2 ?? null,
            r.submodel_1_label ?? null, r.submodel_1 ?? null,
            r.submodel_2_label ?? null, r.submodel_2 ?? null,
            r.submodel_3_label ?? null, r.submodel_3 ?? null,
            r.submodel_4_label ?? null, r.submodel_4 ?? null,
            r.submodel_5_label ?? null, r.submodel_5 ?? null,
            r.submodel_6_label ?? null, r.submodel_6 ?? null,
            r.updated_at,
          ]);
          await primaryClient.query(
            `INSERT INTO shipcore.sc_product_vehicle
               (f_number, vehicle_type, year_generation,
                make, model, model_2,
                submodel_1_label, submodel_1, submodel_2_label, submodel_2,
                submodel_3_label, submodel_3, submodel_4_label, submodel_4,
                submodel_5_label, submodel_5, submodel_6_label, submodel_6,
                updated_at)
             VALUES ${placeholders}
             ON CONFLICT (f_number) DO UPDATE SET
               vehicle_type     = EXCLUDED.vehicle_type,
               year_generation  = EXCLUDED.year_generation,
               make             = EXCLUDED.make,
               model            = EXCLUDED.model,
               model_2          = EXCLUDED.model_2,
               submodel_1_label = EXCLUDED.submodel_1_label,
               submodel_1       = EXCLUDED.submodel_1,
               submodel_2_label = EXCLUDED.submodel_2_label,
               submodel_2       = EXCLUDED.submodel_2,
               submodel_3_label = EXCLUDED.submodel_3_label,
               submodel_3       = EXCLUDED.submodel_3,
               submodel_4_label = EXCLUDED.submodel_4_label,
               submodel_4       = EXCLUDED.submodel_4,
               submodel_5_label = EXCLUDED.submodel_5_label,
               submodel_5       = EXCLUDED.submodel_5,
               submodel_6_label = EXCLUDED.submodel_6_label,
               submodel_6       = EXCLUDED.submodel_6,
               updated_at       = EXCLUDED.updated_at`,
            params,
          );
        }
      }

      // Delete rows no longer in source
      const del = await primaryClient.query(`
        DELETE FROM shipcore.sc_product_vehicle pv
        WHERE NOT EXISTS (SELECT 1 FROM stg_pv_keys s WHERE s.f_number = pv.f_number)
      `);

      await primaryClient.query("COMMIT");
      return { upserted: rows.length, deleted: del.rowCount ?? 0 };
    } catch (e) {
      await primaryClient.query("ROLLBACK");
      throw e;
    } finally {
      primaryClient.release();
    }
  },
};
