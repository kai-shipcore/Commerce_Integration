import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedOrdersQuery } from "@/lib/orders/repository";

const RESOLVED: ResolvedOrdersQuery = {
  page: 1,
  limit: 20,
  search: "",
  platformSource: "all",
  orderStatus: "all",
  startDate: "",
  endDate: "",
  sortBy: "orderDate",
  sortOrder: "desc",
  exportAll: false,
  skipMeta: false,
};

const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const clientMock = { query: clientQueryMock, release: clientReleaseMock };

const poolQueryMock = vi.fn();
const poolConnectMock = vi.fn(async () => clientMock);
const poolMock = { query: poolQueryMock, connect: poolConnectMock };

vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => poolMock) }));

const { OrderRepository } = await import("@/lib/orders/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrderRepository.getOrderDetail", () => {
  it("returns null when no order matches the id", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // order query
      .mockResolvedValueOnce({ rows: [] }); // items query

    const result = await OrderRepository.getOrderDetail(999);

    expect(result).toBeNull();
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("computes subtotal/shipping/tax from line items", async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            platform_source: "shopify",
            external_order_id: "ext-1",
            order_number: "#1001",
            order_date: null,
            order_date_display: "2026-01-01T00:00:00.000Z",
            order_status: "open",
            total_price: "115",
            currency: "USD",
            financial_status: "paid",
            buyer_email: "a@b.com",
            shipping_country: "US",
            fulfillment_channel: "manual",
            sales_channel: "web",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            order_id: 1,
            external_line_item_id: "li-1",
            sku: "SKU-1",
            master_sku: "SKU-1",
            product_name: "Test Item",
            quantity: 2,
            unit_price: "50",
            currency: "USD",
            shipping_price: "5",
            item_status: "active",
            item_tax: "0",
            refunded_quantity: 0,
            net_quantity: 2,
            fulfilled_quantity: 2,
            fulfillment_status: "fulfilled",
          },
        ],
      });

    const result = await OrderRepository.getOrderDetail(1);

    expect(result).not.toBeNull();
    expect(result?.subtotalPrice).toBe(100); // 50 * 2
    expect(result?.shippingPrice).toBe(5);
    // itemTax was 0, so tax is inferred: 115 - 100 - 5 = 10
    expect(result?.taxPrice).toBe(10);
    expect(result?.lineItems).toHaveLength(1);
  });
});

describe("OrderRepository.queryOrders", () => {
  it("throws when the lookup pool is unavailable", async () => {
    const { getLookupPool } = await import("@/lib/db/supabase-lookup");
    vi.mocked(getLookupPool).mockReturnValueOnce(null);

    await expect(OrderRepository.queryOrders(RESOLVED)).rejects.toThrow(
      "No lookup database connection configured"
    );
  });

  it("shapes rows, summary, and meta for an unfiltered page", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ total_orders: "1", total_revenue: "100", total_platforms: "1" }] }) // summary
      .mockResolvedValueOnce({ rows: [{ platform_source: "shopify" }] }) // meta: platform sources
      .mockResolvedValueOnce({ rows: [{ order_status: "open" }] }); // meta: order statuses

    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            platform_source: "shopify",
            external_order_id: "ext-1",
            order_number: "#1001",
            order_date: null,
            order_date_display: "2026-01-01T00:00:00.000Z",
            order_status: "open",
            total_price: "100",
            currency: "USD",
            financial_status: "paid",
            buyer_email: "a@b.com",
            shipping_country: "US",
            sales_channel: "web",
          },
        ],
      }) // main order query
      .mockResolvedValueOnce({ rows: [{ order_id: 1, line_count: "1", unit_count: "2", order_skus: ["SKU-1"], master_skus: ["SKU-1"] }] }); // resolveOrderItemData

    const result = await OrderRepository.queryOrders(RESOLVED);

    expect(result.totalRows).toBe(1);
    expect(result.platformSources).toEqual(["shopify"]);
    expect(result.orderStatuses).toEqual(["open"]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: 1,
        orderNumber: "#1001",
        totalPrice: 100,
        lineCount: 1,
        unitCount: 2,
        masterSku: "SKU-1",
        masterSkuCount: 1,
      }),
    ]);
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("skips the meta queries when skipMeta is set", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ total_orders: "0", total_revenue: "0", total_platforms: "0" }] });
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await OrderRepository.queryOrders({ ...RESOLVED, skipMeta: true });

    expect(result.platformSources).toEqual([]);
    expect(result.orderStatuses).toEqual([]);
    // only the summary query goes through pool.query when meta is skipped
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });
});
