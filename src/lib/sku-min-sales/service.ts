/**
 * Business logic for the SKU Min Sales page. Two kinds of rule, both applied
 * at read time by DemandPlanningService; this service only manages them,
 * invalidates the dashboard cache, and audit-logs.
 *  - Per-SKU registration: a fixed floor on the Demand Planning "T.Avg 현재"
 *    (`applyMinTotalAvgCurr`), a reference SKU and percent the SKU's sales are
 *    planned on (`withReferenceSales`), or both.
 *  - Colour rule: the same reference for every SKU of one colour, which is how
 *    a new colour is usually planned. A per-SKU reference wins over it.
 */

import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  COLOR_RULE_CATEGORIES,
  colorRuleReference,
  type ColorReferenceRule,
  type ColorRuleCategory,
} from "@/lib/planning/reference-sales";
import {
  SkuMinSalesRepository,
  withTransaction,
  type ColorRuleRow,
  type ColorRuleWrite,
  type SkuMinSalesRow,
  type SkuMinSalesWrite,
} from "@/lib/sku-min-sales/repository";

export type Who = { userId: string | null; userName: string | null; userEmail: string | null };

export interface SkuMinSalesInput {
  masterSku: string;
  minTotalAvgCurr?: number | null;
  referenceSku?: string | null;
  referencePct?: number | null;
  note?: string | null;
}

export interface ColorRuleInput {
  categoryCode: string;
  material?: string | null;
  color: string;
  referenceColor: string;
  referencePct: number;
  note?: string | null;
}

/** How many active SKUs a colour rule reaches. */
export interface ColorRuleCoverage {
  /** Active SKUs in the rule's colour. */
  matched: number;
  /** Of those, the ones whose reference SKU is also active, so the rule has something to read. */
  paired: number;
  /** The rest: no active SKU in the reference colour. They keep their own sales. */
  unpaired: string[];
}

export const MAX_REFERENCE_PCT = 1000;
const SEGMENT_PATTERN = /^[A-Z0-9]+$/;

function validPct(value: unknown): number | null {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0 || pct > MAX_REFERENCE_PCT) return null;
  return Math.round(pct * 100) / 100;
}

function normalize(input: SkuMinSalesInput): SkuMinSalesWrite {
  const masterSku = input.masterSku.trim().toUpperCase();
  const label = masterSku || "(blank SKU)";
  if (!masterSku) throw new ValidationError(`Invalid minimum for ${label}`);

  let minTotalAvgCurr: number | null = null;
  if (input.minTotalAvgCurr !== null && input.minTotalAvgCurr !== undefined) {
    const value = Number(input.minTotalAvgCurr);
    if (!Number.isFinite(value) || value < 0) throw new ValidationError(`Invalid minimum for ${label}`);
    minTotalAvgCurr = Math.round(value * 10_000) / 10_000;
  }

  const referenceSku = input.referenceSku?.trim().toUpperCase() || null;
  let referencePct: number | null = null;
  if (referenceSku) {
    if (referenceSku === masterSku) throw new ValidationError(`${label} cannot reference itself`);
    referencePct = validPct(input.referencePct);
    if (referencePct === null) {
      throw new ValidationError(`Reference % for ${label} must be above 0 and at most ${MAX_REFERENCE_PCT}`);
    }
  } else if (input.referencePct !== null && input.referencePct !== undefined) {
    throw new ValidationError(`Reference % for ${label} needs a reference SKU`);
  }

  if (minTotalAvgCurr === null && referenceSku === null) {
    throw new ValidationError(`${label} needs a minimum, a reference SKU, or both`);
  }
  return { masterSku, minTotalAvgCurr, referenceSku, referencePct, note: input.note?.trim() || null };
}

function normalizeColorRule(input: ColorRuleInput): ColorRuleWrite {
  const categoryCode = input.categoryCode.trim().toUpperCase() as ColorRuleCategory;
  if (!COLOR_RULE_CATEGORIES.includes(categoryCode)) {
    throw new ValidationError(`Colour rules support ${COLOR_RULE_CATEGORIES.join(" and ")} only`);
  }
  const material = input.material?.trim().toUpperCase() || null;
  const color = input.color.trim().toUpperCase();
  const referenceColor = input.referenceColor.trim().toUpperCase();
  for (const [name, value] of [["Fabric / material", material], ["Colour", color], ["Reference colour", referenceColor]] as const) {
    if (value !== null && !SEGMENT_PATTERN.test(value)) {
      throw new ValidationError(`${name} must be a SKU segment code such as 03 or BK`);
    }
  }
  if (color === referenceColor) throw new ValidationError("A colour cannot reference itself");
  const referencePct = validPct(input.referencePct);
  if (referencePct === null) {
    throw new ValidationError(`Reference % must be above 0 and at most ${MAX_REFERENCE_PCT}`);
  }
  return { categoryCode, material, color, referenceColor, referencePct, note: input.note?.trim() || null };
}

function coverageOf(rule: ColorRuleWrite, activeSkus: readonly string[], activeSet: ReadonlySet<string>): ColorRuleCoverage {
  const asRule: ColorReferenceRule[] = [{
    categoryCode: rule.categoryCode, material: rule.material, color: rule.color,
    referenceColor: rule.referenceColor, pct: rule.referencePct,
  }];
  const coverage: ColorRuleCoverage = { matched: 0, paired: 0, unpaired: [] };
  for (const sku of activeSkus) {
    const reference = colorRuleReference(sku, asRule);
    if (!reference) continue;
    coverage.matched += 1;
    if (activeSet.has(reference.referenceSku)) coverage.paired += 1;
    else coverage.unpaired.push(sku);
  }
  return coverage;
}

function colorRuleLabel(rule: Pick<ColorRuleWrite, "categoryCode" | "material" | "color" | "referenceColor">): string {
  return `${rule.categoryCode}${rule.material ? ` ${rule.material}` : ""} ${rule.color} → ${rule.referenceColor}`;
}

function actorLabel(who: Who): string | null {
  return who.userName ?? who.userEmail ?? who.userId;
}

type RuleSnapshot = { minTotalAvgCurr: number | null; referenceSku: string | null; referencePct: number | null };

function snapshot(row: RuleSnapshot): RuleSnapshot {
  return { minTotalAvgCurr: row.minTotalAvgCurr, referenceSku: row.referenceSku, referencePct: row.referencePct };
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
      const wanted = [...new Set(rows.flatMap((row) => (row.referenceSku ? [row.masterSku, row.referenceSku] : [row.masterSku])))];
      const existing = await SkuMinSalesRepository.findExistingProductSkus(wanted, client);
      const missing = wanted.filter((sku) => !existing.has(sku));
      if (missing.length > 0) {
        throw new ValidationError(`SKU does not exist in SKU Master: ${missing.join(", ")}`);
      }

      const changes: Array<{ masterSku: string; before: RuleSnapshot | null; after: RuleSnapshot }> = [];
      let inserted = 0;
      let updated = 0;
      for (const row of rows) {
        const before = await SkuMinSalesRepository.getForUpdate(row.masterSku, client);
        const created = await SkuMinSalesRepository.upsert(row, actorLabel(who), client);
        if (created) inserted += 1;
        else updated += 1;
        if (
          before?.minTotalAvgCurr !== row.minTotalAvgCurr || before?.referenceSku !== row.referenceSku ||
          before?.referencePct !== row.referencePct || before?.note !== row.note
        ) {
          changes.push({ masterSku: row.masterSku, before: before ? snapshot(before) : null, after: snapshot(row) });
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
        before: change.before,
        after: change.after,
        note: "SKU minimum sales",
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
        note: "SKU minimum sales",
        ip,
      });
    }

    return { skus: deleted };
  },

  /** Every colour rule with how many active SKUs it reaches. */
  async listColorRules(): Promise<Array<ColorRuleRow & { coverage: ColorRuleCoverage }>> {
    const [rules, activeSkus] = await Promise.all([
      SkuMinSalesRepository.listColorRules(),
      SkuMinSalesRepository.listActiveColorRuleSkus(),
    ]);
    const activeSet = new Set(activeSkus);
    return rules.map((rule) => ({ ...rule, coverage: coverageOf(rule, activeSkus, activeSet) }));
  },

  /** What a colour rule would reach, before it is saved. */
  async previewColorRule(input: ColorRuleInput): Promise<ColorRuleCoverage> {
    const rule = normalizeColorRule(input);
    const activeSkus = await SkuMinSalesRepository.listActiveColorRuleSkus();
    return coverageOf(rule, activeSkus, new Set(activeSkus));
  },

  /** Adds a colour rule, or overwrites the one for the same category / material / colour. */
  async saveColorRule(input: ColorRuleInput, who: Who, ip: string | null) {
    const rule = normalizeColorRule(input);

    const { before, saved } = await withTransaction(async (client) => {
      const existing = await SkuMinSalesRepository.getColorRuleForUpdate(rule, client);
      return { before: existing, saved: await SkuMinSalesRepository.upsertColorRule(rule, actorLabel(who), client) };
    });

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "sku_min_sales",
      entityId: `color-rule:${saved.id}`,
      entityLabel: colorRuleLabel(saved),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: before ? "update" : "create",
      before: before ? { referenceColor: before.referenceColor, referencePct: before.referencePct } : null,
      after: { referenceColor: saved.referenceColor, referencePct: saved.referencePct },
      note: "Sales reference colour rule",
      ip,
    });

    return { rule: saved, created: !before };
  },

  async removeColorRule(id: number, who: Who, ip: string | null) {
    const deleted = await SkuMinSalesRepository.deleteColorRule(id);
    if (!deleted) throw new NotFoundError("Colour rule not found.");

    await invalidatePlanningDashboardCache();

    void logAudit({
      entityType: "sku_min_sales",
      entityId: `color-rule:${deleted.id}`,
      entityLabel: colorRuleLabel(deleted),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      before: { referenceColor: deleted.referenceColor, referencePct: deleted.referencePct },
      note: "Sales reference colour rule",
      ip,
    });

    return { id: deleted.id };
  },
};
