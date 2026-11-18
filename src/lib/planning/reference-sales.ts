/**
 * Code Guide:
 * Reference sales: a SKU planned on a share of another SKU's sales.
 *
 * A new colour has no sales history of its own, so it is planned off the
 * colour it sits next to. Each of its sales figures is the higher of its own
 * figure and a percentage of the same figure on the reference SKU. The
 * reference SKU's figures are not reduced. Once the SKU outsells that share on
 * its own, its own figure is what shows, so a rule never has to be removed.
 * (Planning team, 2026-11-18. Car Cover Fabric 03 BK on 30% of GR; Seat Cover
 * IB on 30% of BE: BE at 49 / 36 / 15 / 8 / 3 gives IB 15 / 11 / 5 / 2 / 1.)
 *
 * Two places name a reference, both managed on the Min Sales page:
 *  - a colour rule (shipcore.fc_sales_reference_color_rules): every SKU of a
 *    category in one colour references the same SKU in another colour;
 *  - a per-SKU registration (fc_sku_min_sales.reference_sku / reference_pct),
 *    which wins over a colour rule.
 *
 * Applied where the Demand Planning dashboard resolves a row's sales, so the
 * sales columns and every average derived from them follow. The Velocity page
 * and the stored fc_stats columns keep the SKU's own sales.
 *
 * Pure and client-safe.
 */

import { carCoverSegments } from "@/lib/planning/sku-format";

/** Categories whose master SKU carries a colour segment. */
export const COLOR_RULE_CATEGORIES = ["CC", "SC"] as const;
export type ColorRuleCategory = (typeof COLOR_RULE_CATEGORIES)[number];

export interface ColorReferenceRule {
  categoryCode: ColorRuleCategory;
  /** Fabric (Car Cover) or material (Seat Cover) the rule is limited to; null for every one. */
  material: string | null;
  /** The colour that takes the reference. */
  color: string;
  /** The colour it references. */
  referenceColor: string;
  /** Percent of the reference SKU's sales (30 = 30%). */
  pct: number;
}

export interface SalesReference {
  referenceSku: string;
  pct: number;
}

// CC-<line>-<fabric>-<size>-<color>-<colorType>      car cover, current format
// CA-CC-<fabric>-<line>-<size>-<color>-<colorType>   car cover, unified format
// CA-SC-<material>-<position>-<size>[-<position>-<size>]-<color>-<colorType>
// All carry the colour second to last. Where the fabric sits depends on the
// car cover format, so it comes from carCoverSegments (see sku-format.ts).
const SEAT_COVER_MATERIAL_INDEX = 2;
const SEAT_COVER_MIN_SEGMENTS = 7;
const SEAT_COVER_MAX_SEGMENTS = 9;

/** The colour-rule fields of a master SKU, or null when it has no colour segment to match on. */
export function colorRuleParts(masterSku: string): { categoryCode: ColorRuleCategory; material: string; color: string; parts: string[] } | null {
  const carCover = carCoverSegments(masterSku);
  if (carCover) {
    // A full car cover SKU only: one with a line, and nothing after the style.
    if (carCover.line === null || carCover.parts.length !== carCover.style + 1) return null;
    return {
      categoryCode: "CC",
      material: carCover.parts[carCover.fabric],
      color: carCover.parts[carCover.color],
      parts: carCover.parts,
    };
  }
  const parts = masterSku.trim().toUpperCase().split("-");
  if (parts[0] !== "CA" || parts[1] !== "SC") return null;
  if (parts.length < SEAT_COVER_MIN_SEGMENTS || parts.length > SEAT_COVER_MAX_SEGMENTS) return null;
  return { categoryCode: "SC", material: parts[SEAT_COVER_MATERIAL_INDEX], color: parts[parts.length - 2], parts };
}

/**
 * The SKU a colour rule points this SKU at, or null when no rule matches. Only
 * the exact colour matches: a rule for BK leaves BKGR and BKRD alone. A rule
 * limited to one fabric / material wins over one for every fabric.
 */
export function colorRuleReference(masterSku: string, rules: readonly ColorReferenceRule[]): SalesReference | null {
  const sku = colorRuleParts(masterSku);
  if (!sku) return null;
  let match: ColorReferenceRule | null = null;
  for (const rule of rules) {
    if (rule.categoryCode !== sku.categoryCode || rule.color !== sku.color) continue;
    if (rule.material !== null && rule.material !== sku.material) continue;
    if (!match || (match.material === null && rule.material !== null)) match = rule;
  }
  if (!match) return null;
  const parts = [...sku.parts];
  parts[parts.length - 2] = match.referenceColor;
  return { referenceSku: parts.join("-"), pct: match.pct };
}

/**
 * The higher of the SKU's own figure and the share of the reference SKU's,
 * key by key. Unit counts are rounded to a whole unit, as on the planning
 * sheet; the keys in `averageKeys` are daily averages and stay unrounded.
 */
export function withReferenceSales<K extends string>(
  own: Record<K, number>,
  reference: Record<K, number>,
  averageKeys: ReadonlySet<string>,
  pct: number,
): Record<K, number> {
  const result = { ...own };
  for (const key of Object.keys(own) as K[]) {
    const scaled = ((reference[key] ?? 0) * pct) / 100;
    result[key] = Math.max(own[key], averageKeys.has(key) ? scaled : Math.round(scaled));
  }
  return result;
}
