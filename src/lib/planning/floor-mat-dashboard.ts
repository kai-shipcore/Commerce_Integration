/**
 * Floor mat set pairing as the Demand Planning dashboard sees it: turns
 * dashboard rows into the input of computeFloorMatPairing, and holds the
 * current result where the grid's column definitions can read it.
 *
 * Used on both sides:
 *  - the server pairs current stock only (no containers), to fold Loose Sets
 *    On Hand into a master's Total Stock before S.O.D. is worked out;
 *  - the grid pairs again with the container quantities on screen, edits
 *    included, for everything that depends on incoming units.
 * Both run the same function on the same rows, so the on-hand figure agrees.
 */

import { computeFloorMatPairing, floorMatMasterLabel, type FloorMatPairingResult, type MasterPairing } from "@/lib/planning/floor-mat-pairing";
import type { DemandRow } from "@/types/demand-planning";

export interface FloorMatView {
  result: FloorMatPairingResult;
  /** Container name → pairing stage (1 = first container after Base). */
  stageByContainer: Map<string, number>;
  /** Total Stock by SKU, for the 3rd Row Stock column. */
  totalStockBySku: Map<string, number>;
}

/**
 * Pairs the floor mat masters among `rows`.
 *
 * `containerNames` are the incoming containers in ETA order (without the Base
 * column) and `qtyFor` reads a row's quantity in one of them. Returns null
 * when there is nothing to pair: no master has set links, or the view is
 * historical (As of), where per-warehouse stock is unknown and pairing by
 * location is therefore not possible.
 */
export function buildFloorMatView(
  rows: readonly DemandRow[],
  containerNames: readonly string[],
  qtyFor: (row: DemandRow, containerName: string) => number,
): FloorMatView | null {
  const masters = rows.filter((row) => !row.pinned && row.fm_set?.frontSku);
  if (masters.length === 0) return null;

  const rowBySku = new Map<string, DemandRow>();
  for (const row of rows) if (!row.pinned) rowBySku.set(row.sku, row);

  const componentSkus = new Set<string>();
  for (const master of masters) {
    componentSkus.add(master.fm_set!.frontSku!);
    if (master.fm_set!.rearSku) componentSkus.add(master.fm_set!.rearSku);
  }

  const components = new Map<string, { primary: number; dtrans: number; east: number; backorder: number }>();
  for (const sku of componentSkus) {
    const row = rowBySku.get(sku);
    if (!row) continue; // not on the dashboard (inactive, or not in SKU Master): no stock to pair
    if (row.fullerton_available_stock == null || row.dream_trans_available_stock == null || row.ttm_available_stock == null) {
      return null; // historical view
    }
    components.set(sku, {
      // The sheet's three locations. Canary and Linkone belong to none of them.
      primary: row.fullerton_available_stock,
      dtrans: row.dream_trans_available_stock,
      east: row.ttm_available_stock + (row.ttm_jeff_available_stock ?? 0),
      // `back` is stored negated.
      backorder: Math.max(0, -(row.back ?? 0)),
    });
  }

  const result = computeFloorMatPairing({
    masters: masters.map((row) => ({
      masterSku: row.sku,
      frontSku: row.fm_set!.frontSku,
      rearSku: row.fm_set!.rearSku,
      ads: row.total_avg_curr ?? 0,
    })),
    components,
    containers: containerNames.map((name) => {
      const orders = new Map<string, number>();
      for (const sku of componentSkus) {
        const row = rowBySku.get(sku);
        const qty = row ? qtyFor(row, name) : 0;
        if (qty > 0) orders.set(sku, qty);
      }
      return { id: name, orders };
    }),
  });

  return {
    result,
    stageByContainer: new Map(containerNames.map((name, index) => [name, index + 1])),
    totalStockBySku: new Map([...rowBySku.values()].map((row) => [row.sku, row.total_stock ?? 0])),
  };
}

// ── What the grid's column definitions read ──────────────────────────────────
//
// The column `val` functions take a row and nothing else, so the current view
// lives here, set by the grid during render — the same arrangement as
// getPlanningAnchor() in the dashboard's columns.ts.
let currentView: FloorMatView | null = null;

export function setFloorMatView(view: FloorMatView | null): void {
  currentView = view;
}

export function getFloorMatView(): FloorMatView | null {
  return currentView;
}

export function floorMatMaster(sku: string): MasterPairing | undefined {
  return currentView?.result.masters.get(sku);
}

/** Pairing stage for a container column; 0 for the Base column. */
function stageOf(containerName: string, isBaseline: boolean): number | undefined {
  return isBaseline ? 0 : currentView?.stageByContainer.get(containerName);
}

/** Loose Sets Ordered: sets this master gains from the units arriving in the container. */
export function looseSetsOrdered(sku: string, containerName: string): number {
  const stage = currentView?.stageByContainer.get(containerName);
  return stage === undefined ? 0 : floorMatMaster(sku)?.added[stage] ?? 0;
}

/**
 * True when at least one set this master gains in the container is split
 * between warehouses and needs consolidating. Splits from earlier containers,
 * or already present in current stock, do not count.
 */
export function looseSetsOrderedIsSplit(sku: string, containerName: string): boolean {
  const stage = currentView?.stageByContainer.get(containerName);
  if (stage === undefined) return false;
  const master = floorMatMaster(sku);
  return Boolean(master && master.added[stage] > 0 && master.splitAdded[stage] > 0);
}

/** Pairs after the container (cumulative); under Base, the current pairs. */
export function pairsAfter(sku: string, containerName: string, isBaseline: boolean): number | null {
  const master = floorMatMaster(sku);
  const stage = stageOf(containerName, isBaseline);
  return master?.pairable && stage !== undefined ? master.pairs[stage] ?? null : null;
}

/** Usable 1st / 2nd Row units arriving in the container, after the component's backorder. */
export function usableArrival(sku: string, containerName: string, piece: "front" | "rear"): number | null {
  const master = floorMatMaster(sku);
  const stage = currentView?.stageByContainer.get(containerName);
  if (!master || stage === undefined) return null;
  return (piece === "front" ? master.frontArrivals : master.rearArrivals)[stage - 1] ?? null;
}

/**
 * For a component row with an order in the container: the masters its units
 * pair into, e.g. ["FM15116 × 15", "FM15164 × 1"]. Empty otherwise.
 */
export function componentPairingLines(sku: string, containerName: string): string[] {
  const stage = currentView?.stageByContainer.get(containerName);
  const component = currentView?.result.components.get(sku);
  if (!component || stage === undefined || component.arrivals[stage - 1] == null) return [];
  return component.pairings[stage - 1].map((pairing) => `${floorMatMasterLabel(pairing.masterSku)} × ${pairing.qty}`);
}

export function floorMatTotalStock(sku: string): number | null {
  return currentView?.totalStockBySku.get(sku) ?? null;
}
