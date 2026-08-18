import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getContainerHeaders: vi.fn(),
  getStatsRows: vi.fn(),
  getAvailableStockTotals: vi.fn(),
  getLastSync: vi.fn(),
  getContainerCategories: vi.fn(),
  getCrossData: vi.fn(),
  getVelocitySnapshot: vi.fn(),
  getInventoryByWarehouse: vi.fn(),
  getOosEpisodes: vi.fn(),
  getOosAgg: vi.fn(),
  getCategoryChannelRatio: vi.fn(),
  getOosLostDemandRaw: vi.fn(),
  zeroVelocityColumns: vi.fn(),
  getSalesVelocity: vi.fn(),
  upsertSwcProducts: vi.fn(),
  batchUpsert: vi.fn(),
};

const getCacheMock = vi.fn();
const setCacheMock = vi.fn();
const invalidateCacheMock = vi.fn();
const cacheManagerDeleteMock = vi.fn();
const cacheManagerDeletePatternMock = vi.fn();
const syncAllTransitStatsMock = vi.fn();
const insertMissingProductsMock = vi.fn();

vi.mock("@/lib/demand-planning/repository", () => ({ DemandPlanningRepository: repositoryMock }));
vi.mock("@/lib/sku-master/repository", () => ({
  SkuMasterRepository: { insertMissingProducts: insertMissingProductsMock },
}));
vi.mock("@/lib/transit-stock/repository", () => ({
  TransitStockRepository: { syncAllStats: syncAllTransitStatsMock },
}));
vi.mock("@/lib/planning/dashboard-cache", () => ({
  getPlanningDashboardCache: getCacheMock,
  setPlanningDashboardCache: setCacheMock,
  invalidatePlanningDashboardCache: invalidateCacheMock,
}));
vi.mock("@/lib/redis", () => ({
  CacheManager: { delete: cacheManagerDeleteMock, deletePattern: cacheManagerDeletePatternMock },
}));

const { DemandPlanningService } = await import("@/lib/demand-planning/service");

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.getContainerHeaders.mockResolvedValue([]);
  repositoryMock.getStatsRows.mockResolvedValue([]);
  repositoryMock.getAvailableStockTotals.mockResolvedValue([]);
  repositoryMock.getLastSync.mockResolvedValue(null);
  repositoryMock.getContainerCategories.mockResolvedValue([]);
  repositoryMock.getCrossData.mockResolvedValue([]);
  repositoryMock.getVelocitySnapshot.mockResolvedValue([]);
  getCacheMock.mockResolvedValue(null);
  insertMissingProductsMock.mockResolvedValue({ inserted: 0 });
});

const baseQuery = {
  mode: "link" as const,
  includeContainers: false,
  rawContainers: false,
  includeDrafts: false,
  categoryCode: null,
  asOf: null,
  salesWeightsParam: null,
};

describe("DemandPlanningService.getDashboardData", () => {
  it("returns a cache HIT without calling the repository when cached", async () => {
    getCacheMock.mockResolvedValue({ success: true, data: { containers: [], rows: [], pinned_rows: [], last_sync: null } });
    const result = await DemandPlanningService.getDashboardData(baseQuery);
    expect(result.cacheStatus).toBe("HIT");
    expect(repositoryMock.getContainerHeaders).not.toHaveBeenCalled();
  });

  it("always returns an empty pinned_rows array (dead feature removed)", async () => {
    const result = await DemandPlanningService.getDashboardData(baseQuery);
    expect(result.data.pinned_rows).toEqual([]);
    expect(result.cacheStatus).toBe("MISS");
  });

  it("computes a baseline row per SKU from total_stock + back when not rawContainers", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([{
      sku: "SKU-1", total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
      latest_container: "190-CA-SEAT", latest_eta: "2026-08-10", latest_qty: 700,
      sales_status: "Original", category_code: "SC", cbm_per_unit: 0, memo: null, case_qty: 1, moq: 1, order_multiple: 1,
      back: 0, west_stock: 5, east_stock: 5, west_available_stock: 5, east_available_stock: 5, transit_stock: 0,
      fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0,
      fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0,
      total_stock: 10, west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
      east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
      avg_daily_prev: 1, avg_daily_real: 1, avg_daily_curr: 1, east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
      fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
      fba_90d_sales: 90, fba_60d_sales: 60, fba_30d_sales: 30,
      fba_15d_sales: 15, fba_7d_sales: 7, fba_30d_pre: 0,
      fba_30d: 0, total_avg_prev: 1, total_avg_real: 1, total_avg_curr: 1, total_avg_curr_override: 2.5,
      oos_days_90d: 0, oos_lost_demand_90d: 0,
    }]);

    const result = await DemandPlanningService.getDashboardData(baseQuery);
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].sku).toBe("SKU-1");
    expect(result.data.rows[0].total_stock).toBe(10);
    expect(result.data.rows[0].container_info).toBe("2026-08-10 - (190-CA-SEAT) - 700");
    expect(result.data.rows[0].total_avg_curr_auto).toBe(1.02);
    expect(result.data.rows[0].total_avg_curr).toBe(2.5);
    expect(result.data.rows[0].total_avg_curr_override).toBe(2.5);
    expect(result.data.rows[0]).toMatchObject({
      fba_90d_sales: 90,
      fba_60d_sales: 60,
      fba_30d_sales: 30,
      fba_15d_sales: 15,
      fba_7d_sales: 7,
      fba_30d_pre: 0,
    });
  });

  it("skips the historical velocity snapshot lookups when asOf is today or absent", async () => {
    await DemandPlanningService.getDashboardData(baseQuery);
    expect(repositoryMock.getVelocitySnapshot).not.toHaveBeenCalled();
  });

  it("uses Total Avg Actual rather than Total Avg Current for S.O.D", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([{
      sku: "SKU-1", total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
      latest_container: null, latest_eta: null, latest_qty: null,
      sales_status: "Original", category_code: "SC", cbm_per_unit: 0, memo: null, case_qty: 1, moq: 1, order_multiple: 1,
      back: 0, west_stock: 100, east_stock: 0, west_available_stock: 100, east_available_stock: 0, transit_stock: 0,
      fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0,
      fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0,
      total_stock: 100, west_90d: 900, west_60d: 600, west_30d: 300, west_15d: 150, west_7d: 70, west_30d_pre: 999,
      east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
      avg_daily_prev: 20, avg_daily_real: 99, avg_daily_curr: 99, east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
      fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0, fba_30d: 0, total_avg_prev: 20, total_avg_real: 99, total_avg_curr: 99,
      oos_days_90d: 0, oos_lost_demand_90d: 0,
    }]);
    repositoryMock.getVelocitySnapshot.mockResolvedValue([]);

    const result = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" });
    expect(result.data.rows[0].total_avg_real).toBe(10.02);
    expect(result.data.rows[0].sod).toBe("2026-08-21");
  });

  it("queries historical velocity snapshots when asOf is a past date", async () => {
    repositoryMock.getVelocitySnapshot.mockResolvedValue([]);
    await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2020-01-01" });
    expect(repositoryMock.getVelocitySnapshot).toHaveBeenCalledWith("link", "2020-01-01");
    expect(repositoryMock.getVelocitySnapshot).toHaveBeenCalledWith("custom", "2020-01-01");
  });

  it("does not query cross data or link velocity in custom mode without includeContainers", async () => {
    await DemandPlanningService.getDashboardData({ ...baseQuery, mode: "custom" });
    expect(repositoryMock.getCrossData).not.toHaveBeenCalled();
  });
});

describe("DemandPlanningService.refreshStats", () => {
  it("returns null when the lookup pool is unavailable", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue(null);
    const result = await DemandPlanningService.refreshStats({});
    expect(result).toBeNull();
    expect(repositoryMock.batchUpsert).not.toHaveBeenCalled();
  });

  it("runs the full pipeline and reports upsert counts", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([{ master_sku: "SKU-1" }]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([]);
    repositoryMock.getSalesVelocity
      .mockResolvedValueOnce([{ master_sku: "SKU-1", avg_daily_prev: 1, avg_daily_real: 1, east_avg_prev: 0, east_avg_real: 0, fba_avg_prev: 0, fba_avg_real: 0, west_90d: 0, west_60d: 0, west_30d: 0, west_30d_pre: 0, west_15d: 0, west_7d: 0, east_90d: 0, east_60d: 0, east_30d: 0, east_30d_pre: 0, east_15d: 0, east_7d: 0, fba_30d: 0 }])
      .mockResolvedValueOnce([]);

    insertMissingProductsMock.mockResolvedValue({ inserted: 1 });

    const result = await DemandPlanningService.refreshStats({});

    expect(result).toEqual({ inventoryUpserted: 1, linkSalesUpserted: 1, customSalesUpserted: 0, productsBackfilled: 1 });
    expect(syncAllTransitStatsMock).toHaveBeenCalledTimes(1);
    expect(insertMissingProductsMock).toHaveBeenCalledWith(["SKU-1"]);
    expect(repositoryMock.upsertSwcProducts).toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(cacheManagerDeleteMock).toHaveBeenCalledWith("oos-preorder:sku-list:v4");
  });

  it("backfills fc_products from the union of inventory and sales-velocity SKUs discovered this run, deduplicated", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([{ master_sku: "SKU-1" }, { master_sku: "SKU-2" }]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([]);
    repositoryMock.getSalesVelocity
      .mockResolvedValueOnce([{ master_sku: "SKU-1", avg_daily_prev: 1, avg_daily_real: 1, east_avg_prev: 0, east_avg_real: 0, fba_avg_prev: 0, fba_avg_real: 0, west_90d: 0, west_60d: 0, west_30d: 0, west_30d_pre: 0, west_15d: 0, west_7d: 0, east_90d: 0, east_60d: 0, east_30d: 0, east_30d_pre: 0, east_15d: 0, east_7d: 0, fba_30d: 0 }])
      .mockResolvedValueOnce([{ master_sku: "SKU-3", avg_daily_prev: 0, avg_daily_real: 0, east_avg_prev: 0, east_avg_real: 0, fba_avg_prev: 0, fba_avg_real: 0, west_90d: 0, west_60d: 0, west_30d: 0, west_30d_pre: 0, west_15d: 0, west_7d: 0, east_90d: 0, east_60d: 0, east_30d: 0, east_30d_pre: 0, east_15d: 0, east_7d: 0, fba_30d: 0 }]);

    await DemandPlanningService.refreshStats({});

    // SKU-1 appears in both inventory and link-velocity but must only be passed once.
    expect(insertMissingProductsMock).toHaveBeenCalledWith(["SKU-1", "SKU-2", "SKU-3"]);
  });

  it("stores all FBA windows and applies the fixed sheet weights with preorder at zero", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([]);
    repositoryMock.getSalesVelocity
      .mockResolvedValueOnce([{
        master_sku: "SKU-FBA", sales_status: "Original",
        west_90d: 0, west_60d: 0, west_30d: 0, west_30d_pre: 0, west_15d: 0, west_7d: 0,
        east_90d: 0, east_60d: 0, east_30d: 0, east_30d_pre: 0, east_15d: 0, east_7d: 0,
        avg_daily_prev: 0, east_avg_prev: 0, fba_avg_prev: 5,
        fba_90d: 900, fba_60d: 600, fba_30d: 300,
        fba_15d: 150, fba_7d: 70, fba_30d_pre: 999,
      }])
      .mockResolvedValueOnce([]);

    await DemandPlanningService.refreshStats({
      salesWindowWeights: { d90: 1, d60: 0, d30: 0, d15: 0, d7: 0, pre: 0 },
    });

    const statsCall = repositoryMock.batchUpsert.mock.calls.find((call) =>
      call[0] === "shipcore.fc_stats" && (call[2] as string[]).includes("fba_90d_sales"));
    const row = statsCall?.[1][0];
    expect(row).toMatchObject({
      fba_90d_sales: 900,
      fba_60d_sales: 600,
      fba_30d_sales: 300,
      fba_15d_sales: 150,
      fba_7d_sales: 70,
      fba_30d_pre: 999,
      fba_avg_real: 10,
    });
  });

  it("combines West and East FBM before blending and 30-day rounding", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([]);
    repositoryMock.getSalesVelocity
      .mockResolvedValueOnce([{
        master_sku: "CC-CN-15-P-GR-1TO", sales_status: "Original",
        west_90d: 1, west_60d: 0, west_30d: 0, west_30d_pre: 0, west_15d: 0, west_7d: 0,
        east_90d: 1, east_60d: 0, east_30d: 0, east_30d_pre: 0, east_15d: 0, east_7d: 0,
        avg_daily_prev: 10, east_avg_prev: 1, fba_avg_prev: 0,
        fba_90d: 0, fba_60d: 0, fba_30d: 0, fba_15d: 0, fba_7d: 0, fba_30d_pre: 0,
      }])
      .mockResolvedValueOnce([]);

    await DemandPlanningService.refreshStats({});

    const statsCall = repositoryMock.batchUpsert.mock.calls.find((call) =>
      call[0] === "shipcore.fc_stats" && (call[2] as string[]).includes("total_avg_curr"));
    const row = statsCall?.[1][0];
    expect(row.total_avg_real).toBeCloseTo(0.02);
    expect(row.total_avg_curr).toBeCloseTo(3.317);
    expect(row.west_fbm_30d).toBe(1);
    expect(row.east_fbm_30d).toBe(1);
    expect(row.total_30d).toBe(1);
  });

  it("applies a category weight override over the auto-computed ratio", async () => {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([{ category_code: "SC", shopify_90d: 100, amazon_90d: 50, ebay_90d: 0, walmart_90d: 0 }]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([
      { master_sku: "SKU-1", category_code: "SC", clipped_days: 5, shopify_qty: 10, amazon_qty: 0, ebay_qty: 0, walmart_qty: 0 },
    ]);
    repositoryMock.getSalesVelocity.mockResolvedValue([]);

    await DemandPlanningService.refreshStats({ oosLostDemandWeights: { SC: { amazon: 2, ebay: null, walmart: null } } });

    const lostDemandCall = repositoryMock.batchUpsert.mock.calls.find((c) => c[0] === "shipcore.fc_stats" && c[3] === "oos_lost_demand_90d = EXCLUDED.oos_lost_demand_90d, updated_at = NOW()");
    expect(lostDemandCall?.[1]).toEqual([{ master_sku: "SKU-1", oos_lost_demand_90d: 20 }]);
  });
});
