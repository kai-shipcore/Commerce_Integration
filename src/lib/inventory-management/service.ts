/**
 * Inventory Management: every SKU in SKU Master, active or not, with its stock
 * split by warehouse.
 *
 * Demand Planning shows active SKUs only, and some of its stock figures come
 * from another SKU. This page is where the planning team sees the rest, mainly
 * to manage TBD and Discontinued SKUs, and where each such figure says which
 * SKU it came from.
 *
 * Two rules move stock between SKUs on Demand Planning, and they are shown
 * differently here because they behave differently there:
 *
 *  - **Fixed merges** (`MASTER_SKU_REMAP` in `planning/master-sku.ts`). The
 *    source SKU has no row of its own anywhere, so its stock IS in this row's
 *    numbers, and `mergedFrom` lists it.
 *  - **Final car cover SKU** (TN to TNS, BKGR to BKLG). Demand Planning adds
 *    the old SKU's stock onto the new SKU's row, but the old SKU keeps its own
 *    row. Here each row shows its own stock only, so the same units are not
 *    listed twice; `demandPlanningAddsFrom` says what Demand Planning adds.
 *    As on Demand Planning, it applies only when both SKUs are Active.
 */

import { inventoryMasterSku, toFinalMasterSku } from "@/lib/planning/master-sku";
import { isCarCoverSku } from "@/lib/planning/sku-format";
import { SkuMasterRepository, type ProductRow } from "@/lib/sku-master/repository";
import {
  InventoryManagementRepository,
  type WarehouseStockRow,
} from "@/lib/inventory-management/repository";

/** The warehouses that get their own column, in display order. Anything else
 *  the feed names lands in `other`, so no stock is dropped. */
export const INVENTORY_WAREHOUSES = [
  { key: "fullerton", name: "Fullerton", region: "West" },
  { key: "canary", name: "Canary", region: "West" },
  { key: "dreamTrans", name: "Dream Trans", region: "West" },
  { key: "linkone", name: "Linkone", region: "West" },
  { key: "ttm", name: "TTM Group", region: "East" },
  { key: "ttmJefferson", name: "TTM Group Jefferson", region: "East" },
] as const;

export type InventoryWarehouseKey = (typeof INVENTORY_WAREHOUSES)[number]["key"] | "other";

export interface StockQty {
  onHand: number;
  available: number;
}

export type StockByWarehouse = Record<InventoryWarehouseKey, StockQty>;

export interface StockSource {
  sku: string;
  total: StockQty;
  warehouses: StockByWarehouse;
}

export interface InventoryManagementRow {
  masterSku: string;
  productName: string | null;
  /** Product type: CC, SC, FM, SWC, AC. */
  categoryCode: string | null;
  category: string | null;
  /** SKU Master status: active or inactive. */
  status: string;
  /** Hold / Discontinued / TBD, or null when the SKU is in production. */
  salesStatus: string | null;
  /** Original / Custom / Part. */
  originalOrCustom: string;
  warehouses: StockByWarehouse;
  total: StockQty;
  /** Stock included in this row's numbers that sits under another SKU. */
  mergedFrom: StockSource[];
  /** Stock Demand Planning adds onto this row from another SKU's own row.
   *  Not included in this row's numbers. */
  demandPlanningAddsFrom: StockSource[];
  /**
   * Warehouses whose figure ShipHero's daily update no longer writes, with the
   * day it was last written (`YYYY-MM-DD`). The product is inactive in ShipHero
   * or gone from it; the quantity is what it held that day. Empty for a SKU
   * ShipHero still updates. Separate from `status`, which is SKU Master's.
   */
  notUpdatedByShipHero: Partial<Record<InventoryWarehouseKey, string>>;
}

export interface InventoryManagementData {
  rows: InventoryManagementRow[];
  /** False when the warehouse feed could not be read: rows carry zeros. */
  stockAvailable: boolean;
}

const WAREHOUSE_KEY_BY_NAME = new Map<string, InventoryWarehouseKey>(
  INVENTORY_WAREHOUSES.map((warehouse) => [warehouse.name.toLowerCase(), warehouse.key]),
);

function emptyStock(): StockByWarehouse {
  const stock = { other: { onHand: 0, available: 0 } } as StockByWarehouse;
  for (const warehouse of INVENTORY_WAREHOUSES) stock[warehouse.key] = { onHand: 0, available: 0 };
  return stock;
}

function addStock(into: StockByWarehouse, from: StockByWarehouse): void {
  for (const key of Object.keys(into) as InventoryWarehouseKey[]) {
    into[key].onHand += from[key].onHand;
    into[key].available += from[key].available;
  }
}

function totalOf(stock: StockByWarehouse): StockQty {
  const total = { onHand: 0, available: 0 };
  for (const qty of Object.values(stock)) {
    total.onHand += qty.onHand;
    total.available += qty.available;
  }
  return total;
}

function hasStock(qty: StockQty): boolean {
  return qty.onHand !== 0 || qty.available !== 0;
}

/**
 * Joins SKU Master rows with warehouse stock and applies the two stock rules.
 * Pure, so the rules can be tested without either database.
 */
export function buildInventoryRows(
  products: ProductRow[],
  stockRows: WarehouseStockRow[],
): InventoryManagementRow[] {
  // Stock under each SKU exactly as the warehouse feed names it.
  const ownStock = new Map<string, StockByWarehouse>();
  // Per SKU, the warehouses ShipHero stopped updating and since when. When
  // several feed rows land in one column (Other), the oldest date is kept.
  const staleSince = new Map<string, Partial<Record<InventoryWarehouseKey, string>>>();
  for (const row of stockRows) {
    let stock = ownStock.get(row.master_sku);
    if (!stock) {
      stock = emptyStock();
      ownStock.set(row.master_sku, stock);
    }
    const key = WAREHOUSE_KEY_BY_NAME.get(row.warehouse.toLowerCase()) ?? "other";
    stock[key].onHand += row.on_hand;
    stock[key].available += row.available;
    if (row.stale) {
      const since = staleSince.get(row.master_sku) ?? {};
      const day = row.last_updated ?? "";
      if (since[key] === undefined || day < since[key]) since[key] = day;
      staleSince.set(row.master_sku, since);
    }
  }

  // Fixed merges: a source SKU's stock is counted under its target.
  const mergedSources = new Map<string, StockSource[]>();
  for (const [sku, stock] of ownStock) {
    const target = inventoryMasterSku(sku);
    if (target === sku) continue;
    const total = totalOf(stock);
    if (!hasStock(total)) continue;
    const sources = mergedSources.get(target) ?? [];
    sources.push({ sku, total, warehouses: stock });
    mergedSources.set(target, sources);
  }

  const activeSkus = new Set(
    products.filter((product) => product.status === "active").map((product) => product.master_sku),
  );

  // Final car cover SKU: what Demand Planning adds onto the new SKU's row.
  const rollupSources = new Map<string, StockSource[]>();
  for (const product of products) {
    const sku = product.master_sku;
    if (!activeSkus.has(sku) || !isCarCoverSku(sku)) continue;
    const finalSku = toFinalMasterSku(sku);
    if (finalSku === sku || !activeSkus.has(finalSku)) continue;
    // What Demand Planning holds for the old SKU: its own stock plus anything
    // merged into it.
    const stock = emptyStock();
    const own = ownStock.get(sku);
    if (own) addStock(stock, own);
    for (const source of mergedSources.get(sku) ?? []) addStock(stock, source.warehouses);
    const total = totalOf(stock);
    if (!hasStock(total)) continue;
    const sources = rollupSources.get(finalSku) ?? [];
    sources.push({ sku, total, warehouses: stock });
    rollupSources.set(finalSku, sources);
  }

  return products.map((product) => {
    const sku = product.master_sku;
    const mergedFrom = mergedSources.get(sku) ?? [];
    const warehouses = emptyStock();
    // A SKU that is itself merged into another keeps no stock of its own on
    // Demand Planning, and so shows none here: its units are on the target row.
    const own = inventoryMasterSku(sku) === sku ? ownStock.get(sku) : undefined;
    if (own) addStock(warehouses, own);
    for (const source of mergedFrom) addStock(warehouses, source.warehouses);

    // The row's own warehouses, plus those of any SKU merged into it.
    const notUpdatedByShipHero: Partial<Record<InventoryWarehouseKey, string>> = {
      ...(own ? staleSince.get(sku) : undefined),
    };
    for (const source of mergedFrom) {
      for (const [key, day] of Object.entries(staleSince.get(source.sku) ?? {}) as Array<[InventoryWarehouseKey, string]>) {
        if (notUpdatedByShipHero[key] === undefined) notUpdatedByShipHero[key] = day;
      }
    }

    return {
      masterSku: sku,
      productName: product.product_name || null,
      categoryCode: product.category_code,
      category: product.category,
      status: product.status,
      salesStatus: product.sales_status,
      originalOrCustom: product.original_or_custom,
      warehouses,
      total: totalOf(warehouses),
      mergedFrom,
      demandPlanningAddsFrom: rollupSources.get(sku) ?? [],
      notUpdatedByShipHero,
    };
  });
}

/** Every SKU Master row in one read. The page filters and pages on the client. */
const ALL_PRODUCTS_LIMIT = 200_000;

export const InventoryManagementService = {
  async list(): Promise<InventoryManagementData> {
    const [products, stockRows] = await Promise.all([
      SkuMasterRepository.listProducts({
        page: 1,
        limit: ALL_PRODUCTS_LIMIT,
        offset: 0,
        search: "",
        productValues: [],
        status: "all",
        salesType: "all",
        typeFilter: "all",
        floorMatTypeFilter: "all",
      }),
      // The page is still useful without stock (status review), so a feed
      // outage degrades to zeros and a notice rather than failing the page.
      InventoryManagementRepository.getStockBySkuAndWarehouse().catch(() => null),
    ]);

    return {
      rows: buildInventoryRows(products, stockRows ?? []),
      stockAvailable: stockRows !== null,
    };
  },
};
