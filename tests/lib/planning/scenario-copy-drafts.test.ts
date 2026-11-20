/**
 * Copy Live now carries draft containers' quantities into the tab. These are
 * the two things that went wrong the last time a tab held draft quantities, and
 * must not come back with them:
 *
 *  - Inv. Life has to move when a copied quantity is set to 0.
 *  - The automatic calculator has to see a draft container's quantity: it reads
 *    `row.containers[name].inbound_qty` (and the on-screen override) to decide
 *    which SKUs are already ordered and how much of the container is used.
 *
 * Both read what `projectRowsForScenario` hands the grid, so that is what is
 * checked here, together with the container chain the grid's own copy mirrors.
 */

import { describe, expect, it } from "vitest";
import { projectRowsForScenario } from "@/features/planning/scenario-projection";
import { computeContainerChain } from "@/lib/planning/chain-calc";
import { DEFAULT_SEASONAL_FACTORS } from "@/lib/planning/seasonal-factors";
import type { ContainerMeta, DemandPlanningData, DemandRow } from "@/types/demand-planning";
import type { ScenarioOverlay } from "@/features/planning/scenarios";

const TODAY = "2026-08-17";

const CONTAINERS: ContainerMeta[] = [
  { col: 0, name: "Base", eta: TODAY, cbm_cap: 0, status: "baseline" },
  { col: 1, container_id: 1, name: "112-CA", eta: "2026-08-27", cbm_cap: 80, status: "shipped" },
  { col: 2, container_id: 2, name: "113-CA", eta: "2026-09-10", cbm_cap: 80, status: "draft" },
];

const SKU = "CA-SC-10-F-10-BK-1TO";

/** Live as the dashboard loads it: the draft container's cell is there too. */
function liveRow(): DemandRow {
  return {
    sku: SKU,
    cbm_per_unit: 0.05,
    total_stock: 10,
    back: 0,
    total_avg_curr: 2,
    total_30d: 60,
    sod: "2026-08-22",
    containers: {
      "112-CA": { inbound_qty: 40, cbm_unit: 0.05 },
      "113-CA": { inbound_qty: 60, cbm_unit: 0.05 },
    },
  } as unknown as DemandRow;
}

const LIVE: DemandPlanningData = { containers: CONTAINERS, rows: [liveRow()], last_sync: null };

/** What Copy Live stores for this plan: one row per cell, the draft included. */
function copiedOverlay(draftQty: number): ScenarioOverlay {
  return {
    items: [
      { container_id: "1", master_sku: SKU, qty: 40 },
      { container_id: "2", master_sku: SKU, qty: draftQty },
    ],
    containers: [
      { container_id: "1", eta_date: "2026-08-27" },
      { container_id: "2", eta_date: "2026-09-10" },
    ],
  };
}

function chainFor(row: DemandRow, overrides = new Map<string, { inbound_qty: number | null }>()) {
  return computeContainerChain(row, CONTAINERS, overrides, TODAY, DEFAULT_SEASONAL_FACTORS);
}

describe("a tab copied from Live with draft containers", () => {
  it("shows the draft container's quantity, where the calculator reads it", () => {
    const [row] = projectRowsForScenario(LIVE, copiedOverlay(60)).rows;

    expect(row.containers["113-CA"].inbound_qty).toBe(60);
    // CBM already used in the container is this quantity times its unit CBM.
    expect(row.containers["113-CA"].cbm).toBeCloseTo(3);
  });

  it("counts the draft quantity in the chain", () => {
    const [row] = projectRowsForScenario(LIVE, copiedOverlay(60)).rows;
    const withDraft = chainFor(row).get("113-CA");
    const [emptyRow] = projectRowsForScenario(LIVE, copiedOverlay(0)).rows;
    const withoutDraft = chainFor(emptyRow).get("113-CA");

    expect(withDraft?.avail_qty).toBe((withoutDraft?.avail_qty ?? 0) + 60);
    expect(withDraft?.inv_life).not.toBe(withoutDraft?.inv_life);
  });

  it("moves Inv. Life when the copied quantity is set to 0 on screen", () => {
    const [row] = projectRowsForScenario(LIVE, copiedOverlay(60)).rows;
    const before = chainFor(row).get("113-CA");
    // The grid stores a cleared cell as an override with a null quantity.
    const after = chainFor(row, new Map([[`${SKU}::113-CA`, { inbound_qty: null }]])).get("113-CA");

    expect(before?.inv_life).toBeGreaterThan(0);
    expect(after?.avail_qty).toBe((before?.avail_qty ?? 0) - 60);
    expect(after?.inv_life).not.toBe(before?.inv_life);
  });

  it("keeps the 0 after a reload instead of taking Live's quantity back", () => {
    // Saved as qty 0 in the overlay; Live still holds 60 in that cell.
    const [row] = projectRowsForScenario(LIVE, copiedOverlay(0)).rows;

    expect(row.containers["113-CA"]).toBeUndefined();
    expect(chainFor(row).get("113-CA")?.avail_qty)
      .toBe(chainFor(row, new Map([[`${SKU}::113-CA`, { inbound_qty: null }]])).get("113-CA")?.avail_qty);
  });

  it("does not follow a quantity Live changes after the copy", () => {
    const liveLater: DemandPlanningData = {
      ...LIVE,
      rows: [{
        ...liveRow(),
        containers: { ...liveRow().containers, "113-CA": { inbound_qty: 999, cbm_unit: 0.05 } },
      } as unknown as DemandRow],
    };
    const [row] = projectRowsForScenario(liveLater, copiedOverlay(60)).rows;

    expect(row.containers["113-CA"].inbound_qty).toBe(60);
  });
});
