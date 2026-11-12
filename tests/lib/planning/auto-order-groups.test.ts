import { describe, it, expect } from "vitest";
import { TARGET_TIER_GROUPS, isAutoOrderSalesStatus, targetTierGroupForRow } from "@/lib/planning/auto-order-groups";
import { accumulatesBackorder } from "@/lib/planning/floor-mat-sets";
import { sheetContainerBackorderQty } from "@/lib/planning/forecast-calculations";
import type { DemandRow } from "@/types/demand-planning";

const row = (sku: string, category_code: DemandRow["category_code"], sales_status: DemandRow["sales_status"]) => ({
  sku, category_code, sales_status,
});

describe("isAutoOrderSalesStatus", () => {
  it("fills Original and Custom, as before", () => {
    expect(isAutoOrderSalesStatus({ sales_status: "Original" })).toBe(true);
    expect(isAutoOrderSalesStatus({ sales_status: "Custom" })).toBe(true);
  });

  it("fills only 1+2 Set and 3rd Row among the floor mat statuses", () => {
    expect(isAutoOrderSalesStatus({ sales_status: "1+2 Set" })).toBe(true);
    expect(isAutoOrderSalesStatus({ sales_status: "3rd Row" })).toBe(true);
    expect(isAutoOrderSalesStatus({ sales_status: "1+2+3 Set" })).toBe(false);
    expect(isAutoOrderSalesStatus({ sales_status: "1st Row" })).toBe(false);
    expect(isAutoOrderSalesStatus({ sales_status: "2nd Row" })).toBe(false);
  });

  it("leaves Part, SWC, Hold, Discontinued and TBD for manual entry", () => {
    for (const status of ["Part", "SWC", "Hold", "Discontinued", "TBD"] as const) {
      expect(isAutoOrderSalesStatus({ sales_status: status }), status).toBe(false);
    }
  });
});

describe("targetTierGroupForRow", () => {
  it("gives 1+2 Set and 3rd Row a target-days group of their own", () => {
    expect(targetTierGroupForRow(row("CA-FM-80-FM15116", "FM", "1+2 Set"))).toBe("fm_set");
    expect(targetTierGroupForRow(row("CA-FM-TX-80-S3-BM-X705", "FM", "3rd Row"))).toBe("fm_third");
    expect(TARGET_TIER_GROUPS).toContain("fm_set");
    expect(TARGET_TIER_GROUPS).toContain("fm_third");
  });

  it("keeps a floor mat without one of those statuses in Other", () => {
    expect(targetTierGroupForRow(row("CA-FM-80-FM15116", "FM", "Original"))).toBe("other");
  });

  it("leaves the existing groups unchanged", () => {
    expect(targetTierGroupForRow(row("CA-SC-10-F-10-BK-1TO", "SC", "Original"))).toBe("sc_original");
    expect(targetTierGroupForRow(row("CA-SC-10-F-10-BK-1TO", "SC", "Custom"))).toBe("sc_custom");
    expect(targetTierGroupForRow(row("CC-CN-03-P-GR-1TO", "CC", "Original"))).toBe("cc_03");
    expect(targetTierGroupForRow(row("CC-CC-15-DGCH05-BKRD-STR", "CC", "Original"))).toBe("cc_15");
    expect(targetTierGroupForRow(row("CC-CN-07-P-GR-1TO", "CC", "Original"))).toBe("other");
    expect(targetTierGroupForRow(row("CA-AC-1", "AC", "Original"))).toBe("other");
  });
});

describe("back order accumulation", () => {
  it("accumulates for everything except the 1st and 2nd Row components", () => {
    expect(accumulatesBackorder("1st Row")).toBe(false);
    expect(accumulatesBackorder("2nd Row")).toBe(false);
    for (const status of ["1+2 Set", "1+2+3 Set", "3rd Row", "Original", "Custom", null, undefined]) {
      expect(accumulatesBackorder(status), String(status)).toBe(true);
    }
  });

  it("projects a shortfall from forecast sales for a set or a 3rd Row", () => {
    // 20 forecast sales against 5 available: 15 short.
    expect(sheetContainerBackorderQty("CA-FM-80-FM15116", 100, 20, 5)).toBe(15);
    expect(sheetContainerBackorderQty("CA-FM-80-FM15116", 100, 20, 5, true)).toBe(15);
  });

  it("shows only the live back order still unfilled for a 1st / 2nd Row component", () => {
    // Stock covers the container: nothing owed, however many are forecast to sell.
    expect(sheetContainerBackorderQty("CA-FM-TX-80-T1-FD-F509", 100, 20, 5, false)).toBe(0);
    // A live back order of 3 that this container did not cover stays at 3.
    expect(sheetContainerBackorderQty("CA-FM-TX-80-T1-FD-F509", 100, 20, -3, false)).toBe(3);
  });
});
