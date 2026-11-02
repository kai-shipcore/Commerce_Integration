import { describe, expect, it } from "vitest";
import {
  baselineBackorderQty,
  currentDailyAverage,
  fivePeriodThirtyDayAverage,
  sheetBaselineBackorderQty,
  sheetContainerBackorderQty,
  sheetContainerEstimatedSales,
  weightedDailyAverage,
} from "@/lib/planning/forecast-calculations";

describe("Google Sheet sales formulas", () => {
  it("uses 15/20/30/20/15 percent weights and excludes preorder from actual daily average", () => {
    expect(weightedDailyAverage(900, 600, 300, 999, 150, 70)).toBe(10);
  });

  it("averages the five 30-day-normalized periods and rounds up", () => {
    expect(fivePeriodThirtyDayAverage(900, 600, 300, 50, 150, 70)).toBe(310);
  });

  it("uses the sheet's previous/actual blend on both sides of the 50% threshold", () => {
    expect(currentDailyAverage(10, 14)).toBeCloseTo(13.6);
    expect(currentDailyAverage(10, 16)).toBeCloseTo(14.2);
  });

  it("matches the sheet Base Back Order rule when Total 30D is zero", () => {
    expect(baselineBackorderQty(-12, 0)).toBe(0);
    expect(baselineBackorderQty(-12, 1)).toBe(12);
    expect(baselineBackorderQty(12, 1)).toBe(0);
  });

  it("suppresses Car Cover -03- back orders like the sheet", () => {
    expect(sheetBaselineBackorderQty("CC-CN-03-P-GR-1TO", -12, 100)).toBe(0);
    expect(sheetContainerBackorderQty("CC-CN-03-P-GR-1TO", 100, 20, 5)).toBe(0);
    expect(sheetBaselineBackorderQty("CC-CN-15-P-GR-1TO", -12, 100)).toBe(12);
  });

  it("caps Car Cover -03- estimated sales at stock before the inbound quantity", () => {
    expect(sheetContainerEstimatedSales("CC-CN-03-P-GR-1TO", 10, 2, 1, 15, 5)).toBe(10);
    expect(sheetContainerEstimatedSales("CC-CN-03-P-GR-1TO", 10, 2, 1, 30, 5)).toBe(20);
    expect(sheetContainerEstimatedSales("CC-CN-15-P-GR-1TO", 10, 2, 1, 0, 0)).toBe(0);
  });

  it("returns a whole number so Avail − Est. Sales = Carry over holds on screen", () => {
    // 7 days × 0.0428/day = 0.2996 → 0, not a decimal that rounds one way in
    // the Est. Sales cell and another once subtracted into Carry over.
    expect(sheetContainerEstimatedSales("CC-CC-15-FOMU187-BKRD-STR", 7, 0.0428, 1, 16, 0)).toBe(0);
    expect(sheetContainerEstimatedSales("CC-CN-15-P-GR-1TO", 7, 5.08, 1, 331, 0)).toBe(36);
    expect(sheetContainerEstimatedSales("CC-CN-03-P-GR-1TO", 7, 5.08, 1, 20.4, 0)).toBe(20);
    expect(sheetContainerEstimatedSales("CA-SC-10-F-10-BK-1TO", 7, 0.5, 1, 10, 0)).toBe(4);
  });
});

describe("a recorded back order outlives the no-recent-sales rule", () => {
  it("keeps a back order fc_stats actually recorded, even at zero 30-day sales", () => {
    // The rule exists to stop negative available stock being read as demand on
    // a SKU nobody buys. A recorded back order is an order someone placed, and
    // the SKUs carrying one are precisely the ones out of stock long enough for
    // their 30-day sales to have fallen to zero.
    expect(baselineBackorderQty(-2, 0, 2)).toBe(2);
    expect(sheetBaselineBackorderQty("CC-CC-15-CHCM14-DGBK-STR", -1, 0, 1)).toBe(1);
  });

  it("changes nothing when there is no recorded back order", () => {
    expect(baselineBackorderQty(-12, 0, 0)).toBe(0);
    expect(baselineBackorderQty(-12, 1, 0)).toBe(12);
  });

  it("still suppresses the -03- Car Cover family", () => {
    expect(sheetBaselineBackorderQty("CC-CN-03-P-GR-1TO", -12, 0, 12)).toBe(0);
    expect(sheetContainerBackorderQty("CC-CN-03-P-GR-1TO", 0, 0, -12)).toBe(0);
  });

  it("keeps an unpaid back order owed at the next container, even at zero 30-day sales", () => {
    // Negative available stock at a container is only ever the carried-in
    // back order less that container's quantity.
    expect(sheetContainerBackorderQty("CC-CC-15-DOCA26-BKLG-STR", 0, 0, -2)).toBe(2);
    expect(sheetContainerBackorderQty("CC-CC-15-DOCA26-BKLG-STR", 0, 0, 7)).toBe(0);
  });

  it("does not turn a forecast shortfall into a back order without recent sales", () => {
    // The BF rule still holds for the derived part: estimated sales beyond
    // stock are not demand anyone has placed.
    expect(sheetContainerBackorderQty("CC-CC-15-DOCA26-BKLG-STR", 0, 10, 3)).toBe(0);
  });
});
