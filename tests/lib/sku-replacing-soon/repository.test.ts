import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const connectMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { SkuReplacingSoonRepository } = await import("@/lib/sku-replacing-soon/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuReplacingSoonRepository.list", () => {
  it("joins SKU Master and the own stats lane, and maps rows", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{
      master_sku: "SKU-1", target_inv_life_days: 30, replacement_sku: "SKU-2", note: null,
      product_name: "Seat Cover", category_code: "SC", sales_status: "Original",
      calculated_total_avg_curr: "1.5", updated_by: "Alice", updated_at: new Date("2026-11-11T00:00:00Z"),
    }] });

    const rows = await SkuReplacingSoonRepository.list();

    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("FROM shipcore.fc_sku_replacing_soon r");
    expect(sql).toContain("THEN sc.total_avg_curr ELSE s.total_avg_curr END");
    expect(rows).toEqual([{
      masterSku: "SKU-1", targetInvLifeDays: 30, replacementSku: "SKU-2", note: null,
      productName: "Seat Cover", categoryCode: "SC", salesStatus: "Original",
      calculatedTotalAvgCurr: 1.5, updatedBy: "Alice", updatedAt: "2026-11-11T00:00:00.000Z",
    }]);
  });
});

describe("SkuReplacingSoonRepository.upsert", () => {
  it("upserts on master_sku and reports whether the row was new", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ inserted: false }] });
    const created = await SkuReplacingSoonRepository.upsert(
      { masterSku: "SKU-1", targetInvLifeDays: 30, replacementSku: null, note: "n" }, "Alice",
    );
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (master_sku) DO UPDATE");
    expect(params).toEqual(["SKU-1", 30, null, "n", "Alice"]);
    expect(created).toBe(false);
  });
});

describe("SkuReplacingSoonRepository.deleteMany", () => {
  it("returns the SKUs that were actually deleted", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    await expect(SkuReplacingSoonRepository.deleteMany(["SKU-1", "SKU-2"])).resolves.toEqual(["SKU-1"]);
    expect(poolQueryMock.mock.calls[0][1]).toEqual([["SKU-1", "SKU-2"]]);
  });
});
