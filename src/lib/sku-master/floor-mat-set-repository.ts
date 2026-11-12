/**
 * Pure data access for floor mat set links (shipcore.fc_floor_mat_sets),
 * edited on the SKU Master page. Raw SQL only. Methods take an optional
 * executor so the Excel import can write sets inside its own transaction.
 */

import type { Pool } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { isEmptyFloorMatSet, type FloorMatSet, type FloorMatThirdRow } from "@/lib/planning/floor-mat-sets";

export type SqlExecutor = Pick<Pool, "query">;

interface FloorMatSetDbRow {
  master_sku: string;
  front_sku: string | null;
  rear_sku: string | null;
  preorder_12: boolean | null;
  preorder_3: boolean | null;
  third_rows: unknown;
  old_set_skus: string[] | null;
}

function parseThirdRows(value: unknown): FloorMatThirdRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = (entry ?? {}) as { sku?: unknown; preOrder?: unknown };
      return {
        sku: String(row.sku ?? "").trim(),
        preOrder: typeof row.preOrder === "boolean" ? row.preOrder : null,
      };
    })
    .filter((row) => row.sku);
}

function toFloorMatSet(row: FloorMatSetDbRow): FloorMatSet {
  return {
    frontSku: row.front_sku,
    rearSku: row.rear_sku,
    preOrder12: row.preorder_12,
    preOrder3: row.preorder_3,
    thirdRows: parseThirdRows(row.third_rows),
    oldSetSkus: row.old_set_skus ?? [],
  };
}

// Postgres "undefined_table". The table arrives with migration
// 20261112120000_add_floor_mat_sets; until that has run against a database,
// reads report "no sets" so the SKU Master page keeps loading. Writes are not
// softened: saving a set against a database without the table must fail loudly.
const UNDEFINED_TABLE = "42P01";

export const FloorMatSetRepository = {
  async findBySkus(masterSkus: string[], executor: SqlExecutor = getPrimaryPool()): Promise<Map<string, FloorMatSet>> {
    if (masterSkus.length === 0) return new Map();
    try {
      const result = await executor.query<FloorMatSetDbRow>(
        `SELECT master_sku, front_sku, rear_sku, preorder_12, preorder_3, third_rows, old_set_skus
         FROM shipcore.fc_floor_mat_sets
         WHERE master_sku = ANY($1::text[])`,
        [masterSkus]
      );
      return new Map(result.rows.map((row) => [row.master_sku, toFloorMatSet(row)]));
    } catch (error) {
      if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) return new Map();
      throw error;
    }
  },

  /** Which of these SKUs have an fc_products row. */
  async findExistingProductSkus(masterSkus: string[], executor: SqlExecutor = getPrimaryPool()): Promise<Set<string>> {
    if (masterSkus.length === 0) return new Set();
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [masterSkus]
    );
    return new Set(result.rows.map((row) => row.master_sku));
  },

  /** Stores the set as given; an empty set removes the row. */
  async save(
    masterSku: string,
    set: FloorMatSet,
    actor: string | null,
    executor: SqlExecutor = getPrimaryPool()
  ): Promise<void> {
    if (isEmptyFloorMatSet(set)) {
      await executor.query(`DELETE FROM shipcore.fc_floor_mat_sets WHERE master_sku = $1`, [masterSku]);
      return;
    }
    await executor.query(
      `INSERT INTO shipcore.fc_floor_mat_sets
         (master_sku, front_sku, rear_sku, preorder_12, preorder_3, third_rows, old_set_skus, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::text[], $8, $8)
       ON CONFLICT (master_sku) DO UPDATE SET
         front_sku = EXCLUDED.front_sku,
         rear_sku = EXCLUDED.rear_sku,
         preorder_12 = EXCLUDED.preorder_12,
         preorder_3 = EXCLUDED.preorder_3,
         third_rows = EXCLUDED.third_rows,
         old_set_skus = EXCLUDED.old_set_skus,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        masterSku,
        set.frontSku,
        set.rearSku,
        set.preOrder12,
        set.preOrder3,
        JSON.stringify(set.thirdRows),
        set.oldSetSkus,
        actor,
      ]
    );
  },
};
