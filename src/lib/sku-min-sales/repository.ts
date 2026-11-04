/**
 * Pure data access for per-SKU minimum sales (shipcore.fc_sku_min_sales),
 * the floor applied to the Demand Planning "T.Avg 현재" column. Raw SQL only:
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

export interface SkuMinSalesRow {
  masterSku: string;
  minTotalAvgCurr: number;
  note: string | null;
  productName: string | null;
  categoryCode: string | null;
  /**
   * Calculated T.Avg current from the SKU's own stats lane (fc_stats_custom for
   * CC/FM/SWC, fc_stats otherwise), before any floor or override. Reference only:
   * the dashboard recomputes the value from its components at read time.
   */
  calculatedTotalAvgCurr: number | null;
  /** Manual override on fc_products; when set it wins over the minimum. */
  totalAvgCurrOverride: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SkuMinSalesWrite {
  masterSku: string;
  minTotalAvgCurr: number;
  note: string | null;
}

export interface ExistingSkuMinSales {
  masterSku: string;
  minTotalAvgCurr: number;
  note: string | null;
}

function mapRow(row: Record<string, unknown>): SkuMinSalesRow {
  return {
    masterSku: row.master_sku as string,
    minTotalAvgCurr: Number(row.min_total_avg_curr),
    note: (row.note as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    categoryCode: (row.category_code as string | null) ?? null,
    calculatedTotalAvgCurr: row.calculated_total_avg_curr == null ? null : Number(row.calculated_total_avg_curr),
    totalAvgCurrOverride: row.total_avg_curr_override == null ? null : Number(row.total_avg_curr_override),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export const SkuMinSalesRepository = {
  async list(): Promise<SkuMinSalesRow[]> {
    const result = await pool().query(
      `SELECT
         m.master_sku,
         m.min_total_avg_curr::float8                                AS min_total_avg_curr,
         m.note,
         p.product_name,
         p.category_code,
         (CASE WHEN p.category_code IN ('CC', 'FM', 'SWC')
               THEN sc.total_avg_curr ELSE s.total_avg_curr END)::float8 AS calculated_total_avg_curr,
         p.total_avg_curr_override::float8                           AS total_avg_curr_override,
         m.updated_by,
         m.updated_at
       FROM shipcore.fc_sku_min_sales m
       JOIN shipcore.fc_products p ON p.master_sku = m.master_sku
       LEFT JOIN shipcore.fc_stats s ON s.master_sku = m.master_sku
       LEFT JOIN shipcore.fc_stats_custom sc ON sc.master_sku = m.master_sku
       ORDER BY m.master_sku`,
    );
    return result.rows.map(mapRow);
  },

  async findExistingProductSkus(skus: string[], executor: SqlExecutor = pool()): Promise<Set<string>> {
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    return new Set(result.rows.map((row) => row.master_sku));
  },

  async getForUpdate(masterSku: string, executor: SqlExecutor = pool()): Promise<ExistingSkuMinSales | null> {
    const result = await executor.query<{ master_sku: string; min_total_avg_curr: number; note: string | null }>(
      `SELECT master_sku, min_total_avg_curr::float8 AS min_total_avg_curr, note
       FROM shipcore.fc_sku_min_sales
       WHERE master_sku = $1
       FOR UPDATE`,
      [masterSku],
    );
    const row = result.rows[0];
    return row ? { masterSku: row.master_sku, minTotalAvgCurr: Number(row.min_total_avg_curr), note: row.note } : null;
  },

  /** Insert, or overwrite the existing registration for the same SKU. Returns true when a new row was created. */
  async upsert(row: SkuMinSalesWrite, actor: string | null, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query<{ inserted: boolean }>(
      `INSERT INTO shipcore.fc_sku_min_sales (master_sku, min_total_avg_curr, note, created_by, updated_by)
       VALUES ($1, $2::numeric(14,4), $3, $4, $4)
       ON CONFLICT (master_sku) DO UPDATE
         SET min_total_avg_curr = EXCLUDED.min_total_avg_curr,
             note               = EXCLUDED.note,
             updated_by         = EXCLUDED.updated_by,
             updated_at         = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [row.masterSku, row.minTotalAvgCurr, row.note, actor],
    );
    return Boolean(result.rows[0]?.inserted);
  },

  async deleteMany(skus: string[], executor: SqlExecutor = pool()): Promise<string[]> {
    const result = await executor.query<{ master_sku: string }>(
      `DELETE FROM shipcore.fc_sku_min_sales WHERE master_sku = ANY($1::text[]) RETURNING master_sku`,
      [skus],
    );
    return result.rows.map((row) => row.master_sku);
  },
};
