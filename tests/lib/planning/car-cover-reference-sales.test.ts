import { describe, it, expect } from "vitest";
import { fabric03ReferenceSku, withReferenceSales } from "@/lib/planning/car-cover-reference-sales";

describe("fabric03ReferenceSku", () => {
  it("names the GR SKU for a Fabric 03 BK car cover", () => {
    expect(fabric03ReferenceSku("CC-TT-03-Y-BK-1TO")).toBe("CC-TT-03-Y-GR-1TO");
    expect(fabric03ReferenceSku(" cc-ts-03-s-bk-1to ")).toBe("CC-TS-03-S-GR-1TO");
  });

  it("is null for everything else", () => {
    expect(fabric03ReferenceSku("CC-TT-03-Y-GR-1TO")).toBeNull(); // the reference itself
    expect(fabric03ReferenceSku("CC-TT-15-Y-BK-1TO")).toBeNull(); // another fabric
    expect(fabric03ReferenceSku("CC-TT-03-Y-BKGR-STR")).toBeNull(); // another colour
    expect(fabric03ReferenceSku("CC-TT-03-BK")).toBeNull(); // not a 6-segment car cover SKU
    expect(fabric03ReferenceSku("CA-SC-03-F-BK-1TO")).toBeNull(); // not a car cover
  });
});

describe("withReferenceSales", () => {
  const AVERAGES = new Set(["avg"]);

  it("matches the planning team's example", () => {
    const gr = { d90: 49, d60: 36, d30: 15, d15: 8, d7: 3 };
    const bk = { d90: 0, d60: 0, d30: 0, d15: 0, d7: 0 };
    expect(withReferenceSales(bk, gr, AVERAGES)).toEqual({ d90: 15, d60: 11, d30: 5, d15: 2, d7: 1 });
  });

  it("keeps the SKU's own figure where it is higher", () => {
    expect(withReferenceSales({ d90: 20, d30: 1 }, { d90: 40, d30: 10 }, AVERAGES)).toEqual({ d90: 20, d30: 3 });
  });

  it("does not round the daily averages", () => {
    expect(withReferenceSales({ avg: 0.01 }, { avg: 0.47 }, AVERAGES).avg).toBeCloseTo(0.141, 6);
  });

  it("does not change the inputs", () => {
    const own = { d90: 0 };
    const reference = { d90: 49 };
    withReferenceSales(own, reference, AVERAGES);
    expect(own).toEqual({ d90: 0 });
    expect(reference).toEqual({ d90: 49 });
  });
});
