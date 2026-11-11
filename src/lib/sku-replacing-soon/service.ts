/**
 * Business logic for the Replacing Soon page: SKUs that will be replaced soon,
 * so the Demand Planning automatic order calculations stock them only up to a
 * short inventory life (default 30 days) instead of the sales-range or gradient
 * target. The cap itself is applied on the dashboard client; this service only
 * manages the registrations, invalidates the dashboard cache, and audit-logs.
 */

import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  SkuReplacingSoonRepository,
  withTransaction,
  type SkuReplacingSoonRow,
} from "@/lib/sku-replacing-soon/repository";

export type Who = { userId: string | null; userName: string | null; userEmail: string | null };

export const DEFAULT_REPLACING_SOON_DAYS = 30;

export interface SkuReplacingSoonInput {
  masterSku: string;
  targetInvLifeDays?: number | null;
  replacementSku?: string | null;
  note?: string | null;
}

function normalize(input: SkuReplacingSoonInput) {
  const masterSku = input.masterSku.trim().toUpperCase();
  const days = input.targetInvLifeDays == null ? DEFAULT_REPLACING_SOON_DAYS : Number(input.targetInvLifeDays);
  if (!masterSku || !Number.isInteger(days) || days < 1 || days > 365) {
    throw new ValidationError(`Invalid target inventory life for ${masterSku || "(blank SKU)"}: use whole days from 1 to 365`);
  }
  const replacementSku = input.replacementSku?.trim().toUpperCase() || null;
  if (replacementSku === masterSku) {
    throw new ValidationError(`${masterSku} cannot be its own replacement SKU`);
  }
  return {
    masterSku,
    targetInvLifeDays: days,
    replacementSku,
    note: input.note?.trim() || null,
  };
}

function actorLabel(who: Who): string | null {
  return who.userName ?? who.userEmail ?? who.userId;
}

type Snapshot = { targetInvLifeDays: number; replacementSku: string | null; note: string | null };

function snapshot(row: Snapshot): Snapshot {
  return { targetInvLifeDays: row.targetInvLifeDays, replacementSku: row.replacementSku, note: row.note };
}

function sameSnapshot(a: Snapshot | null, b: Snapshot): boolean {
  return a !== null && a.targetInvLifeDays === b.targetInvLifeDays && a.replacementSku === b.replacementSku && a.note === b.note;
}

export const SkuReplacingSoonService = {
  list(): Promise<SkuReplacingSoonRow[]> {
    return SkuReplacingSoonRepository.list();
  },

  /** Picker options for the register form: active SKU Master rows, capped rather than paged. */
  async searchSkuOptions(search: string, limit: number) {
    const capped = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
    const { options, total } = await SkuReplacingSoonRepository.searchSkuOptions(search.trim(), capped);
    return { data: options, total };
  },

  /**
   * Registers or updates one or more SKUs in a single transaction. Used by the
   * form (one row) and the Excel import (many). A SKU already registered is
   * overwritten, so re-importing a sheet is safe.
   */
  async save(inputs: SkuReplacingSoonInput[], who: Who, ip: string | null) {
    if (inputs.length === 0) throw new ValidationError("No rows to save");

    // Last row wins when a sheet repeats a SKU.
    const bySku = new Map(inputs.map((input) => {
      const row = normalize(input);
      return [row.masterSku, row] as const;
    }));
    const rows = [...bySku.values()];

    const result = await withTransaction(async (client) => {
      const existing = await SkuReplacingSoonRepository.findExistingProductSkus(rows.map((row) => row.masterSku), client);
      const missing = rows.filter((row) => !existing.has(row.masterSku)).map((row) => row.masterSku);
      if (missing.length > 0) {
        throw new ValidationError(`SKU does not exist in SKU Master: ${missing.join(", ")}`);
      }

      const changes: Array<{ masterSku: string; before: Snapshot | null; after: Snapshot }> = [];
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const previous = await SkuReplacingSoonRepository.getForUpdate(row.masterSku, client);
        const before = previous ? snapshot(previous) : null;
        const created = await SkuReplacingSoonRepository.upsert(row, actorLabel(who), client);
        if (created) inserted += 1;
        else updated += 1;
        const after = snapshot(row);
        if (!sameSnapshot(before, after)) changes.push({ masterSku: row.masterSku, before, after });
      }
      return { inserted, updated, total: rows.length, changes };
    });

    await invalidatePlanningDashboardCache();

    for (const change of result.changes) {
      void logAudit({
        entityType: "sku_replacing_soon",
        entityId: change.masterSku,
        entityLabel: change.masterSku,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: change.before === null ? "create" : "update",
        before: change.before,
        after: change.after,
        note: "SKU replacing soon",
        ip,
      });
    }

    return { inserted: result.inserted, updated: result.updated, total: result.total };
  },

  async remove(skus: string[], who: Who, ip: string | null) {
    const normalized = [...new Set(skus.map((sku) => sku.trim().toUpperCase()).filter(Boolean))];
    if (normalized.length === 0) throw new ValidationError("sku is required");

    const deleted = await SkuReplacingSoonRepository.deleteMany(normalized);
    if (deleted.length === 0) throw new NotFoundError("Replacing-soon SKU not found.");

    await invalidatePlanningDashboardCache();

    for (const sku of deleted) {
      void logAudit({
        entityType: "sku_replacing_soon",
        entityId: sku,
        entityLabel: sku,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "delete",
        note: "SKU replacing soon",
        ip,
      });
    }

    return { skus: deleted };
  },
};
