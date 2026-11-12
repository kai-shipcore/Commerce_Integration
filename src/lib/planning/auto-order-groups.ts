/**
 * Which rows the Demand Planning automatic order calculations fill, and which
 * target-days group each row's settings come from.
 */

import type { DemandRow } from "@/types/demand-planning";

// Target-day tiers are configured separately per product group: Seat Cover
// Original vs Custom (by sales_status), Car Cover fabric 03 (PVC) vs 15
// (Pongee), and the two floor mat statuses that are ordered automatically
// (1+2 Set and 3rd Row). Everything else (other fabrics, SWC, accessories)
// shares the "other" tiers.
export const TARGET_TIER_GROUPS = ["sc_original", "sc_custom", "cc_03", "cc_15", "fm_set", "fm_third", "other"] as const;
export type TargetTierGroup = (typeof TARGET_TIER_GROUPS)[number];

/**
 * Automatic order calculations (all three auto-fill buttons) only give a
 * quantity to SKUs whose Sales Status is Original or Custom, or — for floor
 * mats — 1+2 Set or 3rd Row. Part, SWC, Hold, Discontinued, TBD and blank are
 * left for manual entry, and so are the other floor mat statuses: 1+2+3 Set,
 * and the 1st / 2nd Row components, which are ordered to complete sets rather
 * than to a target inventory life.
 *
 * A 1+2 Set master's order needs no adjustment for the sets its loose
 * components make: those are already in its Total Stock (Loose Sets On Hand)
 * and in each container's Avail Qty (Loose Sets Ordered), which is what the
 * calculations read.
 */
export function isAutoOrderSalesStatus(row: Pick<DemandRow, "sales_status">): boolean {
  return (
    row.sales_status === "Original" ||
    row.sales_status === "Custom" ||
    row.sales_status === "1+2 Set" ||
    row.sales_status === "3rd Row"
  );
}

export function targetTierGroupForRow(row: Pick<DemandRow, "sku" | "category_code" | "sales_status">): TargetTierGroup {
  // By status, not category: only floor mat SKUs can carry these statuses.
  if (row.sales_status === "1+2 Set") return "fm_set";
  if (row.sales_status === "3rd Row") return "fm_third";
  const category = (row.category_code ?? "").toUpperCase();
  if (category === "SC") return row.sales_status === "Custom" ? "sc_custom" : "sc_original";
  if (category === "CC") {
    // CC-<vehicle>-<fabric>-... ; legacy SKUs without a vehicle segment are CC-<fabric>-...
    const parts = String(row.sku ?? "").trim().toUpperCase().split("-");
    const fabric = /^\d+$/.test(parts[1] ?? "") ? parts[1] : parts[2];
    const fabricNumber = /^\d+$/.test(fabric ?? "") ? Number.parseInt(fabric, 10) : null;
    if (fabricNumber === 3) return "cc_03";
    if (fabricNumber === 15) return "cc_15";
  }
  return "other";
}
