/**
 * Keeps native columns from different containers from interleaving while
 * preserving every non-container slot. Custom/formula columns are intentionally
 * fixed in place, so users may put them anywhere, including between two native
 * columns in the same container.
 */
export function keepContainerColumnsTogether(columnIds: readonly string[]): string[] {
  const columnsByContainer = new Map<string, string[]>();

  for (const columnId of columnIds) {
    const separator = columnId.indexOf("::");
    if (separator < 0) continue;
    const containerId = columnId.slice(0, separator);
    const columns = columnsByContainer.get(containerId) ?? [];
    columns.push(columnId);
    columnsByContainer.set(containerId, columns);
  }

  const emittedContainers = new Set<string>();
  const normalizedContainerColumns: string[] = [];
  for (const columnId of columnIds) {
    const separator = columnId.indexOf("::");
    if (separator < 0) continue;
    const containerId = columnId.slice(0, separator);
    if (emittedContainers.has(containerId)) continue;
    emittedContainers.add(containerId);
    normalizedContainerColumns.push(...(columnsByContainer.get(containerId) ?? []));
  }

  let containerIndex = 0;
  return columnIds.map((columnId) => (
    columnId.includes("::") ? normalizedContainerColumns[containerIndex++] : columnId
  ));
}

/** Restores one container's known subcolumns to their product-defined order. */
export function resetContainerSubcolumnOrder(
  containerName: string,
  existingColumnIds: readonly string[],
  defaultSubcolumnIds: readonly string[],
): string[] {
  const existingSet = new Set(existingColumnIds);
  const defaultColumnIds = defaultSubcolumnIds.map((subcolumnId) => `${containerName}::${subcolumnId}`);
  const defaultSet = new Set(defaultColumnIds);

  return [
    ...defaultColumnIds.filter((columnId) => existingSet.has(columnId)),
    ...existingColumnIds.filter((columnId) => !defaultSet.has(columnId)),
    ...defaultColumnIds.filter((columnId) => !existingSet.has(columnId)),
  ];
}
