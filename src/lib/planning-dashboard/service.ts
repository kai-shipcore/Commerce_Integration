/**
 * Business logic for the Demand Planning dashboard pieces this app owns:
 * shared master-SKU notes, short workflow labels, the CBM-per-unit inline
 * editor (with its fc_container_items cascade + audit trail), and the OOS
 * lost-demand-weight preview. Data access lives in
 * src/lib/planning-dashboard/repository.ts.
 */

import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { ValidationError } from "@/lib/errors";
import { OOS_LOST_DEMAND_CATEGORIES, OOS_LOST_DEMAND_MARKETPLACES, type CategoryKey } from "@/lib/planning/oos-lost-demand-weights";
import { PlanningDashboardRepository, withTransaction, type WorkNoteSlot } from "@/lib/planning-dashboard/repository";

const MAX_NOTE_LENGTH = 5000;
const MAX_WORK_NOTE_LENGTH = 200;

export const PlanningDashboardService = {
  async getSkuNotes(): Promise<Record<string, string>> {
    const rows = await PlanningDashboardRepository.listSkuNotes();
    return Object.fromEntries(rows.map((row) => [row.masterSku, row.note]));
  },

  async setSkuNote(rawSku: unknown, rawNote: unknown, updatedBy: string | null) {
    const sku = typeof rawSku === "string" ? rawSku.trim() : "";
    const note = typeof rawNote === "string" ? rawNote.trim() : "";

    if (!sku) throw new ValidationError("Invalid sku");
    if (note.length > MAX_NOTE_LENGTH) throw new ValidationError("Note is too long");

    if (!note) {
      await PlanningDashboardRepository.deleteSkuNote(sku);
      return { sku, note: "" };
    }

    await PlanningDashboardRepository.upsertSkuNote(sku, note, updatedBy);
    return { sku, note };
  },

  async getSkuWorkNotes(slot: WorkNoteSlot = 1): Promise<Record<string, string>> {
    const rows = await PlanningDashboardRepository.listSkuWorkNotes(slot);
    return Object.fromEntries(rows.map((row) => [row.masterSku, row.note]));
  },

  async setSkuWorkNote(rawSku: unknown, rawNote: unknown, updatedBy: string | null, slot: WorkNoteSlot = 1) {
    const sku = typeof rawSku === "string" ? rawSku.trim() : "";
    const note = typeof rawNote === "string" ? rawNote.trim().replace(/\s*[\r\n]+\s*/g, " ") : "";

    if (!sku) throw new ValidationError("Invalid sku");
    if (note.length > MAX_WORK_NOTE_LENGTH) throw new ValidationError("Work note is too long");

    if (!note) {
      await PlanningDashboardRepository.deleteSkuWorkNote(sku, slot);
      return { sku, note: "" };
    }

    await PlanningDashboardRepository.upsertSkuWorkNote(sku, note, updatedBy, slot);
    return { sku, note };
  },

  async updateProductCbm(sku: string, rawCbm: unknown, ip: string | null) {
    const cbm = parseFloat(String(rawCbm ?? ""));
    if (!sku || isNaN(cbm) || cbm < 0) {
      throw new ValidationError("Invalid sku or cbm_per_unit");
    }

    const { previousCbm, containerItems } = await withTransaction(async (client) => {
      const previousCbm = await PlanningDashboardRepository.getProductCbmForUpdate(sku, client);
      await PlanningDashboardRepository.updateProductCbm(sku, cbm, client);
      const containerItems = await PlanningDashboardRepository.cascadeContainerItemsCbm(sku, cbm, client);
      return { previousCbm, containerItems };
    });

    await invalidatePlanningDashboardCache();

    if (previousCbm !== cbm) {
      const session = await auth();
      await logAudit({
        entityType: "sku",
        entityId: sku,
        entityLabel: sku,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "update",
        before: { cbmPerUnit: previousCbm },
        after: { cbmPerUnit: cbm },
        note: "Planning dashboard CBM inline edit",
        ip,
      });
    }

    return { cbmPerUnit: cbm, containerItems };
  },

  async updateTotalAvgCurrentOverride(sku: string, rawValue: unknown, ip: string | null) {
    const parsedValue = rawValue === null || rawValue === ""
      ? null
      : Number(rawValue);
    if (!sku || (parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0))) {
      throw new ValidationError("Invalid sku or total_avg_curr_override");
    }
    const value = parsedValue === null ? null : Math.round(parsedValue * 10_000) / 10_000;

    const previousValue = await withTransaction(async (client) => {
      const previous = await PlanningDashboardRepository.getTotalAvgCurrentOverrideForUpdate(sku, client);
      await PlanningDashboardRepository.updateTotalAvgCurrentOverride(sku, value, client);
      return previous;
    });

    await invalidatePlanningDashboardCache();

    if (previousValue !== value) {
      const session = await auth();
      await logAudit({
        entityType: "sku",
        entityId: sku,
        entityLabel: sku,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "update",
        before: { totalAvgCurrentOverride: previousValue },
        after: { totalAvgCurrentOverride: value },
        note: "Planning dashboard T. Avg current manual override",
        ip,
      });
    }

    return { totalAvgCurrentOverride: value };
  },

  async getOosLostDemandWeights(): Promise<Record<CategoryKey, Record<string, number>>> {
    const rows = await PlanningDashboardRepository.getOosLostDemandChannelTotals();
    const byCategory = new Map(rows.map((row) => [row.category_code, row]));

    return Object.fromEntries(
      OOS_LOST_DEMAND_CATEGORIES.map(({ key }) => {
        const row = byCategory.get(key);
        const shopify90d = Math.max(Number(row?.shopify_90d ?? 0), 1);
        const marketplaceWeights = Object.fromEntries(
          OOS_LOST_DEMAND_MARKETPLACES.map(({ key: marketplace }) => {
            const raw = row?.[`${marketplace}_90d` as "amazon_90d" | "ebay_90d" | "walmart_90d"] ?? "0";
            return [marketplace, Number(raw) / shopify90d];
          }),
        );
        return [key, marketplaceWeights];
      }),
    ) as Record<CategoryKey, Record<string, number>>;
  },
};
