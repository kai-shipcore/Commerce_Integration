export interface ContainerItemSourceRow {
  masterSku: string;
  qtys: Record<string, number>;
}

export interface ExistingContainerItemRow {
  id: string;
  containerId: string;
  masterSku: string;
}

interface PlanContainerItemSyncInput {
  containerNames: string[];
  sourceRows: ContainerItemSourceRow[];
  validSkus: Set<string>;
  existingItems: ExistingContainerItemRow[];
  containerIdToName: Map<string, string>;
}

export interface ContainerItemSyncPlan {
  retainedItemIds: Map<string, Map<string, string>>;
  staleItemIds: string[];
}

/** Builds an idempotent per-container item plan from the positive quantities
 * in the sheet. One matching DB row is retained so its id and SKU memo survive;
 * missing, zero-quantity, and duplicate rows are removed. */
export function planContainerItemSync(input: PlanContainerItemSyncInput): ContainerItemSyncPlan {
  const desiredSkusByContainer = new Map<string, Set<string>>(
    input.containerNames.map((name) => [name, new Set<string>()]),
  );
  for (const row of input.sourceRows) {
    if (!input.validSkus.has(row.masterSku)) continue;
    for (const [containerName, qty] of Object.entries(row.qtys)) {
      if (qty > 0) desiredSkusByContainer.get(containerName)?.add(row.masterSku);
    }
  }

  const retainedItemIds = new Map<string, Map<string, string>>();
  const staleItemIds: string[] = [];
  for (const row of input.existingItems) {
    const containerName = input.containerIdToName.get(row.containerId);
    if (!containerName) continue;
    const desired = desiredSkusByContainer.get(containerName)?.has(row.masterSku) ?? false;
    if (!retainedItemIds.has(containerName)) retainedItemIds.set(containerName, new Map());
    const retainedForContainer = retainedItemIds.get(containerName)!;
    if (!desired || retainedForContainer.has(row.masterSku)) {
      staleItemIds.push(row.id);
    } else {
      retainedForContainer.set(row.masterSku, row.id);
    }
  }

  return { retainedItemIds, staleItemIds };
}
