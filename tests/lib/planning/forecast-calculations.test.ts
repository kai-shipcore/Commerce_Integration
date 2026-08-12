import { describe, expect, it } from "vitest";
import {
  baselineBackorderQty,
  fivePeriodThirtyDayAverage,
  weightedDailyAverage,
} from "@/lib/planning/forecast-calculations";

describe("Google Sheet sales formulas", () => {
  it("uses 15/20/30/20/15 percent weights and excludes preorder from actual daily average", () => {
    expect(weightedDailyAverage(900, 600, 300, 999, 150, 70)).toBe(10);
  });

  it("averages the five 30-day-normalized periods and rounds up", () => {
    expect(fivePeriodThirtyDayAverage(900, 600, 300, 50, 150, 70)).toBe(310);
  });

  it("matches the sheet Base Back Order rule when Total 30D is zero", () => {
    expect(baselineBackorderQty(-12, 0)).toBe(0);
    expect(baselineBackorderQty(-12, 1)).toBe(12);
    expect(baselineBackorderQty(12, 1)).toBe(0);
  });
});
