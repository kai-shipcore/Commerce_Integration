/**
 * Pure data access for in-transit warehouse-to-warehouse stock transfers
 * (shipcore.fc_transit_records, via Prisma — the model matches the table
 * 1:1, so this domain uses prisma.transitRecord directly instead of raw
 * SQL). syncStats() is the one exception: it recalculates the transit_stock
 * column on shipcore.fc_stats / fc_stats_custom, both raw-SQL-only tables
 * with no Prisma model, owned by the future Available Stock domain — this
 * repository only writes that one column as a side effect of transit
 * record changes, same as the original standalone helper it replaces.
 */

import { Prisma, type TransitRecord } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";

export interface CreateTransitRecordData {
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  masterSku: string;
  qty: number;
  notes: string | null;
}

export interface ImportTransitRecordRow {
  masterSku: string;
  qty: number;
  notes: string;
}

export interface UpdateTransitRecordData {
  status?: string;
  qty?: number;
  notes?: string | null;
}

export interface MasterSkuSearchResult {
  skus: string[];
  /** Matches before the LIMIT, so the picker can say how many it left off. */
  total: number;
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

export const TransitStockRepository = {
  listRecords(statusFilter: string | null): Promise<TransitRecord[]> {
    return prisma.transitRecord.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { createdAt: "desc" },
    });
  },

  // Reads shipcore.fc_products, which the SKU Master domain owns — the second
  // exception in this file, for a different reason than syncStats: the Add
  // Record dialog needs the master SKU list to pick from, and the SKU Master
  // route that already returns it is behind sku-master:read, so a user with
  // transit-stock permissions only would get a 403 from it. One column, read
  // only. COUNT(*) OVER () gets the pre-LIMIT total in the same round trip.
  async searchMasterSkus(search: string, limit: number): Promise<MasterSkuSearchResult> {
    const result = await getPrimaryPool().query<{ master_sku: string; total: string }>(
      `SELECT master_sku, COUNT(*) OVER ()::text AS total
       FROM shipcore.fc_products
       WHERE status = 'active'
         AND ($1 = '' OR master_sku ILIKE '%' || $1 || '%')
       ORDER BY master_sku
       LIMIT $2`,
      [search, limit],
    );
    return {
      skus: result.rows.map((row) => row.master_sku),
      total: Number(result.rows[0]?.total ?? 0),
    };
  },

  createRecord(data: CreateTransitRecordData): Promise<TransitRecord> {
    return prisma.transitRecord.create({
      data: { ...data, status: "in_transit" },
    });
  },

  async createManyRecords(
    sourceWarehouseCode: string,
    destWarehouseCode: string,
    rows: ImportTransitRecordRow[],
  ): Promise<number> {
    const result = await prisma.transitRecord.createMany({
      data: rows.map((row) => ({
        sourceWarehouseCode,
        destWarehouseCode,
        masterSku: row.masterSku,
        qty: row.qty,
        status: "in_transit",
        notes: row.notes,
      })),
    });
    return result.count;
  },

  async updateRecord(id: string, data: UpdateTransitRecordData): Promise<TransitRecord | null> {
    try {
      return await prisma.transitRecord.update({ where: { id: BigInt(id) }, data });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  },

  async deleteRecord(id: string): Promise<TransitRecord | null> {
    try {
      return await prisma.transitRecord.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  },

  async syncStats(skus: string[]): Promise<void> {
    if (skus.length === 0) return;
    const pool = getPrimaryPool();
    const subquery = `
      COALESCE((
        SELECT SUM(qty) FROM shipcore.fc_transit_records
        WHERE master_sku = s.master_sku AND status = 'in_transit'
      ), 0)
    `;
    await Promise.all([
      pool.query(
        `UPDATE shipcore.fc_stats s SET transit_stock = ${subquery}, updated_at = NOW() WHERE s.master_sku = ANY($1::text[])`,
        [skus],
      ),
      pool.query(
        `UPDATE shipcore.fc_stats_custom s SET transit_stock = ${subquery}, updated_at = NOW() WHERE s.master_sku = ANY($1::text[])`,
        [skus],
      ),
    ]);
  },

  async syncAllStats(): Promise<void> {
    const pool = getPrimaryPool();
    const updateSql = (table: "fc_stats" | "fc_stats_custom") => `
      WITH actual AS (
        SELECT master_sku, SUM(qty)::int AS qty
        FROM shipcore.fc_transit_records
        WHERE status = 'in_transit'
        GROUP BY master_sku
      )
      UPDATE shipcore.${table} s
      SET transit_stock = COALESCE(source.qty, 0),
          updated_at = NOW()
      FROM (
        SELECT stats.master_sku, actual.qty
        FROM shipcore.${table} stats
        LEFT JOIN actual USING (master_sku)
      ) source
      WHERE s.master_sku = source.master_sku
        AND s.transit_stock IS DISTINCT FROM COALESCE(source.qty, 0)
    `;

    await Promise.all([
      pool.query(updateSql("fc_stats")),
      pool.query(updateSql("fc_stats_custom")),
    ]);
  },
};
