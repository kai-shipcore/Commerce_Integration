import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  findBySku: vi.fn(),
  countProducts: vi.fn(),
  listProducts: vi.fn(),
  getDistinctMasterSkusFromInventory: vi.fn(),
  upsertProductsFromSync: vi.fn(),
  updateProduct: vi.fn(),
  findExistingValuesBySkus: vi.fn(),
  applyExcelImport: vi.fn(),
  deactivateProduct: vi.fn(),
};

const logAuditMock = vi.fn();
const authMock = vi.fn();

vi.mock("@/lib/sku-master/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sku-master/repository")>("@/lib/sku-master/repository");
  return { ...actual, SkuMasterRepository: repositoryMock };
});
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const { SkuMasterService } = await import("@/lib/sku-master/service");

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", name: "Tester", email: "t@example.com" } });
});

describe("SkuMasterService.getProduct", () => {
  it("throws NotFoundError when the SKU doesn't exist", async () => {
    repositoryMock.findBySku.mockResolvedValue(null);
    await expect(SkuMasterService.getProduct("MISSING")).rejects.toThrow(NotFoundError);
  });

  it("shapes the row, falling back to inferred defaults for unset fields", async () => {
    repositoryMock.findBySku.mockResolvedValue({
      master_sku: "CA-FM-01",
      product_name: "Floor Mat",
      category: null,
      category_code: null,
      status: "active",
      sales_status: null,
      original_or_custom: "Original",
      moq: null,
      order_multiple: null,
      cbm_per_unit: null,
      case_qty: null,
      weight_kg: null,
    });

    const result = await SkuMasterService.getProduct("CA-FM-01");

    expect(result.productKey).toBe("fm");
    expect(result.moq).toBe(5); // inferred default for fm
    // orderMultiple intentionally falls back to inferred.moq, not a separate value
    expect(result.orderMultiple).toBe(5);
    expect(result.cbmPerUnit).toBe(0.125);
  });
});

describe("SkuMasterService.listProducts", () => {
  const baseQuery = { search: "", product: "", status: "active", masterSku: "", page: 1, limit: 50, salesType: "all", type: "all" };

  it("rejects an invalid status filter", async () => {
    await expect(SkuMasterService.listProducts({ ...baseQuery, status: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid salesType filter", async () => {
    await expect(SkuMasterService.listProducts({ ...baseQuery, salesType: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("accepts Part as a sales type and passes it through to the repository", async () => {
    repositoryMock.countProducts.mockResolvedValue(0);
    repositoryMock.listProducts.mockResolvedValue([]);

    await SkuMasterService.listProducts({ ...baseQuery, salesType: "Part" });

    expect(repositoryMock.listProducts.mock.calls[0][0]).toMatchObject({ salesType: "Part" });
  });

  it("rejects an invalid type filter", async () => {
    await expect(SkuMasterService.listProducts({ ...baseQuery, type: "bogus" })).rejects.toThrow(ValidationError);
  });

  it("clamps limit to a 20-200 range and parses the product CSV", async () => {
    repositoryMock.countProducts.mockResolvedValue(0);
    repositoryMock.listProducts.mockResolvedValue([]);

    await SkuMasterService.listProducts({ ...baseQuery, limit: 999, product: "cc, sc ," });

    const resolvedArg = repositoryMock.countProducts.mock.calls[0][0];
    expect(resolvedArg.limit).toBe(200);
    expect(resolvedArg.productValues).toEqual(["cc", "sc"]);
  });

  it("returns shaped rows with pagination", async () => {
    repositoryMock.countProducts.mockResolvedValue(1);
    repositoryMock.listProducts.mockResolvedValue([
      { master_sku: "CA-SC-1", product_name: "Seat Cover", category: "Seat Cover", category_code: "SC", status: "active", sales_status: null, original_or_custom: "Original", moq: 5, order_multiple: 5, cbm_per_unit: "0.048", case_qty: 1, weight_kg: "0.9" },
    ]);

    const result = await SkuMasterService.listProducts(baseQuery);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].masterSku).toBe("CA-SC-1");
    expect(result.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
  });
});

describe("SkuMasterService.syncFromInventory", () => {
  it("pulls distinct skus from inventory and upserts them", async () => {
    repositoryMock.getDistinctMasterSkusFromInventory.mockResolvedValue({ sourceRowCount: 10, masterSkus: ["A", "B"] });
    repositoryMock.upsertProductsFromSync.mockResolvedValue({ upserted: 2 });

    const result = await SkuMasterService.syncFromInventory();

    expect(repositoryMock.upsertProductsFromSync).toHaveBeenCalledWith(["A", "B"]);
    expect(result).toEqual({ sourceRows: 10, upserted: 2 });
  });
});

describe("SkuMasterService.updateProduct", () => {
  it("throws ValidationError when masterSku is missing", async () => {
    await expect(SkuMasterService.updateProduct({ masterSku: "" } as never, null)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError for an invalid salesStatus", async () => {
    await expect(
      SkuMasterService.updateProduct({ masterSku: "SKU-1", salesStatus: "bogus" } as never, null)
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError for an invalid status", async () => {
    await expect(
      SkuMasterService.updateProduct({ masterSku: "SKU-1", status: "bogus" } as never, null)
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when the repository finds no matching row", async () => {
    repositoryMock.updateProduct.mockResolvedValue(false);
    await expect(SkuMasterService.updateProduct({ masterSku: "SKU-1" } as never, null)).rejects.toThrow(NotFoundError);
  });

  it("clamps numeric fields, updates, and logs an audit entry", async () => {
    repositoryMock.updateProduct.mockResolvedValue(true);

    await SkuMasterService.updateProduct(
      { masterSku: "SKU-1", moq: -5, orderMultiple: 0, cbmPerUnit: 0, weightKg: -1, caseQty: 0, status: "ACTIVE" } as never,
      "1.2.3.4"
    );

    expect(repositoryMock.updateProduct).toHaveBeenCalledWith("SKU-1", expect.objectContaining({
      moq: 1, orderMultiple: 1, caseQty: 1, weightKg: 0, cbmPerUnit: 0.000001, status: "active",
    }));
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: "SKU-1", action: "update", ip: "1.2.3.4" }));
  });

  it("logs a delete action when status is set to inactive", async () => {
    repositoryMock.updateProduct.mockResolvedValue(true);

    await SkuMasterService.updateProduct({ masterSku: "SKU-1", status: "inactive" } as never, null);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });
});

describe("SkuMasterService excel import", () => {
  it("throws ValidationError when no rows are valid", async () => {
    await expect(SkuMasterService.previewExcelImport([{ masterSku: "" }])).rejects.toThrow(ValidationError);
    await expect(SkuMasterService.applyExcelImport([])).rejects.toThrow(ValidationError);
  });

  it("previews an insert for a brand-new SKU", async () => {
    repositoryMock.findExistingValuesBySkus.mockResolvedValue(new Map());

    const result = await SkuMasterService.previewExcelImport([{ masterSku: "ca-fm-99", moq: 10 }]);

    expect(result.summary).toEqual({ insert: 1, update: 0, unchanged: 0 });
    expect(result.rows[0]).toMatchObject({ masterSku: "CA-FM-99", action: "insert" });
  });

  it("previews unchanged when imported values match the existing row", async () => {
    repositoryMock.findExistingValuesBySkus.mockResolvedValue(
      new Map([["CA-FM-99", { cbmPerUnit: 0.1, moq: 10, orderMultiple: 10 }]])
    );

    const result = await SkuMasterService.previewExcelImport([{ masterSku: "ca-fm-99", moq: 10 }]);

    expect(result.rows[0]).toMatchObject({ action: "unchanged", changedFields: [] });
  });

  it("applies the import via the repository", async () => {
    repositoryMock.applyExcelImport.mockResolvedValue({ updated: 1, inserted: 2 });

    const result = await SkuMasterService.applyExcelImport([{ masterSku: "ca-fm-99", moq: 10 }]);

    expect(result).toEqual({ imported: 1, upserted: 3, updated: 1, inserted: 2 });
  });
});

describe("SkuMasterService.deactivateProduct", () => {
  it("throws ValidationError when masterSku is empty", async () => {
    await expect(SkuMasterService.deactivateProduct("", null)).rejects.toThrow(ValidationError);
  });

  it("deactivates and logs an audit entry", async () => {
    await SkuMasterService.deactivateProduct("SKU-1", "9.9.9.9");

    expect(repositoryMock.deactivateProduct).toHaveBeenCalledWith("SKU-1");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", entityId: "SKU-1", ip: "9.9.9.9" }));
  });
});
