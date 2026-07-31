import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  listGrouped: vi.fn(),
  listPaged: vi.fn(),
  findSkusByCode: vi.fn(),
  createMissingSkus: vi.fn(),
  upsertOrder: vi.fn(),
  upsertOrderItem: vi.fn(),
  withClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
};

const cacheDeleteMock = vi.fn();

vi.mock("@/lib/sales/repository", () => ({ SalesRepository: repositoryMock }));
vi.mock("@/lib/redis", () => ({ CacheManager: { delete: cacheDeleteMock } }));

const { SalesService } = await import("@/lib/sales/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SalesService.importRows", () => {
  it("throws ValidationError above 5000 rows", async () => {
    const rows = Array.from({ length: 5001 }, () => ({ sku_code: "X" }));
    await expect(SalesService.importRows(rows)).rejects.toThrow(ValidationError);
  });

  it("creates missing SKUs up front and reports them in the summary", async () => {
    repositoryMock.findSkusByCode.mockResolvedValue([]);
    repositoryMock.createMissingSkus.mockResolvedValue([{ id: "1", skuCode: "NEW-1" }]);
    repositoryMock.upsertOrder.mockResolvedValue("order-1");

    const result = await SalesService.importRows([
      { sku_code: "NEW-1", sale_date: "2026-01-01", quantity: "2", unit_price: "10" },
    ]);

    expect(result.createdSkus).toEqual(["NEW-1"]);
    expect(result.summary.skusCreated).toBe(1);
    expect(result.summary.imported).toBe(1);
    expect(cacheDeleteMock).toHaveBeenCalledWith("dashboard:analytics");
  });

  it("records a per-row failure without throwing when validation fails", async () => {
    repositoryMock.findSkusByCode.mockResolvedValue([{ id: "1", skuCode: "SKU-1" }]);

    const result = await SalesService.importRows([
      { sku_code: "SKU-1", sale_date: "not-a-date", quantity: "2", unit_price: "10" },
    ]);

    expect(result.summary.failed).toBe(1);
    expect(result.summary.imported).toBe(0);
    expect(result.results[0].success).toBe(false);
  });

  it("skips rows whose SKU could not be found or created", async () => {
    repositoryMock.findSkusByCode.mockResolvedValue([]);
    repositoryMock.createMissingSkus.mockResolvedValue([]);

    // sku creation failed silently (e.g. race) — skuSet never gets the code
    const result = await SalesService.importRows([
      { sku_code: "MISSING", sale_date: "2026-01-01", quantity: "2", unit_price: "10" },
    ]);

    expect(result.results[0].error).toContain('Failed to find or create SKU "MISSING"');
    expect(repositoryMock.upsertOrder).not.toHaveBeenCalled();
  });

  it("groups multiple line items under one upserted order by orderId", async () => {
    repositoryMock.findSkusByCode.mockResolvedValue([{ id: "1", skuCode: "SKU-1" }, { id: "2", skuCode: "SKU-2" }]);
    repositoryMock.upsertOrder.mockResolvedValue("order-1");

    await SalesService.importRows([
      { sku_code: "SKU-1", sale_date: "2026-01-01", quantity: "2", unit_price: "10", order_id: "ORD-1" },
      { sku_code: "SKU-2", sale_date: "2026-01-01", quantity: "1", unit_price: "5", order_id: "ORD-1" },
    ]);

    expect(repositoryMock.upsertOrder).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsertOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ totalAmount: 25 }));
    expect(repositoryMock.upsertOrderItem).toHaveBeenCalledTimes(2);
  });

  it("does not touch the DB or cache when there are zero valid records", async () => {
    repositoryMock.findSkusByCode.mockResolvedValue([]);
    await SalesService.importRows([{ sku_code: "", sale_date: "2026-01-01", quantity: "1", unit_price: "1" }]);
    expect(repositoryMock.withClient).not.toHaveBeenCalled();
    expect(cacheDeleteMock).not.toHaveBeenCalled();
  });
});
