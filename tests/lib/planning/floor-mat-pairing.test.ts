import { describe, it, expect } from "vitest";
import {
  computeFloorMatPairing,
  floorMatMasterLabel,
  formatSplit,
  type PairingComponentStock,
  type PairingMasterInput,
} from "@/lib/planning/floor-mat-pairing";

// The cases below are the worked examples from the planning team's sheet
// ("L tab Formulas" / "HL - Pairing Locations Formulas"), with the same SKUs
// and quantities, so a change in behaviour shows up against their numbers.

const stockAt = (patch: Partial<PairingComponentStock>): PairingComponentStock => ({
  primary: 0, dtrans: 0, east: 0, backorder: 0, ...patch,
});

function run(
  masters: PairingMasterInput[],
  components: Record<string, Partial<PairingComponentStock>>,
  containers: Array<Record<string, number>> = [{}, {}]
) {
  return computeFloorMatPairing({
    masters,
    components: new Map(Object.entries(components).map(([sku, value]) => [sku, stockAt(value)])),
    containers: containers.map((orders, index) => ({ id: `FM0${index + 2}`, orders: new Map(Object.entries(orders)) })),
  });
}

const master = (masterSku: string, frontSku: string | null, rearSku: string | null, ads: number): PairingMasterInput => ({
  masterSku, frontSku, rearSku, ads,
});

describe("usable arrivals (FM02 1st / FM03 1st ...)", () => {
  it("takes the component backorder out of the first order, and not again out of the next", () => {
    // CA-FM-80-FM14077: front has 0 stock, 1 backorder, 1 ordered in FM02 and 1 in FM03.
    const result = run(
      [master("FM14077", "T1-GM-S110", "T2-GM-S110", 0.1194)],
      { "T1-GM-S110": { backorder: 1 }, "T2-GM-S110": { east: 5 } },
      [{ "T1-GM-S110": 1 }, { "T1-GM-S110": 1 }]
    );
    const row = result.masters.get("FM14077")!;

    // FM02: MAX(0, 1 ordered − 1 backorder) = 0. FM03: backorder already covered, so 1.
    expect(row.frontArrivals).toEqual([0, 1]);
    // The FM03 unit can form a pair.
    expect(row.pairs).toEqual([0, 0, 1]);
  });

  it("carries only the unfilled backorder into the next container", () => {
    const result = run(
      [master("M", "F", "R", 1)],
      { F: { backorder: 5 }, R: { east: 10 } },
      [{ F: 2 }, { F: 4 }, { F: 3 }]
    );
    // 5 backorder: FM02's 2 all go to it (3 left), FM03's 4 leave 1, the third container is free.
    expect(result.masters.get("M")!.frontArrivals).toEqual([0, 1, 3]);
  });

  it("is null when the container has no order for the component", () => {
    const result = run([master("M", "F", "R", 1)], { F: { east: 1 }, R: { east: 1 } }, [{ R: 2 }, {}]);
    expect(result.masters.get("M")!.frontArrivals).toEqual([null, null]);
    expect(result.masters.get("M")!.rearArrivals).toEqual([2, null]);
  });

  it("does not take the backorder out of on-hand stock", () => {
    const result = run([master("M", "F", "R", 1)], { F: { east: 3, backorder: 2 }, R: { east: 3 } });
    expect(result.masters.get("M")!.pairs[0]).toBe(3);
  });
});

describe("pairs per stage (X / Y / Z)", () => {
  it("pairs current stock: MIN(fronts, rears)", () => {
    // CA-FM-80-FM15143: 6 fronts and 8 rears on hand.
    const result = run([master("FM15143", "T1-FD-FS07", "T2-FD-FS31", 0.042)], {
      "T1-FD-FS07": { east: 6 },
      "T2-FD-FS31": { east: 8 },
    });
    expect(result.masters.get("FM15143")!.pairs).toEqual([6, 6, 6]);
  });

  it("adds pairs container by container; the counts are cumulative", () => {
    // CA-FM-80-FM14230: 3 fronts on hand, 2 arriving in FM02 and 1 in FM03; 6 rears on hand.
    const result = run(
      [master("FM14230", "T1-FD-F509", "T2-FD-F533", 0.076)],
      { "T1-FD-F509": { east: 3 }, "T2-FD-F533": { east: 6 } },
      [{ "T1-FD-F509": 2 }, { "T1-FD-F509": 1 }]
    );
    const row = result.masters.get("FM14230")!;

    expect(row.pairs).toEqual([3, 5, 6]); // X = 3 → Y = 5 → Z = 6
    expect(row.added).toEqual([3, 2, 1]); // Loose Sets On Hand 3, Ordered 2 (FM02) and 1 (FM03)
  });

  it("gives a master with no rear, or no components, zero pairs", () => {
    const result = run(
      [master("FRONT-ONLY", "F", null, 2), master("NONE", null, null, 1)],
      { F: { east: 9 } }
    );
    expect(result.masters.get("FRONT-ONLY")).toMatchObject({ pairable: false, pairs: [0, 0, 0], frontStock: 9, rearStock: null });
    expect(result.masters.get("NONE")).toMatchObject({ pairable: false, pairs: [0, 0, 0] });
  });

  it("works with no containers and with more than two", () => {
    const stock = { F: { east: 1 }, R: { east: 4 } };
    expect(run([master("M", "F", "R", 1)], stock, []).masters.get("M")!.pairs).toEqual([1]);
    expect(
      run([master("M", "F", "R", 1)], stock, [{ F: 1 }, {}, { F: 1 }, { F: 5 }]).masters.get("M")!.pairs
    ).toEqual([1, 2, 2, 3, 4]);
  });
});

describe("shared components", () => {
  // The sheet's FS24 / FS31 / F5L1 group. Listed out of ADS order on purpose.
  const shared = () =>
    run(
      [
        master("FM15143", "T1-FD-FS07", "T2-FD-FS31", 0.042),
        master("FM15145", "T1-FD-FS24", "T2-FD-FS31", 0.059),
        master("FM15164", "T1-FD-FS24", "T2-FD-F5L1", 0.137),
        master("FM15116", "T1-FD-F5L1", "T2-FD-F5L1", 0.4555),
      ],
      {
        "T1-FD-FS07": { east: 6 },
        "T2-FD-FS31": { east: 8 },
        "T1-FD-FS24": {},
        "T1-FD-F5L1": { dtrans: 15 },
        "T2-FD-F5L1": {},
      },
      [{ "T1-FD-FS24": 2, "T2-FD-F5L1": 16 }, { "T1-FD-F5L1": 1 }]
    );

  it("serves masters in descending ADS", () => {
    expect(shared().order).toEqual(["FM15116", "FM15164", "FM15145", "FM15143"]);
  });

  it("protects a lower-ADS master's current pairs from a higher-ADS master's later claim", () => {
    const result = shared();
    // FM15143 keeps its 6 current pairs although FM15145 ranks above it and shares the rear.
    expect(result.masters.get("FM15143")!.pairs).toEqual([6, 6, 6]);
    // FM15145: fronts 0 + 2 FM02 − 1 used by FM15164 = 1; rears 8 − 6 protected = 2 → 1 pair.
    expect(result.masters.get("FM15145")!.pairs).toEqual([0, 1, 1]);
  });

  it("reserves each incoming unit once across masters", () => {
    const result = shared();
    // 16 FM02 rears: 15 to FM15116, the last one to FM15164.
    expect(result.masters.get("FM15116")!.pairs).toEqual([0, 15, 15]);
    expect(result.masters.get("FM15164")!.pairs).toEqual([0, 1, 1]);
    // The extra FM03 front finds no rear left, so no 16th pair.
    expect(result.masters.get("FM15116")!.added[2]).toBe(0);
  });

  it("reports Lost (used by other masters) and Free (includes this master's own pairs)", () => {
    const row = shared().masters.get("FM15145")!;
    expect(row.lostFront).toBe(1); // FM15164 took 1 of the 2 FS24 fronts
    expect(row.lostRear).toBe(6); // FM15143's protected pairs
    expect(row.freeFront).toBe(1); // 0 + 2 − 1
    expect(row.freeRear).toBe(2); // 8 − 6
  });

  it("recommends the missing piece once, on the highest-ADS master using the leftover", () => {
    const result = shared();
    // FM15145: 2 rears free against 1 front → 1 front needed. It is the first master using FS31.
    expect(result.masters.get("FM15145")).toMatchObject({ frontNeeded: 1, rearNeeded: null, gap: 1 });
    // FM15116: 16 fronts against 15 rears → 1 rear needed.
    expect(result.masters.get("FM15116")).toMatchObject({ frontNeeded: null, rearNeeded: 1, gap: 1 });
    // FM15143 also has rears left over, but FS31's shortage is already shown on FM15145.
    expect(result.masters.get("FM15143")).toMatchObject({ frontNeeded: null, gap: null });
  });

  it("lists, per component and container, the masters its units pair into", () => {
    const result = shared();
    // Sheet: T2-FD-F5L1 shows "FM15116 × 15 / FM15164 × 1" under FM02.
    expect(result.components.get("T2-FD-F5L1")).toMatchObject({
      arrivals: [16, null],
      pairings: [
        [{ masterSku: "FM15116", qty: 15 }, { masterSku: "FM15164", qty: 1 }],
        [],
      ],
    });
    // Sheet: T1-FD-FS24 shows "FM15164 × 1 / FM15145 × 1".
    expect(result.components.get("T1-FD-FS24")!.pairings[0]).toEqual([
      { masterSku: "FM15164", qty: 1 },
      { masterSku: "FM15145", qty: 1 },
    ]);
  });

  it("keeps input order between masters with the same ADS", () => {
    const result = run([master("B", "F", "R", 1), master("A", "F", "R", 1)], { F: { east: 1 }, R: { east: 1 } });
    expect(result.order).toEqual(["B", "A"]);
    expect(result.masters.get("B")!.pairs[0]).toBe(1);
    expect(result.masters.get("A")!.pairs[0]).toBe(0);
  });
});

describe("warehouse routes (Full Sets / Set Split)", () => {
  it("matches a Primary front with an incoming Dtrans rear as a split set", () => {
    // CA-FM-80-FM13752: fronts 3 Primary + 15 East; rears 15 East, 3 more arriving in FM02.
    const result = run(
      [master("FM13752", "S1-MA-C901", "S2-MA-C901", 0.013)],
      { "S1-MA-C901": { primary: 3, east: 15 }, "S2-MA-C901": { east: 15 } },
      [{ "S2-MA-C901": 3 }, {}]
    );
    const row = result.masters.get("FM13752")!;

    expect(row.pairs).toEqual([15, 18, 18]);
    expect(row.fullSets).toEqual({ primary: 0, dtrans: 0, east: 15 });
    expect(formatSplit(row.split.primary)).toBe("Front: 3 | Rear: 0");
    expect(formatSplit(row.split.dtrans)).toBe("Front: 0 | Rear: 3");
    expect(formatSplit(row.split.east)).toBeNull();
    // The 3 split sets were created by FM02, so that is the cell to highlight.
    expect(row.splitAdded).toEqual([0, 3, 0]);
  });

  it("keeps incoming fronts at Dtrans: their pairs with East rears are split", () => {
    // CA-FM-80-FM14230: 3 fronts at East, 2 + 1 arriving; 6 rears at East.
    const result = run(
      [master("FM14230", "T1-FD-F509", "T2-FD-F533", 0.076)],
      { "T1-FD-F509": { east: 3 }, "T2-FD-F533": { east: 6 } },
      [{ "T1-FD-F509": 2 }, { "T1-FD-F509": 1 }]
    );
    const row = result.masters.get("FM14230")!;

    expect(row.fullSets).toEqual({ primary: 0, dtrans: 0, east: 3 }); // although Z totals 6
    expect(formatSplit(row.split.dtrans)).toBe("Front: 3 | Rear: 0");
    expect(formatSplit(row.split.east)).toBe("Front: 0 | Rear: 3");
    expect(row.splitAdded).toEqual([0, 2, 1]);
  });

  it("pairs same-location stock at Dtrans when the incoming rears land there", () => {
    // CA-FM-80-FM15116: 15 fronts at Dtrans, 16 rears arriving in FM02.
    const result = run(
      [master("FM15116", "T1-FD-F5L1", "T2-FD-F5L1", 0.4555)],
      { "T1-FD-F5L1": { dtrans: 15 }, "T2-FD-F5L1": {} },
      [{ "T2-FD-F5L1": 16 }, {}]
    );
    const row = result.masters.get("FM15116")!;
    expect(row.fullSets).toEqual({ primary: 0, dtrans: 15, east: 0 });
    expect(row.splitAdded).toEqual([0, 0, 0]);
  });

  it("uses same-location pairs first, then splits the rest, across masters sharing a rear", () => {
    // CA-FM-80-FM15366 (front: 1 East + 1 Dtrans) and FM15361 (front: 17 East) share 18 East rears.
    const result = run(
      [
        master("FM15361", "T1-TT-TA07", "T2-TT-TA02", 0.0475),
        master("FM15366", "T1-TT-TA18", "T2-TT-TA02", 0.1447),
      ],
      {
        "T1-TT-TA18": { east: 1, dtrans: 1 },
        "T1-TT-TA07": { east: 17 },
        "T2-TT-TA02": { east: 18 },
      },
      [{}, { "T2-TT-TA02": 1 }]
    );
    const first = result.masters.get("FM15366")!;
    const second = result.masters.get("FM15361")!;

    // FM15366: 1 complete East set, then its Dtrans front with an East rear.
    expect(first.pairs[0]).toBe(2);
    expect(first.fullSets.east).toBe(1);
    expect(formatSplit(first.split.dtrans)).toBe("Front: 1 | Rear: 0");
    expect(first.splitAdded).toEqual([1, 0, 0]); // split in current stock: no container cell to highlight

    // FM15361: 16 East pairs from the 16 rears left, then its last East front with the FM03 Dtrans rear.
    expect(second.pairs).toEqual([16, 16, 17]);
    expect(second.fullSets.east).toBe(16);
    expect(formatSplit(second.split.east)).toBe("Front: 1 | Rear: 0");
    expect(second.splitAdded).toEqual([0, 0, 1]);
  });

  it("routes every allocated pair somewhere", () => {
    const result = run(
      [master("A", "F", "R1", 3), master("B", "F", "R2", 2), master("C", "F2", "R1", 1)],
      {
        F: { primary: 2, dtrans: 3, east: 4 },
        F2: { primary: 1, east: 2 },
        R1: { primary: 1, dtrans: 1, east: 5 },
        R2: { dtrans: 2 },
      },
      [{ F: 3, R2: 4 }, { F2: 2, R1: 6 }]
    );
    for (const row of result.masters.values()) {
      row.routes.forEach((stageRoutes, stage) => {
        expect(stageRoutes.reduce((sum, value) => sum + value, 0)).toBe(row.added[stage]);
      });
      const full = row.fullSets.primary + row.fullSets.dtrans + row.fullSets.east;
      const splitFronts = row.split.primary.front + row.split.dtrans.front + row.split.east.front;
      expect(full + splitFronts).toBe(row.pairs[row.pairs.length - 1]);
    }
  });
});

describe("input hygiene", () => {
  it("treats a component with no stock record as empty, and ignores negative or fractional quantities", () => {
    const result = run([master("M", "F", "R", 1)], { F: { east: 2.9, primary: -4 } });
    expect(result.masters.get("M")).toMatchObject({ frontStock: 2, rearStock: 0, pairs: [0, 0, 0] });
  });

  it("ignores a repeated master", () => {
    const result = run([master("M", "F", "R", 1), master("M", "F", "R", 1)], { F: { east: 1 }, R: { east: 1 } });
    expect(result.order).toEqual(["M"]);
  });
});

describe("labels", () => {
  it("shortens a master SKU to its FM segment", () => {
    expect(floorMatMasterLabel("CA-FM-80-FM15116")).toBe("FM15116");
    expect(floorMatMasterLabel("CA-FM-80-FM13534-C")).toBe("FM13534-C");
    expect(floorMatMasterLabel("OTHER-SKU")).toBe("OTHER-SKU");
  });
});
