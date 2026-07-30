import { CacheManager } from "@/lib/redis";
import {
  OrderRepository,
  ORDERS_SORT_KEYS,
  type SalesOrdersQueryOptions,
  type SalesOrdersQueryResult,
  type SalesOrderDetail,
} from "@/lib/orders/repository";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Business logic for sales orders: normalizes raw Controller input
 * (pagination, filters, sort-key validation) into a fully-resolved query,
 * then orchestrates the cache-aside read through OrderRepository. Order
 * detail lookups validate the id and translate a missing row into
 * NotFoundError.
 */

const CACHE_TTL_SECONDS = 120;

export const OrderService = {
  async listOrders(options: SalesOrdersQueryOptions): Promise<SalesOrdersQueryResult> {
    const page = Math.max(1, options.page ?? 1);
    const limit = options.exportAll
      ? Math.max(1, Math.min(100000, options.limit ?? 100000))
      : Math.max(1, Math.min(200, options.limit ?? 20));
    const search = options.search?.trim() ?? "";
    const platformSource = options.platformSource?.trim() ?? "all";
    const orderStatus = options.orderStatus?.trim() ?? "all";
    const startDate = options.startDate?.trim() ?? "";
    const endDate = options.endDate?.trim() ?? "";
    const sortBy = options.sortBy && ORDERS_SORT_KEYS.includes(options.sortBy) ? options.sortBy : "orderDate";
    const sortOrder = options.sortOrder === "asc" ? "asc" : "desc";

    // v4: cached value shape changed from the full `{ success, data, ... }` envelope
    // (previously cached in the route handler) to the bare repository result
    // (now cached here in the service). Bumped so stale v3 entries can't be
    // misread as the new shape.
    const cacheKey = `orders:v4:${page}:${limit}:${sortBy}:${sortOrder}:${search}:${platformSource}:${orderStatus}:${startDate}:${endDate}`;

    if (!options.exportAll) {
      const cached = await CacheManager.get<SalesOrdersQueryResult>(cacheKey);
      if (cached) return cached;
    }

    const result = await OrderRepository.queryOrders({
      page,
      limit,
      search,
      platformSource,
      orderStatus,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      exportAll: Boolean(options.exportAll),
      skipMeta: Boolean(options.skipMeta),
    });

    if (!options.exportAll) {
      await CacheManager.set(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return result;
  },

  async getOrderDetail(rawId: string): Promise<SalesOrderDetail> {
    const orderId = Number(rawId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new ValidationError("Invalid order id");
    }

    const order = await OrderRepository.getOrderDetail(orderId);
    if (!order) throw new NotFoundError("Order not found");

    return order;
  },
};
