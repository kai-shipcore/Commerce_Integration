import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/lib/errors";

const repositoryMock = {
  getCategories: vi.fn(),
  countProducts: vi.fn(),
  listProducts: vi.fn(),
  getSalesQuantityByMasterSku: vi.fn(),
  getProductDetail: vi.fn(),
  getInventoryByWarehouse: vi.fn(),
  getChannelMappings: vi.fn(),
  countSalesForProduct: vi.fn(),
};

vi.mock("@/lib/skus/repository", () => ({ SkuRepository: repositoryMock }));
vi.mock("@/lib/db/supabase-lookup", () => ({ getVariantNames: vi.fn().mockResolvedValue(new Map()) }));

const { SkuService, resolveSalesPeriodDays } = await import("@/lib/skus/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSalesPeriodDays", () => {
  it("accepts valid periods", () => {
    expect(resolveSalesPeriodDays("90")).toBe(90);
  });

  it("falls back to 30 for invalid or missing values", () => {
    expect(resolveSalesPeriodDays("7")).toBe(30);
    expect(resolveSalesPeriodDays(null)).toBe(30);
  });
});

describe("SkuService.listSkus", () => {
  it("shapes rows into the response envelope with pagination and sales summary", async () => {
    repositoryMock.getCategories.mockResolvedValue(["Seat Covers"]);
    repositoryMock.countProducts.mockResolvedValue(1);
    repositoryMock.listProducts.mockResolvedValue([
      {
        master_sku: "SKU-1",
        product_name: "Test",
        category: "Seat Covers",
        web_sku_count: BigInt(2),
        inv_on_hand: "10",
        inv_available: "8",
        inv_backorder: "0",
        inv_reserved: "2",
      },
    ]);
    repositoryMock.getSalesQuantityByMasterSku.mockResolvedValue(new Map([["SKU-1", 5]]));

    const result = await SkuService.listSkus({
      page: 1,
      limit: 50,
      sortBy: "masterSkuCode",
      sortOrder: "asc",
      search: "",
      category: "",
      salesPeriodDays: 30,
    });

    expect(result.data).toEqual([
      expect.objectContaining({
        masterSkuCode: "SKU-1",
        currentStock: 8,
        webSkuCount: 2,
        salesSummary: { totalQuantity: 5, days: 30 },
      }),
    ]);
    expect(result.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
  });

  it("clamps out-of-range page/limit values", async () => {
    repositoryMock.getCategories.mockResolvedValue([]);
    repositoryMock.countProducts.mockResolvedValue(0);
    repositoryMock.listProducts.mockResolvedValue([]);
    repositoryMock.getSalesQuantityByMasterSku.mockResolvedValue(new Map());

    const result = await SkuService.listSkus({
      page: -5,
      limit: 999,
      sortBy: "masterSkuCode",
      sortOrder: "asc",
      search: "",
      category: "",
      salesPeriodDays: 30,
    });

    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(200);
  });
});

describe("SkuService.getSkuDetail", () => {
  it("throws NotFoundError when the product does not exist", async () => {
    repositoryMock.getProductDetail.mockResolvedValue(null);

    await expect(SkuService.getSkuDetail("missing-sku")).rejects.toThrow(NotFoundError);
  });

  it("aggregates inventory across warehouses", async () => {
    repositoryMock.getProductDetail.mockResolvedValue({
      master_sku: "SKU-1",
      product_name: "Test",
      category: "Seat Covers",
      status: "active",
    });
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([
      { warehouse_code: "WH1", on_hand_qty: "5", available_qty: "3", backorder_qty: "0", reserved_qty: "2" },
      { warehouse_code: "WH2", on_hand_qty: "7", available_qty: "7", backorder_qty: "1", reserved_qty: "0" },
    ]);
    repositoryMock.getChannelMappings.mockResolvedValue([]);
    repositoryMock.countSalesForProduct.mockResolvedValue(9);

    const result = await SkuService.getSkuDetail("SKU-1");

    expect(result.inventory).toEqual({ onHand: 12, available: 10, backorder: 1, reserved: 2 });
    expect(result.salesCount).toBe(9);
  });
});
