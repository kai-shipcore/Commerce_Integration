import { describe, it, expect } from "vitest";
import { projectRowsForScenario } from "@/features/planning/scenario-projection";
import type {
  ContainerMeta,
  ContainerRowData,
  DemandPlanningData,
  DemandRow,
} from "@/types/demand-planning";
import type { ScenarioOverlay } from "@/features/planning/scenarios";

function container(id: number, name: string): ContainerMeta {
  return { col: id, container_id: id, name, eta: "2026-10-01", cbm_cap: 68 };
}

function cell(overrides: Partial<ContainerRowData> = {}): ContainerRowData {
  return {
    item_id: 77, cbm_unit: 0.1, inbound_qty: 500, open_orders: 0, avail_qty: 500,
    allocated_remaining_qty: 40, est_sales: 12, backorder: 0, carryover: null,
    eta: "2026-10-01", inv_life: 30, est_sod: null, plan_sod: null, cbm: 50,
    ...overrides,
  };
}

/** Only the fields the projection reads are meaningful; the rest exist so the
 *  object is a DemandRow. */
function row(sku: string, containers: Record<string, ContainerRowData>): DemandRow {
  return {
    sku, containers, cbm_per_unit: 0.2,
    container_info: "", cbm: 0, seat: "", no: 1, color: "", tone: "", back: 0,
    sales_status: "Original",
    west_stock: 0, east_stock: 0, total_stock: 0,
    west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
    east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
    avg_daily_prev: 0, avg_daily_real: 0, avg_daily_curr: 0,
    east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
    fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
    west_fbm_30d: 0, east_fbm_30d: 0, fba_30d: 0, total_30d: 0,
    total_avg_prev: 0, total_avg_real: 0, total_avg_curr: 0,
    oos_days_90d: null, oos_lost_demand_90d: null,
    total_inbound_qty: null, containers_list: null, next_eta: null, sod: null,
  };
}

const DATA: DemandPlanningData = {
  containers: [container(1, "CT-01"), container(2, "CT-02")],
  rows: [
    row("SKU-A", { "CT-01": cell({ inbound_qty: 500 }), "CT-02": cell({ inbound_qty: 300 }) }),
    row("SKU-B", { "CT-01": cell({ inbound_qty: 100 }) }),
  ],
  last_sync: null,
};

function overlay(items: ScenarioOverlay["items"]): ScenarioOverlay {
  return { items, containers: [] };
}

describe("projectRowsForScenario", () => {
  it("drops cells the tab has no row for, so a Live-only quantity never shows", () => {
    // SKU-A/CT-02 exists on Live but not on this tab: the Container Planning
    // Excel import that put it there must not surface here.
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "1", master_sku: "SKU-A", qty: 500 },
    ]));

    expect(Object.keys(projected.rows[0].containers)).toEqual(["CT-01"]);
    expect(projected.rows[0].containers["CT-01"].inbound_qty).toBe(500);
    // A SKU with no overlay row at all comes back with no containers.
    expect(projected.rows[1].containers).toEqual({});
  });

  it("uses the tab's quantity where it differs from Live", () => {
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "1", master_sku: "SKU-A", qty: 250 },
    ]));

    const projectedCell = projected.rows[0].containers["CT-01"];
    expect(projectedCell.inbound_qty).toBe(250);
    expect(projectedCell.avail_qty).toBe(250);
    expect(projectedCell.cbm).toBeCloseTo(25);
  });

  it("reads a stored 0 as an empty cell, not as Live's quantity", () => {
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "1", master_sku: "SKU-A", qty: 0 },
      { container_id: "2", master_sku: "SKU-A", qty: 300 },
    ]));

    expect(projected.rows[0].containers["CT-01"]).toBeUndefined();
    expect(projected.rows[0].containers["CT-02"].inbound_qty).toBe(300);
  });

  it("keeps Live's non-quantity metadata but drops the real item id", () => {
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "1", master_sku: "SKU-A", qty: 250 },
    ]));

    const projectedCell = projected.rows[0].containers["CT-01"];
    expect(projectedCell.cbm_unit).toBe(0.1);
    expect(projectedCell.allocated_remaining_qty).toBe(40);
    expect(projectedCell.item_id).toBeNull();
  });

  it("carries a cell the tab added where Live has none", () => {
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "2", master_sku: "SKU-B", qty: 80 },
    ]));

    const projectedCell = projected.rows[1].containers["CT-02"];
    expect(projectedCell.inbound_qty).toBe(80);
    expect(projectedCell.item_id).toBeNull();
    // No Live cell to take a cbm_unit from, so the row's per-unit figure is used.
    expect(projectedCell.cbm_unit).toBe(0.2);
    expect(projectedCell.cbm).toBeCloseTo(16);
  });

  it("ignores overlay rows for containers that are no longer columns", () => {
    const projected = projectRowsForScenario(DATA, overlay([
      { container_id: "99", master_sku: "SKU-A", qty: 700 },
    ]));

    expect(projected.rows[0].containers).toEqual({});
  });

  it("shows nothing while the overlay is still loading", () => {
    const projected = projectRowsForScenario(DATA, null);

    expect(projected.rows.every((projectedRow) => Object.keys(projectedRow.containers).length === 0)).toBe(true);
    // Row membership and container columns are unchanged — only quantities go.
    expect(projected.rows.map((projectedRow) => projectedRow.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(projected.containers).toBe(DATA.containers);
  });

  it("projects pinned rows the same way", () => {
    const withPinned: DemandPlanningData = {
      ...DATA,
      pinned_rows: [row("SKU-A", { "CT-01": cell({ inbound_qty: 500 }) })],
    };
    const projected = projectRowsForScenario(withPinned, overlay([
      { container_id: "1", master_sku: "SKU-A", qty: 42 },
    ]));

    expect(projected.pinned_rows?.[0].containers["CT-01"].inbound_qty).toBe(42);
  });

  it("leaves the source data untouched", () => {
    projectRowsForScenario(DATA, overlay([{ container_id: "1", master_sku: "SKU-A", qty: 1 }]));

    expect(DATA.rows[0].containers["CT-01"].inbound_qty).toBe(500);
    expect(DATA.rows[0].containers["CT-02"]).toBeDefined();
  });
});
