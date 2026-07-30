import { CacheManager } from "@/lib/redis";
import {
  InventoryRepository,
  INVENTORY_SORT_KEYS,
  type InventoryQueryOptions,
  type InventoryQueryResult,
  type InventorySortBy,
  type ResolvedInventoryQuery,
} from "@/lib/inventory/repository";

const CACHE_TTL_SECONDS = 120;

/**
 * Business logic for the Coverland inventory feed: turns raw Controller
 * input into a fully-resolved query (defaults, clamping, sort-key
 * validation), then orchestrates the cache-aside read through
 * InventoryRepository.
 */
export const InventoryService = {
  resolveQuery(options: InventoryQueryOptions = {}): ResolvedInventoryQuery {
    const page = Math.max(1, options.page ?? 1);
    const exportAll = Boolean(options.exportAll);
    const limit = exportAll
      ? Math.max(1, Math.min(100000, options.limit ?? 100000))
      : Math.max(1, Math.min(200, options.limit ?? 20));
    const offset = (page - 1) * limit;
    const search = options.search?.trim() ?? "";
    const warehouse = options.warehouse?.trim() ?? "";
    const groupBy = options.groupBy ?? "warehouse";

    const requestedSortBy: InventorySortBy =
      options.sortBy && INVENTORY_SORT_KEYS.includes(options.sortBy) ? options.sortBy : "masterSku";
    const sortBy =
      groupBy === "product" && requestedSortBy === "warehouse"
        ? "masterSku"
        : groupBy !== "product" && requestedSortBy === "warehouseCount"
          ? "masterSku"
          : requestedSortBy;
    const sortOrder = options.sortOrder === "desc" ? "desc" : "asc";

    return { page, limit, offset, exportAll, search, warehouse, groupBy, sortBy, sortOrder };
  },

  async getInventory(options: InventoryQueryOptions = {}): Promise<InventoryQueryResult> {
    const resolved = this.resolveQuery(options);
    const cacheKey = `inventory:v3:${resolved.groupBy}:${resolved.page}:${resolved.limit}:${resolved.sortBy}:${resolved.sortOrder}:${resolved.search}:${resolved.warehouse}`;

    if (!resolved.exportAll) {
      const cached = await CacheManager.get<InventoryQueryResult>(cacheKey);
      if (cached) return cached;
    }

    const result = await InventoryRepository.queryCoverlandInventory(resolved);

    if (!resolved.exportAll) {
      await CacheManager.set(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return result;
  },
};
