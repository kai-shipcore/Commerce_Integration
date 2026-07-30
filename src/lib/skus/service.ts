import { SkuRepository } from "@/lib/skus/repository";
import { getVariantNames } from "@/lib/db/supabase-lookup";
import { NotFoundError } from "@/lib/errors";

/**
 * Business logic for the SKU domain: normalizes raw Controller input
 * (pagination, sales-period window), shapes Repository rows into the API
 * response contract, and resolves the SKU detail view. No caching — this
 * mirrors the pre-refactor /api/skus behavior, which never cached either.
 */

const VALID_SALES_PERIODS = [30, 60, 90, 365];

export interface ListSkusQuery {
  page?: number;
  limit?: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  search: string;
  category: string;
  salesPeriodDays: number;
}

export function resolveSalesPeriodDays(rawValue: string | null): number {
  const parsed = parseInt(rawValue ?? "", 10);
  return VALID_SALES_PERIODS.includes(parsed) ? parsed : 30;
}

export const SkuService = {
  async listSkus(query: ListSkusQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const { sortBy, sortOrder, search, category, salesPeriodDays } = query;
    const offset = (page - 1) * limit;
    const sortOrderSql = sortOrder === "desc" ? "DESC" as const : "ASC" as const;
    const searchParam = search ? `%${search}%` : null;
    const categoryParam = category && category !== "all" ? category : null;
    const salesStartDate = new Date(Date.now() - salesPeriodDays * 24 * 60 * 60 * 1000);

    const [categories, total, rows] = await Promise.all([
      SkuRepository.getCategories(),
      SkuRepository.countProducts(searchParam, categoryParam),
      SkuRepository.listProducts({
        search: searchParam,
        category: categoryParam,
        sortBy,
        sortOrder: sortOrderSql,
        limit,
        offset,
      }),
    ]);

    const masterSkuCodes = rows.map((r) => r.master_sku);
    const salesMap = await SkuRepository.getSalesQuantityByMasterSku(masterSkuCodes, salesStartDate);

    const data = rows.map((row) => ({
      id: row.master_sku,
      masterSkuCode: row.master_sku,
      skuCode: row.master_sku,
      name: row.product_name,
      description: null,
      category: row.category ?? null,
      webSkuCount: Number(row.web_sku_count ?? 0),
      currentStock: Number(row.inv_available ?? 0),
      reorderPoint: null,
      unitCost: null,
      retailPrice: null,
      inventory: {
        onHand: Number(row.inv_on_hand ?? 0),
        reserved: Number(row.inv_reserved ?? 0),
        allocated: 0,
        backorder: Number(row.inv_backorder ?? 0),
        inbound: 0,
        available: Number(row.inv_available ?? 0),
      },
      _count: { salesRecords: salesMap.get(row.master_sku) || 0 },
      salesSummary: { totalQuantity: salesMap.get(row.master_sku) || 0, days: salesPeriodDays },
    }));

    return {
      data,
      categories,
      periods: { sales: salesPeriodDays },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async getSkuDetail(masterSku: string) {
    const product = await SkuRepository.getProductDetail(masterSku);
    if (!product) throw new NotFoundError("SKU not found");

    const [inventoryRows, mappingRows] = await Promise.all([
      SkuRepository.getInventoryByWarehouse(masterSku),
      SkuRepository.getChannelMappings(masterSku),
    ]);

    const [salesCount, variantNameMap] = await Promise.all([
      SkuRepository.countSalesForProduct(masterSku),
      getVariantNames(mappingRows.map((r) => r.channel_sku)).catch(() => new Map<string, string>()),
    ]);

    const inventory = {
      onHand: inventoryRows.reduce((s, r) => s + Number(r.on_hand_qty ?? 0), 0),
      available: inventoryRows.reduce((s, r) => s + Number(r.available_qty ?? 0), 0),
      backorder: inventoryRows.reduce((s, r) => s + Number(r.backorder_qty ?? 0), 0),
      reserved: inventoryRows.reduce((s, r) => s + Number(r.reserved_qty ?? 0), 0),
    };

    return {
      id: product.master_sku,
      masterSkuCode: product.master_sku,
      name: product.product_name,
      category: product.category,
      status: product.status,
      inventory,
      inventoryByWarehouse: inventoryRows.map((r) => ({
        warehouse: r.warehouse_code,
        onHand: Number(r.on_hand_qty ?? 0),
        available: Number(r.available_qty ?? 0),
        backorder: Number(r.backorder_qty ?? 0),
        reserved: Number(r.reserved_qty ?? 0),
      })),
      webSkus: mappingRows.map((r) => ({
        channelSku: r.channel_sku,
        channel: r.channel,
        productName: variantNameMap.get(r.channel_sku) ?? r.product_name ?? null,
      })),
      salesCount,
    };
  },
};
