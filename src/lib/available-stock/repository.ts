/**
 * Pure data access for available stock records (shipcore.fc_available_stock)
 * on the Available Stock planning page: list/create/update/delete + Excel
 * import. Raw SQL only — no Prisma model exists for this table.
 *
 * The container-allocation logic that also lives in
 * src/app/api/container-available-stock/route.ts (POST action="allocate",
 * DELETE by allocationIds) is intentionally NOT part of this
 * repository/service — it belongs to the not-yet-refactored
 * container-planning domain and stays embedded in the controller as-is.
 *
 * Several methods accept an optional `executor` (defaults to the shared
 * pool) so the Service can compose multiple calls into one transaction via
 * `withTransaction()` — e.g. check SKU exists, then insert.
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

export interface AvailableStockRow {
  id: string;
  sourceType: "remaining" | "mistake";
  referenceNo: string;
  plNo: string | null;
  masterSku: string;
  totalQty: number;
  availableQty: number;
  allocatedToContainer: number;
  cbm: number;
  note: string | null;
}

export interface StockWriteInput {
  sourceType: "remaining" | "mistake";
  referenceNo: string;
  plNo: string | null;
  masterSku: string;
  totalQty: number;
  cbm: number;
  note: string | null;
}

export interface ExistingStockRow {
  sourceType: "remaining" | "mistake";
  masterSku: string;
  cbm: number;
  allocatedQty: number;
}

export const AvailableStockRepository = {
  async listStock(containerId: string | null): Promise<AvailableStockRow[]> {
    const params: unknown[] = [];
    let allocationExpr = "0::int";
    if (containerId && /^\d+$/.test(containerId)) {
      params.push(containerId);
      allocationExpr = `COALESCE(SUM(a.qty) FILTER (WHERE a.container_id = $1::bigint), 0)::int`;
    }

    const result = await pool().query(
      `SELECT
         s.id::text AS id,
         s.source_type,
         s.reference_no,
         s.pl_no,
         s.master_sku,
         s.total_qty::int,
         s.cbm_unit::float8 AS cbm,
         s.note,
         (s.total_qty - COALESCE(SUM(a.qty), 0))::int AS available_qty,
         ${allocationExpr} AS allocated_to_container
       FROM shipcore.fc_available_stock s
       LEFT JOIN shipcore.fc_container_item_allocations a ON a.source_stock_id = s.id
       GROUP BY s.id
       ORDER BY s.source_type, s.reference_no, s.master_sku`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      sourceType: row.source_type as "remaining" | "mistake",
      referenceNo: row.reference_no as string,
      plNo: row.pl_no as string | null,
      masterSku: row.master_sku as string,
      totalQty: Number(row.total_qty),
      availableQty: Number(row.available_qty),
      allocatedToContainer: Number(row.allocated_to_container),
      cbm: Number(row.cbm),
      note: row.note as string | null,
    }));
  },

  async findProductCbmMap(skus: string[], executor: SqlExecutor = pool()): Promise<Map<string, number>> {
    const result = await executor.query<{ master_sku: string; cbm: number }>(
      `SELECT master_sku, cbm_per_unit::float8 AS cbm
       FROM shipcore.fc_products
       WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    return new Map(result.rows.map((row) => [row.master_sku, Number(row.cbm)]));
  },

  async productExists(masterSku: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = $1 LIMIT 1`,
      [masterSku],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async insertStockIfNotExists(row: StockWriteInput, executor: SqlExecutor = pool()): Promise<string | null> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO shipcore.fc_available_stock
         (source_type, reference_no, pl_no, master_sku, total_qty, cbm_unit, note)
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::int, $6::numeric(14,6), $7::text
       WHERE NOT EXISTS (
         SELECT 1 FROM shipcore.fc_available_stock
         WHERE source_type = $1::varchar
           AND reference_no = $2::varchar
           AND pl_no IS NOT DISTINCT FROM $3::varchar
           AND master_sku = $4::varchar
       )
       RETURNING id::text AS id`,
      [row.sourceType, row.referenceNo, row.plNo, row.masterSku, row.totalQty, row.cbm, row.note],
    );
    return result.rowCount === 1 ? result.rows[0].id : null;
  },

  async insertStock(row: StockWriteInput): Promise<string> {
    const result = await pool().query<{ id: string }>(
      `INSERT INTO shipcore.fc_available_stock
         (source_type, reference_no, pl_no, master_sku, total_qty, cbm_unit, note)
       VALUES ($1, $2, $3, $4, $5, $6::numeric(14,6), $7)
       RETURNING id::text AS id`,
      [row.sourceType, row.referenceNo, row.plNo, row.masterSku, row.totalQty, row.cbm, row.note],
    );
    return result.rows[0].id;
  },

  async getStockForUpdate(id: string, executor: SqlExecutor = pool()): Promise<ExistingStockRow | null> {
    const result = await executor.query<{ source_type: "remaining" | "mistake"; master_sku: string; cbm: number; allocated_qty: number }>(
      `SELECT
         s.source_type,
         s.master_sku,
         s.cbm_unit::float8 AS cbm,
         COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0)::int AS allocated_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = $1::bigint
       FOR UPDATE OF s`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { sourceType: row.source_type, masterSku: row.master_sku, cbm: row.cbm, allocatedQty: row.allocated_qty };
  },

  async updateStock(id: string, row: StockWriteInput, executor: SqlExecutor = pool()): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_available_stock
       SET source_type = $2,
           reference_no = $3,
           pl_no = $4,
           master_sku = $5,
           total_qty = $6::int,
           cbm_unit = $7::numeric(14,6),
           note = $8,
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [id, row.sourceType, row.referenceNo, row.plNo, row.masterSku, row.totalQty, row.cbm, row.note],
    );
  },

  async getStocksForDeleteCheck(ids: string[], executor: SqlExecutor = pool()): Promise<Array<{ id: string; allocatedQty: number }>> {
    const result = await executor.query<{ id: string; allocated_qty: number }>(
      `SELECT
         s.id::text,
         COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0)::int AS allocated_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = ANY($1::bigint[])
       FOR UPDATE OF s`,
      [ids],
    );
    return result.rows.map((row) => ({ id: row.id, allocatedQty: row.allocated_qty }));
  },

  async deleteStocks(ids: string[], executor: SqlExecutor = pool()): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_available_stock WHERE id = ANY($1::bigint[])`, [ids]);
  },
};
