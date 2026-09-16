export function isSheetCellPopulated(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Matches the downward data-boundary navigation used by spreadsheet apps.
 * From inside a populated run it stops at that run's final cell. From a
 * boundary or an empty cell it jumps to the next populated cell, falling back
 * to the final visible row when there is no more data.
 */
export function findSheetDownBoundary(values: readonly unknown[], startIndex: number): number {
  const lastIndex = values.length - 1;
  if (lastIndex < 0) return -1;
  const start = Math.max(0, Math.min(startIndex, lastIndex));
  if (start >= lastIndex) return lastIndex;

  if (isSheetCellPopulated(values[start]) && isSheetCellPopulated(values[start + 1])) {
    let index = start + 1;
    while (index < lastIndex && isSheetCellPopulated(values[index + 1])) index += 1;
    return index;
  }

  for (let index = start + 1; index <= lastIndex; index += 1) {
    if (isSheetCellPopulated(values[index])) return index;
  }
  return lastIndex;
}
