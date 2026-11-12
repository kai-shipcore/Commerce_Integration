import { describe, it, expect, afterEach } from "vitest";
import {
  buildFloorMatView,
  componentPairingLines,
  floorMatMaster,
  floorMatTotalStock,
  looseSetsOrdered,
  looseSetsOrderedIsSplit,
  pairsAfter,
  setFloorMatView,
  usableArrival,
} from "@/lib/planning/floor-mat-dashboard";
import type { DemandRow } from "@/types/demand-planning";

type RowPatch = Partial<DemandRow> & { sku: string; orders?: Record<string, number> };

function row({ orders = {}, ...patch }: RowPatch): DemandRow {
  return {
    back: 0,
    total_stock: 0,
    total_avg_curr: 0,
    fullerton_available_stock: 0,
    dream_trans_available_stock: 0,
    ttm_available_stock: 0,
    ttm_jeff_available_stock: 0,
    canary_available_stock: 0,
    linkone_available_stock: 0,
    containers: Object.fromEntries(Object.entries(orders).map(([name, qty]) => [name, { inbound_qty: qty }])),
    ...patch,
  } as unknown as DemandRow;
}

const set = (frontSku: string | null, rearSku: string | null) => ({
  frontSku, rearSku, preOrder12: null, preOrder3: null, thirdRows: [], oldSetSkus: [],
});

const qtyFor = (r: DemandRow, name: string) => r.containers?.[name]?.inbound_qty ?? 0;

// The sheet's CA-FM-80-FM14230: 3 fronts at East, 2 arriving in FM02 and 1 in FM03; 6 rears at East.
const FM14230_ROWS = [
  row({ sku: "FM14230", fm_set: set("T1-F509", "T2-F533"), total_avg_curr: 0.076, total_stock: 3 }),
  row({ sku: "T1-F509", ttm_available_stock: 3, total_stock: 3, orders: { FM02: 2, FM03: 1 } }),
  row({ sku: "T2-F533", ttm_available_stock: 4, ttm_jeff_available_stock: 2, total_stock: 6 }),
];

afterEach(() => setFloorMatView(null));

describe("buildFloorMatView", () => {
  it("returns null when no row has set links", () => {
    expect(buildFloorMatView([row({ sku: "CA-SC-1" })], ["FM02"], qtyFor)).toBeNull();
  });

  it("pairs from the dashboard's warehouse columns: Fullerton, Dream Trans, TTM + TTM Jefferson", () => {
    const view = buildFloorMatView(
      [
        row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 }),
        row({ sku: "F", fullerton_available_stock: 1, dream_trans_available_stock: 2, ttm_available_stock: 3, ttm_jeff_available_stock: 4 }),
        row({ sku: "R", ttm_jeff_available_stock: 20 }),
      ],
      [],
      qtyFor,
    )!;
    const master = view.result.masters.get("M")!;
    expect(master.frontStock).toBe(10);
    expect(master.pairs).toEqual([10]);
    // TTM and TTM Jefferson are one location (East): 7 fronts pair there, the other 3 are split.
    expect(master.fullSets.east).toBe(7);
  });

  it("leaves Canary and Linkone stock out of pairing", () => {
    const view = buildFloorMatView(
      [
        row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 }),
        row({ sku: "F", canary_available_stock: 5, linkone_available_stock: 5 }),
        row({ sku: "R", ttm_available_stock: 5 }),
      ],
      [],
      qtyFor,
    )!;
    expect(view.result.masters.get("M")).toMatchObject({ frontStock: 0, pairs: [0] });
  });

  it("reads a component's backorder from the negated `back` column", () => {
    const view = buildFloorMatView(
      [
        row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 }),
        row({ sku: "F", back: -1, orders: { FM02: 1, FM03: 1 } }),
        row({ sku: "R", ttm_available_stock: 5 }),
      ],
      ["FM02", "FM03"],
      qtyFor,
    )!;
    expect(view.result.masters.get("M")!.frontArrivals).toEqual([0, 1]);
  });

  it("orders masters by T.Avg current and takes container quantities from qtyFor", () => {
    const rows = [
      row({ sku: "LOW", fm_set: set("F", "R"), total_avg_curr: 0.1 }),
      row({ sku: "HIGH", fm_set: set("F", "R2"), total_avg_curr: 0.9 }),
      row({ sku: "F", orders: { FM02: 1 } }),
      row({ sku: "R", ttm_available_stock: 5 }),
      row({ sku: "R2", ttm_available_stock: 5 }),
    ];
    expect(buildFloorMatView(rows, ["FM02"], qtyFor)!.result.masters.get("HIGH")!.pairs).toEqual([0, 1]);
    // An edit on screen that moves the front order away removes the pair.
    expect(buildFloorMatView(rows, ["FM02"], () => 0)!.result.masters.get("HIGH")!.pairs).toEqual([0, 0]);
  });

  it("treats a component that is not on the dashboard as having no stock", () => {
    const view = buildFloorMatView([row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 })], [], qtyFor)!;
    expect(view.result.masters.get("M")).toMatchObject({ frontStock: 0, rearStock: 0, pairs: [0] });
  });

  it("returns null on a historical view, where stock by warehouse is blank", () => {
    const rows = [
      row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 }),
      row({ sku: "F", fullerton_available_stock: null, dream_trans_available_stock: null, ttm_available_stock: null }),
      row({ sku: "R", ttm_available_stock: 5 }),
    ];
    expect(buildFloorMatView(rows, [], qtyFor)).toBeNull();
  });

  it("ignores pinned rows", () => {
    const rows = [row({ sku: "M", fm_set: set("F", "R"), pinned: true })];
    expect(buildFloorMatView(rows, [], qtyFor)).toBeNull();
  });
});

describe("view accessors", () => {
  it("are empty until a view is set", () => {
    expect(floorMatMaster("FM14230")).toBeUndefined();
    expect(looseSetsOrdered("FM14230", "FM02")).toBe(0);
    expect(looseSetsOrderedIsSplit("FM14230", "FM02")).toBe(false);
    expect(pairsAfter("FM14230", "FM02", false)).toBeNull();
    expect(usableArrival("FM14230", "FM02", "front")).toBeNull();
    expect(componentPairingLines("T1-F509", "FM02")).toEqual([]);
  });

  it("report a master's sets per container (X = 3 → 5 → 6)", () => {
    setFloorMatView(buildFloorMatView(FM14230_ROWS, ["FM02", "FM03"], qtyFor));

    expect(pairsAfter("FM14230", "Base", true)).toBe(3); // current pairs under the Base column
    expect(pairsAfter("FM14230", "FM02", false)).toBe(5);
    expect(pairsAfter("FM14230", "FM03", false)).toBe(6);
    expect(looseSetsOrdered("FM14230", "FM02")).toBe(2);
    expect(looseSetsOrdered("FM14230", "FM03")).toBe(1);
    expect(usableArrival("FM14230", "FM02", "front")).toBe(2);
    expect(usableArrival("FM14230", "FM02", "rear")).toBeNull();
    expect(floorMatTotalStock("T2-F533")).toBe(6);
  });

  it("flag a container whose new sets are split between warehouses", () => {
    setFloorMatView(buildFloorMatView(FM14230_ROWS, ["FM02", "FM03"], qtyFor));
    // The incoming fronts land at Dream Trans and pair with rears at TTM.
    expect(looseSetsOrderedIsSplit("FM14230", "FM02")).toBe(true);
    expect(looseSetsOrderedIsSplit("FM14230", "FM03")).toBe(true);
  });

  it("do not flag a container for a split that was already in current stock", () => {
    setFloorMatView(buildFloorMatView(
      [
        row({ sku: "M", fm_set: set("F", "R"), total_avg_curr: 1 }),
        row({ sku: "F", fullerton_available_stock: 2 }),
        row({ sku: "R", ttm_available_stock: 2, dream_trans_available_stock: 0, orders: { FM02: 0 } }),
        row({ sku: "M2", fm_set: set("F2", "R"), total_avg_curr: 0.5 }),
        row({ sku: "F2", dream_trans_available_stock: 1 }),
        row({ sku: "R-EXTRA" }),
      ],
      ["FM02"],
      (r, name) => (r.sku === "R" && name === "FM02" ? 1 : 0),
    ));
    // M's 2 current pairs are split (Fullerton front, TTM rear) but FM02 adds nothing to M.
    expect(floorMatMaster("M")!.splitAdded).toEqual([2, 0]);
    expect(looseSetsOrderedIsSplit("M", "FM02")).toBe(false);
    // M2 gains a complete Dream Trans set from the incoming rear: no split, no highlight.
    expect(looseSetsOrdered("M2", "FM02")).toBe(1);
    expect(looseSetsOrderedIsSplit("M2", "FM02")).toBe(false);
  });

  it("list, on a component row with an order, the masters its units pair into", () => {
    setFloorMatView(buildFloorMatView(
      [
        row({ sku: "CA-FM-80-FM15116", fm_set: set("T1-F5L1", "T2-F5L1"), total_avg_curr: 0.4555 }),
        row({ sku: "CA-FM-80-FM15164", fm_set: set("T1-FS24", "T2-F5L1"), total_avg_curr: 0.137 }),
        row({ sku: "T1-F5L1", dream_trans_available_stock: 15 }),
        row({ sku: "T1-FS24", orders: { FM02: 2 } }),
        row({ sku: "T2-F5L1", orders: { FM02: 16 } }),
      ],
      ["FM02"],
      qtyFor,
    ));
    expect(componentPairingLines("T2-F5L1", "FM02")).toEqual(["FM15116 × 15", "FM15164 × 1"]);
    // T1-F5L1 pairs in FM02 too, but has no order in that container, so its row shows nothing.
    expect(componentPairingLines("T1-F5L1", "FM02")).toEqual([]);
  });
});
