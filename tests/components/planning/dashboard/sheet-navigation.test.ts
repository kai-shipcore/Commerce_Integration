import { describe, expect, it } from "vitest";

import { findSheetDownBoundary, isSheetCellPopulated } from "@/components/planning/dashboard/sheet-navigation";

describe("spreadsheet down-boundary navigation", () => {
  it("stops at the end of a contiguous populated region", () => {
    expect(findSheetDownBoundary(["a", "b", 0, "", "c"], 0)).toBe(2);
  });

  it("jumps from a boundary to the next populated cell", () => {
    expect(findSheetDownBoundary(["a", "", null, "b", "c"], 0)).toBe(3);
  });

  it("jumps from an empty cell to the next populated cell", () => {
    expect(findSheetDownBoundary(["a", "", undefined, "b"], 1)).toBe(3);
  });

  it("falls back to the final visible row when no populated cell follows", () => {
    expect(findSheetDownBoundary(["a", "", null, undefined], 1)).toBe(3);
  });

  it("treats zero and false as populated values", () => {
    expect(isSheetCellPopulated(0)).toBe(true);
    expect(isSheetCellPopulated(false)).toBe(true);
  });
});
