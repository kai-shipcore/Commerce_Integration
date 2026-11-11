/**
 * Pure data access for SKUs that will be replaced soon
 * (shipcore.fc_sku_replacing_soon). The Demand Planning automatic order
 * calculations cap a registered SKU at its target inventory life. Raw SQL only:
 * no Prisma model exists for this table or for fc_products.
 *
 * Methods accept an optional `executor` (defaults to the shared pool) so the
 * Service can run several calls in one transaction via `withTransaction()`.
 */

import type { Pool, PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";

export type SqlExecutor = Pick<Pool, "query">;

function pool(): SqlExecutor {
  return getPrimaryPool();
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface SkuReplacingSoonRow {
  masterSku: string;
  targetInvLifeDays: number;
  replacementSku: string | null;
  note: string | null;
  productName: string | null;
  categoryCode: string | null;
  salesStatus: string | null;
  /** Calculated T.Avg current from the SKU's own stats lane. Reference only. */
  calculatedTotalAvgCurr: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SkuReplacingSoonWrite {
  masterSku: string;
  targetInvLifeDays: number;
  replacementSku: string | null;
  note: string | null;
}

export interface ReplacingSoonSkuOption {
  masterSku: string;
  productName: string | null;
  calculatedTotalAvgCurr: number | null;
  /** Target days already registered for this SKU, or null. */
  registeredDays: number | null;
}

export interface ExistingSkuReplacingSoon {
  masterSku: string;
  targetInvLifeDays: number;
  replacementSku: string | null;
  note: string | null;
}

/** Escapes LIKE wildcards so a typed "_" or "%" matches literally. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function mapRow(row: Record<string, unknown>): SkuReplacingSoonRow {
  return {
    masterSku: row.master_sku as string,
    targetInvLifeDays: Number(row.target_inv_life_days),
    replacementSku: (row.replacement_sku as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    categoryCode: (row.category_code as string | null) ?? null,
    salesStatus: (row.sales_status as string | null) ?? null,
    calculatedTotalAvgCurr: row.calculated_total_avg_curr == null ? null : Number(row.calculated_total_avg_curr),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export const SkuReplacingSoonRepository = {
  async list(): Promise<SkuReplacingSoonRow[]> {
    const result = await pool().query(
      `SELECT
         r.master_sku,
         r.target_inv_life_days,
         r.replacement_sku,
         r.note,
         p.product_name,
         p.category_code,
         p.sales_status,
         (CASE WHEN p.category_code IN ('CC', 'FM', 'SWC')
               THEN sc.total_avg_curr ELSE s.total_avg_curr END)::float8 AS calculated_total_avg_curr,
         r.updated_by,
         r.updated_at
       FROM shipcore.fc_sku_replacing_soon r
       JOIN shipcore.fc_products p ON p.master_sku = r.master_sku
       LEFT JOIN shipcore.fc_stats s ON s.master_sku = r.master_sku
       LEFT JOIN shipcore.fc_stats_custom sc ON sc.master_sku = r.master_sku
       ORDER BY r.master_sku`,
    );
    return result.rows.map(mapRow);
  },

  /** Active SKU Master rows matching a SKU or product-name substring, capped at `limit`. */
  async searchSkuOptions(search: string, limit: number): Promise<{ options: ReplacingSoonSkuOption[]; total: number }> {
    const result = await pool().query(
      `SELECT
         p.master_sku,
         p.product_name,
         (CASE WHEN p.category_code IN ('CC', 'FM', 'SWC')
               THEN sc.total_avg_curr ELSE s.total_avg_curr END)::float8 AS calculated_total_avg_curr,
         r.target_inv_life_days                                       AS registered_days,
         COUNT(*) OVER ()::int                                        AS total
       FROM shipcore.fc_products p
       LEFT JOIN shipcore.fc_stats s ON s.master_sku = p.master_sku
       LEFT JOIN shipcore.fc_stats_custom sc ON sc.master_sku = p.master_sku
       LEFT JOIN shipcore.fc_sku_replacing_soon r ON r.master_sku = p.master_sku
       WHERE p.status = 'active'
         AND ($1 = '' OR p.master_sku ILIKE $2 OR p.product_name ILIKE $2)
       ORDER BY p.master_sku
       LIMIT $3`,
      [search, likePattern(search), limit],
    );
    return {
      options: result.rows.map((row) => ({
        masterSku: row.master_sku as string,
        productName: (row.product_name as string | null) ?? null,
        calculatedTotalAvgCurr: row.calculated_total_avg_curr == null ? null : Number(row.calculated_total_avg_curr),
        registeredDays: row.registered_days == null ? null : Number(row.registered_days),
      })),
      total: Number(result.rows[0]?.total ?? 0),
    };
  },

  async findExistingProductSkus(skus: string[], executor: SqlExecutor = pool()): Promise<Set<string>> {
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    return new Set(result.rows.map((row) => row.master_sku));
  },

  async getForUpdate(masterSku: string, executor: SqlExecutor = pool()): Promise<ExistingSkuReplacingSoon | null> {
    const result = await executor.query<{
      master_sku: string;
      target_inv_life_days: number;
      replacement_sku: string | null;
      note: string | null;
    }>(
      `SELECT master_sku, target_inv_life_days, replacement_sku, note
       FROM shipcore.fc_sku_replacing_soon
       WHERE master_sku = $1
       FOR UPDATE`,
      [masterSku],
    );
    const row = result.rows[0];
    return row
      ? {
          masterSku: row.master_sku,
          targetInvLifeDays: Number(row.target_inv_life_days),
          replacementSku: row.replacement_sku,
          note: row.note,
        }
      : null;
  },

  /** Insert, or overwrite the existing registration for the same SKU. Returns true when a new row was created. */
  async upsert(row: SkuReplacingSoonWrite, actor: string | null, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query<{ inserted: boolean }>(
      `INSERT INTO shipcore.fc_sku_replacing_soon
         (master_sku, target_inv_life_days, replacement_sku, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (master_sku) DO UPDATE
         SET target_inv_life_days = EXCLUDED.target_inv_life_days,
             replacement_sku      = EXCLUDED.replacement_sku,
             note                 = EXCLUDED.note,
             updated_by           = EXCLUDED.updated_by,
             updated_at           = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [row.masterSku, row.targetInvLifeDays, row.replacementSku, row.note, actor],
    );
    return Boolean(result.rows[0]?.inserted);
  },

  async deleteMany(skus: string[], executor: SqlExecutor = pool()): Promise<string[]> {
    const result = await executor.query<{ master_sku: string }>(
      `DELETE FROM shipcore.fc_sku_replacing_soon WHERE master_sku = ANY($1::text[]) RETURNING master_sku`,
      [skus],
    );
    return result.rows.map((row) => row.master_sku);
  },
};
