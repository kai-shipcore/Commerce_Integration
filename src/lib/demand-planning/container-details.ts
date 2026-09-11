import type { ContainerCategoryRow, ContainerHeaderRow, CrossRow } from "./repository";
import type { ContainerMeta, ContainerRowData } from "@/types/demand-planning";

// Shared by the full dashboard and its lightweight detail read.
// Preserve ordering, nulls, and the existing last-row-wins duplicate behavior.
export function mapContainerDetails(
  containersResult: ContainerHeaderRow[],
  categoriesResult: ContainerCategoryRow[],
  crossResult: CrossRow[],
  todayStr: string,
) {
  const categoriesByContainer = new Map<number, string[]>();
  for (const row of categoriesResult) {
    const arr = categoriesByContainer.get(row.container_id) ?? [];
    arr.push(row.category_code);
    categoriesByContainer.set(row.container_id, arr);
  }

  const containers: ContainerMeta[] = [
    { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" },
    ...containersResult.map((r, i) => ({
      col: i + 1,
      container_id: r.id,
      name: r.name,
      eta: r.eta,
      cbm_cap: r.cbm_cap ?? 0,
      status: r.status,
      categories: categoriesByContainer.get(r.id) ?? [],
    })),
  ];

  containers[0] = { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" };
  const orderedContainers = containers.slice(1).sort((a, b) => {
    const aTime = a.eta ? new Date(a.eta).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.eta ? new Date(b.eta).getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.name.localeCompare(b.name);
  });
  containers.splice(1, containers.length - 1, ...orderedContainers.map((container, i) => ({
    ...container,
    col: i + 1,
  })));

  const crossMap = new Map<string, Map<string, ContainerRowData>>();
  for (const r of crossResult) {
    if (!crossMap.has(r.sku)) crossMap.set(r.sku, new Map());
    crossMap.get(r.sku)!.set(r.container_name, {
      item_id: r.item_id,
      cbm_unit: r.cbm_unit,
      inbound_qty: r.inbound_qty,
      allocated_remaining_qty: r.allocated_remaining_qty ?? 0,
      open_orders: r.open_orders,
      avail_qty: r.avail_qty,
      est_sales: r.est_sales,
      backorder: r.backorder,
      eta: r.eta,
      inv_life: r.inv_life,
      est_sod: r.est_sod,
      plan_sod: r.plan_sod,
      cbm: r.cbm,
    });
  }

  return { containers, crossMap };
}
