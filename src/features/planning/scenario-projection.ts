/**
 * Projects the dashboard's Live data onto a scenario tab.
 *
 * A scenario used to be a *sparse* overlay: `fc_planning_scenario_items` held a
 * row only for cells the tab had an opinion about, and everything else read
 * through to the Live quantity. That made a tab follow Live for every
 * (container, SKU) pair it happened to have no row for — so a Container
 * Planning Excel import that put a new SKU into a container showed up on every
 * tab at once, while a cell the tab already had a row for stayed put. The same
 * upload leaking into some cells and not others is what that looked like from
 * the outside.
 *
 * The overlay is now the whole truth for its tab. This function rebuilds each
 * row's `containers` map from the overlay alone, so the roughly twenty places
 * in the grid that read `row.containers?.[name]` as their fallback get the
 * scenario's numbers instead of Live's without each needing to know about tabs.
 *
 * What still comes from Live is the per-cell metadata that is not a quantity:
 * `cbm_unit` (so an edited qty recomputes its CBM) and
 * `allocated_remaining_qty` (an available-stock fact about the real container).
 * `item_id` is deliberately dropped — a scenario cell points at no real
 * `fc_container_items` row, and a write must not find one there.
 */

import type {
  ContainerRowData,
  DemandPlanningData,
  DemandRow,
} from "@/types/demand-planning";
import type { ScenarioOverlay } from "@/features/planning/scenarios";

/** A scenario cell with no Live counterpart: the SKU is not in that container
 *  on the real plan. Matches the placeholder the grid builds for an empty
 *  editable cell, so the two agree on what "nothing there yet" looks like. */
function emptyCell(eta: string | null): ContainerRowData {
  return {
    item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
    allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta,
    inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
  };
}

function projectRow(
  row: DemandRow,
  qtyByContainerName: Map<string, number> | undefined,
  etaByContainerName: Map<string, string | null>,
): DemandRow {
  if (!qtyByContainerName || qtyByContainerName.size === 0) {
    return { ...row, containers: {} };
  }

  const containers: Record<string, ContainerRowData> = {};
  for (const [containerName, qty] of qtyByContainerName) {
    // A stored 0 is an explicit "this tab ships none of this SKU here", which
    // reads as an empty cell — the same as the Live tab shows for no row.
    if (qty <= 0) continue;

    const live = row.containers?.[containerName];
    const base = live ?? emptyCell(etaByContainerName.get(containerName) ?? null);
    const cbmUnit = base.cbm_unit ?? row.cbm_per_unit ?? null;

    containers[containerName] = {
      ...base,
      item_id: null,
      cbm_unit: cbmUnit,
      inbound_qty: qty,
      avail_qty: qty,
      cbm: cbmUnit === null ? null : qty * cbmUnit,
    };
  }
  return { ...row, containers };
}

/**
 * Returns `data` as the given scenario tab sees it. Call this only for a
 * scenario tab — the Live tab is the real plan and passes through untouched.
 *
 * A null `overlay` means the tab's overlay has not arrived yet. Every cell
 * comes back empty rather than showing Live's numbers under the new tab's name,
 * which is the same reason the grid waits for the overlay before seeding.
 */
export function projectRowsForScenario(
  data: DemandPlanningData,
  overlay: ScenarioOverlay | null,
): DemandPlanningData {
  const nameByContainerId = new Map<string, string>();
  const etaByContainerName = new Map<string, string | null>();
  for (const container of data.containers) {
    if (container.container_id === undefined) continue;
    nameByContainerId.set(String(container.container_id), container.name);
    etaByContainerName.set(container.name, container.eta ?? null);
  }

  const bySku = new Map<string, Map<string, number>>();
  for (const item of overlay?.items ?? []) {
    // A container that has left the inbound set keeps its overlay rows but is
    // no longer a column, so it has no name to project onto.
    const containerName = nameByContainerId.get(String(item.container_id));
    if (containerName === undefined) continue;

    let qtyByContainerName = bySku.get(item.master_sku);
    if (!qtyByContainerName) {
      qtyByContainerName = new Map();
      bySku.set(item.master_sku, qtyByContainerName);
    }
    qtyByContainerName.set(containerName, item.qty);
  }

  return {
    ...data,
    rows: data.rows.map((row) => projectRow(row, bySku.get(row.sku), etaByContainerName)),
    pinned_rows: data.pinned_rows?.map((row) => projectRow(row, bySku.get(row.sku), etaByContainerName)),
  };
}
