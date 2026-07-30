import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

const { SkuRepository } = await import("@/lib/skus/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuRepository.resolveSortColumn", () => {
  it("maps known sort keys to their SQL column", () => {
    expect(SkuRepository.resolveSortColumn("available")).toBe("inv_available");
    expect(SkuRepository.resolveSortColumn("webSkuCount")).toBe("web_sku_count");
  });

  it("falls back to master_sku for unknown keys", () => {
    expect(SkuRepository.resolveSortColumn("nonsense")).toBe("p.master_sku");
  });
});

describe("SkuRepository.getCategories", () => {
  it("extracts the category column from the raw query result", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ category: "Seat Covers" }, { category: "Mats" }]);

    const categories = await SkuRepository.getCategories();

    expect(categories).toEqual(["Seat Covers", "Mats"]);
  });
});

describe("SkuRepository.countProducts", () => {
  it("coerces the bigint count to a number", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(42) }]);

    const total = await SkuRepository.countProducts(null, null);

    expect(total).toBe(42);
  });

  it("returns 0 when no row comes back", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const total = await SkuRepository.countProducts("%foo%", null);

    expect(total).toBe(0);
  });
});

describe("SkuRepository.getSalesQuantityByMasterSku", () => {
  it("skips the query entirely for an empty sku list", async () => {
    const result = await SkuRepository.getSalesQuantityByMasterSku([], new Date());

    expect(result.size).toBe(0);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("builds a master_sku -> quantity map", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ master_sku: "SKU-1", qty: "12" }]);

    const result = await SkuRepository.getSalesQuantityByMasterSku(["SKU-1"], new Date());

    expect(result.get("SKU-1")).toBe(12);
  });
});

describe("SkuRepository.getProductDetail", () => {
  it("returns null when no row matches", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const result = await SkuRepository.getProductDetail("missing-sku");

    expect(result).toBeNull();
  });

  it("returns the first row when found", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { master_sku: "SKU-1", product_name: "Test", category: "Seat Covers", status: "active" },
    ]);

    const result = await SkuRepository.getProductDetail("SKU-1");

    expect(result).toEqual({ master_sku: "SKU-1", product_name: "Test", category: "Seat Covers", status: "active" });
  });
});
