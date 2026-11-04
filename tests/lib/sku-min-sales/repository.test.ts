import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const connectMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { SkuMinSalesRepository } = await import("@/lib/sku-min-sales/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuMinSalesRepository.list", () => {
  it("reads the calculated value from the own stats lane of each SKU and maps rows", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{
      master_sku: "SKU-1", min_total_avg_curr: "3", note: null, product_name: "Seat Cover",
      category_code: "SC", calculated_total_avg_curr: "1.5", total_avg_curr_override: null,
      updated_by: "Alice", updated_at: new Date("2026-11-03T00:00:00Z"),
    }] });

    const rows = await SkuMinSalesRepository.list();

    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("p.category_code IN ('CC', 'FM', 'SWC')");
    expect(sql).toContain("THEN sc.total_avg_curr ELSE s.total_avg_curr END");
    expect(rows).toEqual([{
      masterSku: "SKU-1", minTotalAvgCurr: 3, note: null, productName: "Seat Cover", categoryCode: "SC",
      calculatedTotalAvgCurr: 1.5, totalAvgCurrOverride: null, updatedBy: "Alice", updatedAt: "2026-11-03T00:00:00.000Z",
    }]);
  });
});

describe("SkuMinSalesRepository.upsert", () => {
  it("upserts on master_sku and reports whether the row was new", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ inserted: true }] });
    const created = await SkuMinSalesRepository.upsert({ masterSku: "SKU-1", minTotalAvgCurr: 2, note: "n" }, "Alice");
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (master_sku) DO UPDATE");
    expect(params).toEqual(["SKU-1", 2, "n", "Alice"]);
    expect(created).toBe(true);
  });
});

describe("SkuMinSalesRepository.deleteMany", () => {
  it("returns the SKUs that were actually deleted", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    await expect(SkuMinSalesRepository.deleteMany(["SKU-1", "SKU-2"])).resolves.toEqual(["SKU-1"]);
    expect(poolQueryMock.mock.calls[0][1]).toEqual([["SKU-1", "SKU-2"]]);
  });
});
