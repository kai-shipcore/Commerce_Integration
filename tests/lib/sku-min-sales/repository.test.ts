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
      master_sku: "SKU-1", min_total_avg_curr: "3", reference_sku: "SKU-2", reference_pct: "30", note: null, product_name: "Seat Cover",
      category_code: "SC", calculated_total_avg_curr: "1.5", total_avg_curr_override: null,
      updated_by: "Alice", updated_at: new Date("2026-11-03T00:00:00Z"),
    }] });

    const rows = await SkuMinSalesRepository.list();

    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("p.category_code IN ('CC', 'FM', 'SWC')");
    expect(sql).toContain("THEN sc.total_avg_curr ELSE s.total_avg_curr END");
    expect(rows).toEqual([{
      masterSku: "SKU-1", minTotalAvgCurr: 3, referenceSku: "SKU-2", referencePct: 30,
      note: null, productName: "Seat Cover", categoryCode: "SC",
      calculatedTotalAvgCurr: 1.5, totalAvgCurrOverride: null, updatedBy: "Alice", updatedAt: "2026-11-03T00:00:00.000Z",
    }]);
  });
});

describe("SkuMinSalesRepository.upsert", () => {
  it("upserts on master_sku and reports whether the row was new", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ inserted: true }] });
    const created = await SkuMinSalesRepository.upsert(
      { masterSku: "SKU-1", minTotalAvgCurr: 2, referenceSku: "SKU-2", referencePct: 30, note: "n" }, "Alice",
    );
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (master_sku) DO UPDATE");
    expect(params).toEqual(["SKU-1", 2, "SKU-2", 30, "n", "Alice"]);
    expect(created).toBe(true);
  });
});

describe("SkuMinSalesRepository.list - reference only", () => {
  it("maps a registration with no fixed minimum to null, not 0", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{
      master_sku: "SKU-1", min_total_avg_curr: null, reference_sku: "SKU-2", reference_pct: 30, note: null,
      product_name: null, category_code: "SC", calculated_total_avg_curr: null, total_avg_curr_override: null,
      updated_by: null, updated_at: "2026-11-18T00:00:00.000Z",
    }] });
    const [row] = await SkuMinSalesRepository.list();
    expect(row).toMatchObject({ minTotalAvgCurr: null, referenceSku: "SKU-2", referencePct: 30 });
  });
});

describe("SkuMinSalesRepository colour rules", () => {
  const dbRule = {
    id: 7, category_code: "SC", material: "", color: "IB", reference_color: "BE", reference_pct: "30",
    note: null, updated_by: "Alice", updated_at: new Date("2026-11-18T00:00:00Z"),
  };

  it("reads a rule for every fabric / material as material null", async () => {
    poolQueryMock.mockResolvedValue({ rows: [dbRule] });
    await expect(SkuMinSalesRepository.listColorRules()).resolves.toEqual([{
      id: 7, categoryCode: "SC", material: null, color: "IB", referenceColor: "BE", referencePct: 30,
      note: null, updatedBy: "Alice", updatedAt: "2026-11-18T00:00:00.000Z",
    }]);
  });

  it("upserts on category / material / colour, storing no material as ''", async () => {
    poolQueryMock.mockResolvedValue({ rows: [dbRule] });
    await SkuMinSalesRepository.upsertColorRule(
      { categoryCode: "SC", material: null, color: "IB", referenceColor: "BE", referencePct: 30, note: null }, "Alice",
    );
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (category_code, material, color) DO UPDATE");
    expect(params).toEqual(["SC", "", "IB", "BE", 30, null, "Alice"]);
  });

  it("returns null when the rule to delete does not exist", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await expect(SkuMinSalesRepository.deleteColorRule(99)).resolves.toBeNull();
    expect(poolQueryMock.mock.calls[0][1]).toEqual([99]);
  });

  it("lists active car cover and seat cover SKUs only", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "CC-TT-03-Y-BK-1TO" }] });
    await expect(SkuMinSalesRepository.listActiveColorRuleSkus()).resolves.toEqual(["CC-TT-03-Y-BK-1TO"]);
    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("status = 'active'");
    // Car covers in the current (CC-) and the unified (CA-CC-) SKU format.
    expect(sql).toContain("UPPER(master_sku) LIKE 'CC-%' OR UPPER(master_sku) LIKE 'CA-CC-%'");
    expect(sql).toContain("master_sku LIKE 'CA-SC-%'");
  });
});

describe("SkuMinSalesRepository.deleteMany", () => {
  it("returns the SKUs that were actually deleted", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    await expect(SkuMinSalesRepository.deleteMany(["SKU-1", "SKU-2"])).resolves.toEqual(["SKU-1"]);
    expect(poolQueryMock.mock.calls[0][1]).toEqual([["SKU-1", "SKU-2"]]);
  });
});
