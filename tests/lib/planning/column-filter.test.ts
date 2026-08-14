import { describe, it, expect } from "vitest";
import {
  applyColumnFilters, matchesCondition, type ColumnFilter, type ConditionFilter,
} from "@/lib/planning/column-filter";

describe("matchesCondition", () => {
  it("isEmpty / isNotEmpty treat null, undefined and empty string as blank", () => {
    const isEmpty: ConditionFilter = { operator: "isEmpty" };
    const isNotEmpty: ConditionFilter = { operator: "isNotEmpty" };
    for (const blank of [null, undefined, ""]) {
      expect(matchesCondition(blank, isEmpty)).toBe(true);
      expect(matchesCondition(blank, isNotEmpty)).toBe(false);
    }
    expect(matchesCondition("x", isEmpty)).toBe(false);
    expect(matchesCondition("x", isNotEmpty)).toBe(true);
    expect(matchesCondition(0, isNotEmpty)).toBe(true);
  });

  it("text operators are case-insensitive and ignore blank values", () => {
    expect(matchesCondition("Fullerton Stock", { operator: "textContains", value: "STOCK" })).toBe(true);
    expect(matchesCondition("Fullerton Stock", { operator: "textNotContains", value: "stock" })).toBe(false);
    expect(matchesCondition("Fullerton Stock", { operator: "textStartsWith", value: "full" })).toBe(true);
    expect(matchesCondition("Fullerton Stock", { operator: "textEndsWith", value: "STOCK" })).toBe(true);
    expect(matchesCondition("Fullerton", { operator: "textIs", value: "fullerton" })).toBe(true);
    expect(matchesCondition("Fullerton", { operator: "textIs", value: "canary" })).toBe(false);
    expect(matchesCondition(null, { operator: "textContains", value: "x" })).toBe(false);
  });

  it("numeric operators compare as numbers, including string-encoded numbers", () => {
    expect(matchesCondition(10, { operator: "gt", value: "5" })).toBe(true);
    expect(matchesCondition("10", { operator: "gte", value: "10" })).toBe(true);
    expect(matchesCondition(5, { operator: "lt", value: "10" })).toBe(true);
    expect(matchesCondition(10, { operator: "lte", value: "10" })).toBe(true);
    expect(matchesCondition(10, { operator: "eq", value: "10" })).toBe(true);
    expect(matchesCondition(10, { operator: "neq", value: "11" })).toBe(true);
    expect(matchesCondition(0, { operator: "gt", value: "-1" })).toBe(true);
  });

  it("eq/neq fall back to case-insensitive text comparison when either side isn't numeric", () => {
    expect(matchesCondition("Baseline", { operator: "eq", value: "baseline" })).toBe(true);
    expect(matchesCondition("Baseline", { operator: "neq", value: "other" })).toBe(true);
    expect(matchesCondition("Baseline", { operator: "neq", value: "baseline" })).toBe(false);
  });

  it("gt/gte/lt/lte return false rather than throwing when the value isn't numeric", () => {
    expect(matchesCondition("not-a-number", { operator: "gt", value: "5" })).toBe(false);
    expect(matchesCondition(10, { operator: "gt", value: "not-a-number" })).toBe(false);
  });

  it("between/notBetween are inclusive and tolerate reversed bounds", () => {
    expect(matchesCondition(5, { operator: "between", value: "1", value2: "10" })).toBe(true);
    expect(matchesCondition(1, { operator: "between", value: "1", value2: "10" })).toBe(true);
    expect(matchesCondition(10, { operator: "between", value: "1", value2: "10" })).toBe(true);
    expect(matchesCondition(11, { operator: "between", value: "1", value2: "10" })).toBe(false);
    // Reversed bounds (value > value2) should still work, min/max normalize it.
    expect(matchesCondition(5, { operator: "between", value: "10", value2: "1" })).toBe(true);
    expect(matchesCondition(11, { operator: "notBetween", value: "1", value2: "10" })).toBe(true);
    expect(matchesCondition(5, { operator: "notBetween", value: "1", value2: "10" })).toBe(false);
  });

  it("between/notBetween return false when a bound is missing or non-numeric", () => {
    expect(matchesCondition(5, { operator: "between", value: "1" })).toBe(false);
    expect(matchesCondition(5, { operator: "notBetween", value: "1", value2: "x" })).toBe(false);
  });
});

describe("applyColumnFilters with ColumnFilter (values + condition)", () => {
  type Row = { sku: string; qty: number };
  const rows: Row[] = [
    { sku: "A", qty: 0 },
    { sku: "B", qty: 5 },
    { sku: "C", qty: 15 },
  ];
  const accessors = { sku: (r: Row) => r.sku, qty: (r: Row) => r.qty };

  it("filters by a condition the same way it filters by a value set", () => {
    const filters = new Map<"sku" | "qty", ColumnFilter>([
      ["qty", { mode: "condition", condition: { operator: "gt", value: "0" } }],
    ]);
    expect(applyColumnFilters(rows, filters, accessors).map((r) => r.sku)).toEqual(["B", "C"]);
  });

  it("AND-composes a values filter on one column with a condition filter on another", () => {
    const filters = new Map<"sku" | "qty", ColumnFilter>([
      ["sku", { mode: "values", values: new Set(["A", "B", "C"]) }],
      ["qty", { mode: "condition", condition: { operator: "between", value: "1", value2: "10" } }],
    ]);
    expect(applyColumnFilters(rows, filters, accessors).map((r) => r.sku)).toEqual(["B"]);
  });

  it("uses the fill-color accessor for legacy and explicit fill filters", () => {
    const filters = new Map<"sku" | "qty", ColumnFilter>([
      ["qty", { mode: "color", colorType: "fill", colors: new Set(["#ff0"]) }],
    ]);
    const fillColors = { qty: (row: Row) => row.sku === "B" ? "#ff0" : "" };
    const textColors = { qty: (_row: Row) => "#ff0" };
    expect(applyColumnFilters(rows, filters, accessors, undefined, fillColors, textColors).map((row) => row.sku)).toEqual(["B"]);
  });

  it("uses the text-color accessor independently from fill colors", () => {
    const filters = new Map<"sku" | "qty", ColumnFilter>([
      ["qty", { mode: "color", colorType: "text", colors: new Set(["#f0f"]) }],
    ]);
    const fillColors = { qty: (_row: Row) => "#f0f" };
    const textColors = { qty: (row: Row) => row.sku === "C" ? "#f0f" : "" };
    expect(applyColumnFilters(rows, filters, accessors, undefined, fillColors, textColors).map((row) => row.sku)).toEqual(["C"]);
  });
});
