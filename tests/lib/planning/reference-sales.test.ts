import { describe, it, expect } from "vitest";
import { colorRuleParts, colorRuleReference, withReferenceSales, type ColorReferenceRule } from "@/lib/planning/reference-sales";

const FABRIC_03_BK: ColorReferenceRule = { categoryCode: "CC", material: "03", color: "BK", referenceColor: "GR", pct: 30 };
const SEAT_COVER_IB: ColorReferenceRule = { categoryCode: "SC", material: null, color: "IB", referenceColor: "BE", pct: 30 };

describe("colorRuleParts", () => {
  it("reads fabric / material third and the colour second to last", () => {
    expect(colorRuleParts("CC-TT-03-Y-BK-1TO")).toMatchObject({ categoryCode: "CC", material: "03", color: "BK" });
    expect(colorRuleParts(" ca-sc-10-f-99-ib-1to ")).toMatchObject({ categoryCode: "SC", material: "10", color: "IB" });
    // A front + back bundle repeats position and size before the colour.
    expect(colorRuleParts("CA-SC-10-F-10-B-40-IB-1TO")).toMatchObject({ categoryCode: "SC", material: "10", color: "IB" });
  });

  it("is null for a SKU with no colour segment to match on", () => {
    expect(colorRuleParts("CC-TT-03-BK")).toBeNull(); // not a 6-segment car cover SKU
    expect(colorRuleParts("CA-SC-10-F-BK-1TO")).toBeNull(); // too short for a seat cover
    expect(colorRuleParts("CA-FM-10-F123")).toBeNull(); // floor mats have no colour
  });
});

describe("colorRuleReference", () => {
  it("names the same SKU in the reference colour", () => {
    expect(colorRuleReference("CC-TT-03-Y-BK-1TO", [FABRIC_03_BK])).toEqual({ referenceSku: "CC-TT-03-Y-GR-1TO", pct: 30 });
    expect(colorRuleReference("CA-SC-10-F-99-IB-1TO", [SEAT_COVER_IB])).toEqual({ referenceSku: "CA-SC-10-F-99-BE-1TO", pct: 30 });
    expect(colorRuleReference("CA-SC-10-F-10-B-40-IB-1TO", [SEAT_COVER_IB])?.referenceSku).toBe("CA-SC-10-F-10-B-40-BE-1TO");
  });

  it("matches the exact colour, category and fabric only", () => {
    const rules = [FABRIC_03_BK, SEAT_COVER_IB];
    expect(colorRuleReference("CC-TT-03-Y-GR-1TO", rules)).toBeNull(); // the reference itself
    expect(colorRuleReference("CC-TT-15-Y-BK-1TO", rules)).toBeNull(); // another fabric
    expect(colorRuleReference("CC-TT-03-Y-BKGR-STR", rules)).toBeNull(); // another colour
    expect(colorRuleReference("CA-SC-03-F-10-BK-1TO", rules)).toBeNull(); // the CC rule does not reach seat covers
    expect(colorRuleReference("CA-SC-10-F-99-BE-1TO", rules)).toBeNull();
  });

  it("prefers a rule limited to the SKU's fabric over one for every fabric", () => {
    const everyFabric: ColorReferenceRule = { categoryCode: "CC", material: null, color: "BK", referenceColor: "LG", pct: 50 };
    expect(colorRuleReference("CC-TT-03-Y-BK-1TO", [everyFabric, FABRIC_03_BK])).toEqual({ referenceSku: "CC-TT-03-Y-GR-1TO", pct: 30 });
    expect(colorRuleReference("CC-TT-03-Y-BK-1TO", [FABRIC_03_BK, everyFabric])).toEqual({ referenceSku: "CC-TT-03-Y-GR-1TO", pct: 30 });
    expect(colorRuleReference("CC-TT-15-Y-BK-1TO", [everyFabric, FABRIC_03_BK])).toEqual({ referenceSku: "CC-TT-15-Y-LG-1TO", pct: 50 });
  });
});

describe("withReferenceSales", () => {
  const AVERAGES = new Set(["avg"]);

  it("matches the planning team's example with no sales of its own", () => {
    const be = { d90: 49, d60: 36, d30: 15, d15: 8, d7: 3 };
    const ib = { d90: 0, d60: 0, d30: 0, d15: 0, d7: 0 };
    expect(withReferenceSales(ib, be, AVERAGES, 30)).toEqual({ d90: 15, d60: 11, d30: 5, d15: 2, d7: 1 });
  });

  it("matches the planning team's example where its own sales are higher", () => {
    const be = { d90: 405, d60: 237, d30: 107, d15: 47, d7: 24 };
    const ib = { d90: 558, d60: 429, d30: 231, d15: 116, d7: 50 };
    expect(withReferenceSales(ib, be, AVERAGES, 30)).toEqual(ib);
  });

  it("keeps the SKU's own figure where it is higher, window by window", () => {
    expect(withReferenceSales({ d90: 20, d30: 1 }, { d90: 40, d30: 10 }, AVERAGES, 30)).toEqual({ d90: 20, d30: 3 });
  });

  it("applies whatever percent the rule carries", () => {
    expect(withReferenceSales({ d90: 0 }, { d90: 40 }, AVERAGES, 50)).toEqual({ d90: 20 });
    expect(withReferenceSales({ d90: 0 }, { d90: 40 }, AVERAGES, 150)).toEqual({ d90: 60 });
  });

  it("does not round the daily averages", () => {
    expect(withReferenceSales({ avg: 0.01 }, { avg: 0.47 }, AVERAGES, 30).avg).toBeCloseTo(0.141, 6);
  });

  it("does not change the inputs", () => {
    const own = { d90: 0 };
    const reference = { d90: 49 };
    withReferenceSales(own, reference, AVERAGES, 30);
    expect(own).toEqual({ d90: 0 });
    expect(reference).toEqual({ d90: 49 });
  });
});
