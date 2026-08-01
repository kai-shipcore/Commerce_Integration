/**
 * Business logic for the Available Stock planning page: SKU-master
 * validation, the Excel-import loop, allocation-aware guard rails on
 * update/delete, cache invalidation, and audit logging (previously
 * missing entirely on this domain). Data access lives in
 * src/lib/available-stock/repository.ts. The container-allocation
 * concern embedded in the same route file is out of scope here — see the
 * repository's module comment.
 */

import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { logAudit } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { AvailableStockRepository, withTransaction, type AvailableStockRow } from "@/lib/available-stock/repository";

type Who = { userId: string | null; userName: string | null; userEmail: string | null };

export interface StockInput {
  sourceType: "remaining" | "mistake";
  referenceNo: string;
  plNo?: string;
  masterSku: string;
  totalQty: number;
  cbm: number;
  note?: string;
}

export interface ImportRowInput {
  sourceType: "remaining" | "mistake";
  referenceNo: string;
  plNo?: string;
  masterSku: string;
  totalQty: number;
  cbm?: number;
  note?: string;
}

function normalizeImportRow(row: ImportRowInput) {
  return {
    sourceType: row.sourceType,
    referenceNo: row.referenceNo.trim(),
    plNo: row.plNo?.trim() || null,
    masterSku: row.masterSku.trim().toUpperCase(),
    totalQty: row.totalQty,
    cbm: row.cbm,
    note: row.note?.trim() || null,
  };
}

export const AvailableStockService = {
  listStock(containerId: string | null): Promise<AvailableStockRow[]> {
    return AvailableStockRepository.listStock(containerId);
  },

  async importStock(rows: ImportRowInput[], who: Who, ip: string | null) {
    const normalizedRows = rows.map(normalizeImportRow);

    const result = await withTransaction(async (client) => {
      const skus = [...new Set(normalizedRows.map((row) => row.masterSku))];
      const cbmBySku = await AvailableStockRepository.findProductCbmMap(skus, client);
      const missingSkus = skus.filter((sku) => !cbmBySku.has(sku));
      if (missingSkus.length > 0) {
        throw new ValidationError(`SKU does not exist in SKU Master: ${missingSkus.join(", ")}`);
      }

      let inserted = 0;
      let skipped = 0;
      for (const row of normalizedRows) {
        const cbm = row.cbm ?? cbmBySku.get(row.masterSku) ?? 0;
        if (cbm <= 0) {
          throw new Error(`No CBM per unit on file for ${row.masterSku}.`);
        }
        const id = await AvailableStockRepository.insertStockIfNotExists({ ...row, cbm }, client);
        if (id) inserted += 1;
        else skipped += 1;
      }
      return { inserted, skipped, total: normalizedRows.length };
    });

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "available_stock",
      entityId: "bulk-import",
      entityLabel: `Bulk import (${result.total} rows)`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: result,
      ip,
    });

    return result;
  },

  async createStock(input: StockInput, who: Who, ip: string | null) {
    const masterSku = input.masterSku.toUpperCase();
    const exists = await AvailableStockRepository.productExists(masterSku);
    if (!exists) {
      throw new ValidationError(`SKU not found in SKU Master: ${masterSku}`);
    }

    const id = await AvailableStockRepository.insertStock({
      sourceType: input.sourceType,
      referenceNo: input.referenceNo,
      plNo: input.plNo || null,
      masterSku,
      totalQty: input.totalQty,
      cbm: input.cbm,
      note: input.note || null,
    });

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "available_stock",
      entityId: id,
      entityLabel: `${masterSku} (${input.referenceNo})`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { ...input, masterSku },
      ip,
    });

    return { id };
  },

  async updateStock(id: string, input: StockInput, who: Who, ip: string | null) {
    const masterSku = input.masterSku.toUpperCase();

    await withTransaction(async (client) => {
      const exists = await AvailableStockRepository.productExists(masterSku, client);
      if (!exists) {
        throw new ValidationError(`SKU not found in SKU Master: ${masterSku}`);
      }

      const current = await AvailableStockRepository.getStockForUpdate(id, client);
      if (!current) {
        throw new NotFoundError("Available stock not found.");
      }

      if (input.totalQty < current.allocatedQty) {
        throw new ConflictError(`Quantity cannot be less than allocated quantity (${current.allocatedQty}).`);
      }
      if (
        current.allocatedQty > 0 &&
        (input.sourceType !== current.sourceType || masterSku !== current.masterSku || input.cbm !== current.cbm)
      ) {
        throw new ConflictError("Allocated stock cannot change list, Master SKU, or CBM.");
      }

      await AvailableStockRepository.updateStock(id, {
        sourceType: input.sourceType,
        referenceNo: input.referenceNo,
        plNo: input.plNo || null,
        masterSku,
        totalQty: input.totalQty,
        cbm: input.cbm,
        note: input.note || null,
      }, client);
    });

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "available_stock",
      entityId: id,
      entityLabel: `${masterSku} (${input.referenceNo})`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "update",
      after: { ...input, masterSku },
      ip,
    });

    return { id };
  },

  async deleteStock(ids: string[], who: Who, ip: string | null) {
    await withTransaction(async (client) => {
      const stocks = await AvailableStockRepository.getStocksForDeleteCheck(ids, client);
      if (stocks.length !== ids.length) {
        throw new NotFoundError("Available stock not found.");
      }

      const blockedCount = stocks.filter((row) => row.allocatedQty > 0).length;
      if (blockedCount > 0) {
        throw new ConflictError(
          ids.length > 1
            ? `Allocated stock cannot be deleted. ${blockedCount} of ${ids.length} selected items have a container allocation — remove it first.`
            : "Allocated stock cannot be deleted. Remove its container allocation first.",
        );
      }

      await AvailableStockRepository.deleteStocks(ids, client);
    });

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "available_stock",
      entityId: ids.join(","),
      entityLabel: ids.length > 1 ? `${ids.length} records` : ids[0],
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      ip,
    });

    return { ids };
  },
};
