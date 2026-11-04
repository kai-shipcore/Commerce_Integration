import { describe, it, expect } from "vitest";
import { applyMinTotalAvgCurr } from "@/lib/planning/min-sales";

describe("applyMinTotalAvgCurr", () => {
  it("raises a calculated value below the minimum and flags it", () => {
    expect(applyMinTotalAvgCurr(1.2, 3)).toEqual({ value: 3, applied: true });
  });

  it("keeps a calculated value at or above the minimum", () => {
    expect(applyMinTotalAvgCurr(3, 3)).toEqual({ value: 3, applied: false });
    expect(applyMinTotalAvgCurr(5, 3)).toEqual({ value: 5, applied: false });
  });

  it("is a no-op for an unregistered SKU", () => {
    expect(applyMinTotalAvgCurr(0.5, null)).toEqual({ value: 0.5, applied: false });
    expect(applyMinTotalAvgCurr(0.5, undefined)).toEqual({ value: 0.5, applied: false });
  });
});
