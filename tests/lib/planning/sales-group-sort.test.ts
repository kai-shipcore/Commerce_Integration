import { describe, expect, it } from "vitest";
import {
  compareSortValues,
  createSalesGroupComparator,
  salesGroupRank,
  type SalesGroupSortOrder,
} from "@/lib/planning/sales-group-sort";

type Row = { sku: string; status: string; sales: number };

const rows: Row[] = [
  { sku: "A", status: "Original", sales: 10 },
  { sku: "B", status: "Custom", sales: 30 },
  { sku: "C", status: "Original", sales: 50 },
  { sku: "D", status: "Custom", sales: 20 },
  { sku: "E", status: "Part", sales: 40 },
];

function order(overrides: Partial<SalesGroupSortOrder> = {}): SalesGroupSortOrder {
  return { first: "Original", originalDir: "asc", customDir: "desc", ...overrides };
}

function sortBy(sortOrder: SalesGroupSortOrder, getValue: (row: Row) => unknown = (row) => row.sales) {
  return [...rows]
    .sort(createSalesGroupComparator<Row>({ getStatus: (row) => row.status, getValue, order: sortOrder }))
    .map((row) => row.sku);
}

describe("createSalesGroupComparator", () => {
  it("keeps the two sales types in separate blocks, each in its own direction", () => {
    // Original ascending (10, 50), then Custom descending (30, 20).
    expect(sortBy(order())).toEqual(["A", "C", "B", "D", "E"]);
  });

  it("reverses both directions when asked", () => {
    expect(sortBy(order({ originalDir: "desc", customDir: "asc" }))).toEqual(["C", "A", "D", "B", "E"]);
  });

  it("puts the chosen block on top", () => {
    expect(sortBy(order({ first: "Custom" }))).toEqual(["B", "D", "A", "C", "E"]);
  });

  it("leaves everything else in a block of its own at the end", () => {
    const withMoreOthers = [...rows, { sku: "F", status: "SWC", sales: 5 }];
    const sorted = withMoreOthers
      .sort(createSalesGroupComparator<Row>({ getStatus: (row) => row.status, getValue: (row) => row.sales, order: order() }))
      .map((row) => row.sku);
    expect(sorted.slice(-2)).toEqual(["F", "E"]);
  });

  it("sorts text the way the grid's plain sort does", () => {
    expect(sortBy(order({ customDir: "asc" }), (row) => row.sku)).toEqual(["A", "C", "B", "D", "E"]);
  });
});

describe("salesGroupRank", () => {
  it("ranks the leading block, the other block, then everything else", () => {
    const sortOrder = order({ first: "Custom" });
    expect(salesGroupRank("Custom", sortOrder)).toBe(0);
    expect(salesGroupRank("Original", sortOrder)).toBe(1);
    for (const other of ["Part", "SWC", "Hold", "", undefined, null]) {
      expect(salesGroupRank(other, sortOrder)).toBe(2);
    }
  });
});

describe("compareSortValues", () => {
  it("compares numbers as numbers", () => {
    expect(compareSortValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareSortValues(2, 10, "desc")).toBeGreaterThan(0);
  });

  it("compares text with numeric collation", () => {
    expect(compareSortValues("SKU-2", "SKU-10", "asc")).toBeLessThan(0);
  });

  it("sends blanks to the end of an ascending sort", () => {
    expect(compareSortValues("", "A", "asc")).toBeGreaterThan(0);
    expect(compareSortValues(null, "A", "asc")).toBeGreaterThan(0);
    expect(compareSortValues("", "", "asc")).toBe(0);
  });
});
