/**
 * Business logic for the SKU Min Sales page: a per-SKU floor on the Demand
 * Planning "T.Avg 현재" (total_avg_curr). The floor itself is applied at read
 * time by DemandPlanningService (`applyMinTotalAvgCurr`); this service only
 * manages the registrations, invalidates the dashboard cache, and audit-logs.
 */

import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { SkuMinSalesRepository, withTransaction, type SkuMinSalesRow } from "@/lib/sku-min-sales/repository";

export type Who = { userId: string | null; userName: string | null; userEmail: string | null };

export interface SkuMinSalesInput {
  masterSku: string;
  minTotalAvgCurr: number;
  note?: string | null;
}

function normalize(input: SkuMinSalesInput) {
  const masterSku = input.masterSku.trim().toUpperCase();
  const value = Number(input.minTotalAvgCurr);
  if (!masterSku || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`Invalid minimum for ${masterSku || "(blank SKU)"}`);
  }
  return {
    masterSku,
    minTotalAvgCurr: Math.round(value * 10_000) / 10_000,
    note: input.note?.trim() || null,
  };
}

function actorLabel(who: Who): string | null {
  return who.userName ?? who.userEmail ?? who.userId;
}

export const SkuMinSalesService = {
  list(): Promise<SkuMinSalesRow[]> {
    return SkuMinSalesRepository.list();
  },

  /** Picker options for the register form: active SKU Master rows, capped rather than paged. */
  async searchSkuOptions(search: string, limit: number) {
    const capped = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
    const { options, total } = await SkuMinSalesRepository.searchSkuOptions(search.trim(), capped);
    return { data: options, total };
  },

  /**
   * Registers or updates one or more SKUs in a single transaction. Used by the
   * form (one row) and the Excel import (many). A SKU already registered is
   * overwritten, so re-importing a sheet is safe.
   */
  async save(inputs: SkuMinSalesInput[], who: Who, ip: string | null) {
    if (inputs.length === 0) throw new ValidationError("No rows to save");

    // Last row wins when a sheet repeats a SKU.
    const bySku = new Map(inputs.map((input) => {
      const row = normalize(input);
      return [row.masterSku, row] as const;
    }));
    const rows = [...bySku.values()];

    const result = await withTransaction(async (client) => {
      const existing = await SkuMinSalesRepository.findExistingProductSkus(rows.map((row) => row.masterSku), client);
      const missing = rows.filter((row) => !existing.has(row.masterSku)).map((row) => row.masterSku);
      if (missing.length > 0) {
        throw new ValidationError(`SKU does not exist in SKU Master: ${missing.join(", ")}`);
      }

      const changes: Array<{ masterSku: string; before: number | null; after: number }> = [];
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const before = await SkuMinSalesRepository.getForUpdate(row.masterSku, client);
        const created = await SkuMinSalesRepository.upsert(row, actorLabel(who), client);
        if (created) inserted += 1;
        else updated += 1;
        if (before?.minTotalAvgCurr !== row.minTotalAvgCurr || before?.note !== row.note) {
          changes.push({ masterSku: row.masterSku, before: before?.minTotalAvgCurr ?? null, after: row.minTotalAvgCurr });
        }
      }
      return { inserted, updated, total: rows.length, changes };
    });

    await invalidatePlanningDashboardCache();

    for (const change of result.changes) {
      void logAudit({
        entityType: "sku_min_sales",
        entityId: change.masterSku,
        entityLabel: change.masterSku,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: change.before === null ? "create" : "update",
        before: change.before === null ? null : { minTotalAvgCurr: change.before },
        after: { minTotalAvgCurr: change.after },
        note: "SKU minimum T.Avg current",
        ip,
      });
    }

    return { inserted: result.inserted, updated: result.updated, total: result.total };
  },

  async remove(skus: string[], who: Who, ip: string | null) {
    const normalized = [...new Set(skus.map((sku) => sku.trim().toUpperCase()).filter(Boolean))];
    if (normalized.length === 0) throw new ValidationError("sku is required");

    const deleted = await SkuMinSalesRepository.deleteMany(normalized);
    if (deleted.length === 0) throw new NotFoundError("SKU minimum not found.");

    await invalidatePlanningDashboardCache();

    for (const sku of deleted) {
      void logAudit({
        entityType: "sku_min_sales",
        entityId: sku,
        entityLabel: sku,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "delete",
        note: "SKU minimum T.Avg current",
        ip,
      });
    }

    return { skus: deleted };
  },
};
