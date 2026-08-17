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
});
