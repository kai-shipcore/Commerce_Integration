/**
 * Business logic for in-transit warehouse-to-warehouse stock transfers:
 * orchestrates the fc_stats/fc_stats_custom transit_stock resync that must
 * follow every create/update/delete/import, audit-logs mutations (previously
 * unaudited), and shapes Prisma rows (BigInt id -> string) for the API.
 * Data access lives in src/lib/transit-stock/repository.ts.
 */

import type { TransitRecord } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { TransitStockRepository, type ImportTransitRecordRow } from "@/lib/transit-stock/repository";

type Who = { userId: string | null; userName: string | null; userEmail: string | null };

export interface CreateTransitRecordInput {
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  masterSku: string;
  qty: number;
  notes?: string;
}

export interface ImportTransitRecordsInput {
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  rows: Array<{ masterSku: string; qty: number; notes?: string }>;
}

export interface ListMasterSkuOptionsQuery {
  search: string;
  limit: number;
}

export interface UpdateTransitRecordInput {
  status?: "in_transit" | "arrived" | "cancelled";
  qty?: number;
  notes?: string | null;
}

// BigInt id must be converted to string before JSON serialization.
function serialize(record: TransitRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export const TransitStockService = {
  async listRecords(statusFilter: string | null) {
    const records = await TransitStockRepository.listRecords(statusFilter);
    return records.map(serialize);
  },

  // Feeds the Add Record dialog's master SKU picker. Read-only, so no audit
  // entry. The limit is capped rather than paged: a reader looking at 200
  // matches has not typed enough to be choosing between them, and `total`
  // tells the picker how many it left off.
  async listMasterSkuOptions(query: ListMasterSkuOptionsQuery) {
    const search = query.search.trim();
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    const { skus, total } = await TransitStockRepository.searchMasterSkus(search, limit);
    return { data: skus, total };
  },

  async createRecord(input: CreateTransitRecordInput, who: Who, ip: string | null) {
    const record = await TransitStockRepository.createRecord({
      sourceWarehouseCode: input.sourceWarehouseCode,
      destWarehouseCode: input.destWarehouseCode,
      masterSku: input.masterSku,
      qty: input.qty,
      notes: input.notes ?? null,
    });

    await TransitStockRepository.syncStats([input.masterSku]);

    void logAudit({
      entityType: "transit_record",
      entityId: String(record.id),
      entityLabel: `${input.sourceWarehouseCode} → ${input.destWarehouseCode}: ${input.masterSku}`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { ...input },
      ip,
    });

    return serialize(record);
  },

  async importRecords(input: ImportTransitRecordsInput, who: Who, ip: string | null) {
    const rows: ImportTransitRecordRow[] = input.rows.map((row) => ({
      masterSku: row.masterSku,
      qty: row.qty,
      notes: row.notes ?? "",
    }));

    const inserted = await TransitStockRepository.createManyRecords(input.sourceWarehouseCode, input.destWarehouseCode, rows);

    const skus = [...new Set(rows.map((row) => row.masterSku))];
    await TransitStockRepository.syncStats(skus);

    void logAudit({
      entityType: "transit_record",
      entityId: `${input.sourceWarehouseCode}->${input.destWarehouseCode}`,
      entityLabel: `Bulk import: ${input.sourceWarehouseCode} → ${input.destWarehouseCode} (${rows.length} rows)`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { sourceWarehouseCode: input.sourceWarehouseCode, destWarehouseCode: input.destWarehouseCode, rowCount: rows.length, skus },
      ip,
    });

    return inserted;
  },

  async updateRecord(id: string, input: UpdateTransitRecordInput, who: Who, ip: string | null) {
    if (input.status === undefined && input.qty === undefined && input.notes === undefined) {
      throw new ValidationError("Nothing to update");
    }

    const updated = await TransitStockRepository.updateRecord(id, input);
    if (!updated) throw new NotFoundError("Not found");

    await TransitStockRepository.syncStats([updated.masterSku]);

    void logAudit({
      entityType: "transit_record",
      entityId: id,
      entityLabel: updated.masterSku,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: input.status !== undefined ? "status_change" : "update",
      after: { ...input },
      ip,
    });
  },

  async deleteRecord(id: string, who: Who, ip: string | null) {
    const deleted = await TransitStockRepository.deleteRecord(id);
    if (!deleted) throw new NotFoundError("Not found");

    await TransitStockRepository.syncStats([deleted.masterSku]);

    void logAudit({
      entityType: "transit_record",
      entityId: id,
      entityLabel: deleted.masterSku,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      before: { status: deleted.status, qty: deleted.qty, sourceWarehouseCode: deleted.sourceWarehouseCode, destWarehouseCode: deleted.destWarehouseCode },
      ip,
    });
  },
};
