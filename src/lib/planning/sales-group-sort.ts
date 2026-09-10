/**
 * Sorting that keeps Original and Custom apart.
 *
 * The planning grid's ordinary sort runs one comparison over every row, which
 * interleaves the two sales types. Planners read them as separate books —
 * custom orders are quoted and scheduled differently from stock lines — so
 * this sorts each block on its own, and each block can run in its own
 * direction: biggest custom orders first while the stock lines read A→Z, or
 * the reverse. Which block comes first is part of the choice.
 *
 * Rows that are neither (Part, SWC, Hold, Discontinued, TBD) keep a third
 * block at the end rather than being forced into one of the two; they follow
 * the leading block's direction so the tail is not arbitrary.
 */

export type SortDir = "asc" | "desc";

export type SalesGroup = "Original" | "Custom";

export interface SalesGroupSortOrder {
  /** The block shown on top. */
  first: SalesGroup;
  originalDir: SortDir;
  customDir: SortDir;
}

export function salesGroupRank(status: unknown, order: SalesGroupSortOrder): number {
  if (status === order.first) return 0;
  if (status === "Original" || status === "Custom") return 1;
  return 2;
}

function directionFor(status: unknown, order: SalesGroupSortOrder): SortDir {
  if (status === "Original") return order.originalDir;
  if (status === "Custom") return order.customDir;
  return order.first === "Original" ? order.originalDir : order.customDir;
}

/**
 * The grid's existing value comparison, kept identical so a grouped sort
 * orders a block exactly as a plain sort would: numbers numerically, anything
 * else by numeric-aware collation, and blanks at the end of an ascending sort
 * (which puts them first when it is reversed).
 */
export function compareSortValues(a: unknown, b: unknown, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0;
    return (aEmpty ? 1 : -1) * sign;
  }
  const cmp = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return cmp * sign;
}

export function createSalesGroupComparator<Row>(options: {
  getStatus: (row: Row) => unknown;
  getValue: (row: Row) => unknown;
  order: SalesGroupSortOrder;
}): (a: Row, b: Row) => number {
  const { getStatus, getValue, order } = options;
  return (a, b) => {
    const aStatus = getStatus(a);
    const bStatus = getStatus(b);
    const rankDifference = salesGroupRank(aStatus, order) - salesGroupRank(bStatus, order);
    if (rankDifference !== 0) return rankDifference;
    return compareSortValues(getValue(a), getValue(b), directionFor(aStatus, order));
  };
}
