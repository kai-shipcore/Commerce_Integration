import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getContainerHeaders: vi.fn(),
  getStatsRows: vi.fn(),
  getAvailableStockTotals: vi.fn(),
  getLastSync: vi.fn(),
  getSalesSyncedAt: vi.fn(),
  getContainerCategories: vi.fn(),
  getCrossData: vi.fn(),
  getVelocitySnapshot: vi.fn(),
  getInventorySnapshotAsOf: vi.fn(),
  getInventoryHistoryCoverage: vi.fn(),
  getVelocityHistoryMinDate: vi.fn(),
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
const runVelocitySyncMock = vi.fn();

class SyncInProgressErrorMock extends Error {
  holdSeconds: number | null;
  constructor(holdSeconds: number | null = null) {
    super("Sync already in progress");
    this.name = "SyncInProgressError";
    this.holdSeconds = holdSeconds;
  }
}

vi.mock("@/lib/demand-planning/repository", () => ({ DemandPlanningRepository: repositoryMock }));
vi.mock("@/lib/sku-master/repository", () => ({
  SkuMasterRepository: { insertMissingProducts: insertMissingProductsMock },
}));
const findFloorMatSetsMock = vi.fn<(skus: string[]) => Promise<Map<string, unknown>>>(async () => new Map());
vi.mock("@/lib/sku-master/floor-mat-set-repository", () => ({
  FloorMatSetRepository: { findBySkus: (skus: string[]) => findFloorMatSetsMock(skus) },
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
vi.mock("@/lib/velocity/service", () => ({
  VelocityService: { runSync: runVelocitySyncMock },
  SyncInProgressError: SyncInProgressErrorMock,
}));

const { DemandPlanningService } = await import("@/lib/demand-planning/service");

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.getContainerHeaders.mockResolvedValue([]);
  repositoryMock.getStatsRows.mockResolvedValue([]);
  repositoryMock.getAvailableStockTotals.mockResolvedValue([]);
  repositoryMock.getLastSync.mockResolvedValue(null);
  repositoryMock.getSalesSyncedAt.mockResolvedValue(null);
  runVelocitySyncMock.mockResolvedValue({ linkUpserted: 10, customUpserted: 5, linkDeleted: 0, customDeleted: 0 });
  repositoryMock.getContainerCategories.mockResolvedValue([]);
  repositoryMock.getCrossData.mockResolvedValue([]);
  repositoryMock.getVelocitySnapshot.mockResolvedValue([]);
  repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([]);
  repositoryMock.getInventoryHistoryCoverage.mockResolvedValue(null);
  repositoryMock.getVelocityHistoryMinDate.mockResolvedValue(null);
  getCacheMock.mockResolvedValue(null);
  insertMissingProductsMock.mockResolvedValue({ inserted: 0 });
});

const baseQuery = {
  mode: "link" as const,
  includeContainers: false,
  rawContainers: false,
  includeDrafts: false,
  categoryCodes: null,
  asOf: null,
  salesWeightsParam: null,
};

describe("lightweight container details", () => {
  const configurations = [
    { mode: "custom" as const, categoryCodes: ["SC"], asOf: null, includeDrafts: false },
    { mode: "link" as const, categoryCodes: ["CC", "SWC", "AC"], asOf: "2020-01-01", includeDrafts: true },
    { mode: "custom" as const, categoryCodes: ["FM"], asOf: "2020-01-01", includeDrafts: false },
    { mode: "link" as const, categoryCodes: null, asOf: null, includeDrafts: true },
  ];

  it.each(configurations)("preserves the old raw projection for %j", async configuration => {
    const stats = {
      ...Object.fromEntries(("back total_stock total_avg_real west_90d west_60d west_30d west_30d_pre west_15d west_7d " +
        "east_90d east_60d east_30d east_30d_pre east_15d east_7d avg_daily_prev east_avg_prev " +
        "fba_avg_prev fba_30d").split(" ").map(key => [key, 0])),
      sku: "CA-SC-10-F-10-BK-1TO", category_code: "SC",
    };
    repositoryMock.getStatsRows.mockResolvedValue([stats, { ...stats, sku: "EMPTY" }]);
    repositoryMock.getContainerHeaders.mockResolvedValue([
      { id: 2, name: "Z", eta: "2026-10-01", cbm_cap: null, status: "draft" },
      { id: 1, name: "A", eta: "2026-10-01", cbm_cap: 70, status: "shipped" },
      { id: 3, name: "No date", eta: null, cbm_cap: 60, status: "packing_received" },
    ]);
    repositoryMock.getContainerCategories.mockResolvedValue([{ container_id: 1, category_code: "SC" }]);
    const first = {
      sku: stats.sku, container_name: "A", item_id: 1, cbm_unit: 0.125,
      inbound_qty: 12, allocated_remaining_qty: null, avail_qty: 12, cbm: 1.5,
      eta: "2026-10-01", open_orders: null, est_sales: null, backorder: null,
      inv_life: null, est_sod: null, plan_sod: null,
    };
    repositoryMock.getCrossData.mockResolvedValue([
      first,
      { ...first, item_id: 2, inbound_qty: 0, avail_qty: 0, cbm: 0, allocated_remaining_qty: 3 },
      { ...first, container_name: "Z", item_id: 3 },
      { ...first, sku: "NOT-IN-STATS" },
    ]);
    const query = { ...baseQuery, ...configuration, categoryCodes: configuration.categoryCodes as ("SC" | "CC" | "FM" | "AC" | "SWC")[] | null,
      includeContainers: true, rawContainers: true, salesWeightsParam: '{"d30":0.7}' };
    const old = await DemandPlanningService.getDashboardData(query);
    vi.clearAllMocks();
    const result = await DemandPlanningService.getContainerDetails(query);
    const bySku = new Map(result.data.rows.map(row => [row.sku, row.containers]));
    expect(result.data.containers).toEqual(old.data.containers);
    expect(old.data.rows.map(row => ({ sku: row.sku, containers: bySku.get(row.sku) ?? {} })))
      .toEqual(old.data.rows.map(({ sku, containers }) => ({ sku, containers })));
    expect(result.data.containers.map(row => row.name)).toEqual(["Base", "A", "Z", "No date"]);
    expect(bySku.get(stats.sku)?.A).toMatchObject({ inbound_qty: 0, item_id: 2, allocated_remaining_qty: 3, cbm: 0 });
    expect(bySku.get(stats.sku)?.Z.allocated_remaining_qty).toBe(0);
    expect(repositoryMock.getStatsRows).not.toHaveBeenCalled();
    expect(repositoryMock.getAvailableStockTotals).not.toHaveBeenCalled();
    expect(repositoryMock.getVelocitySnapshot).not.toHaveBeenCalled();
    expect(repositoryMock.getLastSync).not.toHaveBeenCalled();
    expect(repositoryMock.getCrossData).toHaveBeenCalledWith(expect.objectContaining({
      rawContainers: true, categoryCodes: query.categoryCodes, mode: query.mode,
    }));
    expect(setCacheMock.mock.calls[0][7]).toMatch(/^containers-only-v1:/);
  });

  it("uses its own typed cache without any repository reads", async () => {
    const data = { containers: [], rows: [] };
    getCacheMock.mockResolvedValue({ success: true, data });
    expect(await DemandPlanningService.getContainerDetails(baseQuery)).toEqual({ data, cacheStatus: "HIT" });
    expect(getCacheMock.mock.calls[0][6]).toMatch(/^containers-only-v1:/);
    expect(repositoryMock.getCrossData).not.toHaveBeenCalled();
    expect(repositoryMock.getStatsRows).not.toHaveBeenCalled();
  });
});

describe("DemandPlanningService.getDashboardData floor mat sets", () => {
  const statsRow = (sku: string, patch: Record<string, unknown> = {}) => ({
    sku, total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
    latest_container: null, latest_eta: null, latest_qty: null,
    sales_status: "Original", category_code: "FM", cbm_per_unit: 0, memo: null, case_qty: 1, moq: 1, order_multiple: 1,
    back: 0, west_stock: 0, east_stock: 0, west_available_stock: 0, east_available_stock: 0, transit_stock: 0,
    fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0, dream_trans_stock: 0, linkone_stock: 0,
    fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0, dream_trans_available_stock: 0, linkone_available_stock: 0,
    total_stock: 0, west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
    east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
    avg_daily_prev: 1, avg_daily_real: 1, avg_daily_curr: 1, east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
    fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
    fba_90d_sales: 0, fba_60d_sales: 0, fba_30d_sales: 0, fba_15d_sales: 0, fba_7d_sales: 0, fba_30d_pre: 0,
    fba_30d: 0, total_avg_prev: 1, total_avg_real: 1, total_avg_curr: 1, total_avg_curr_override: null,
    oos_days_90d: 0, oos_lost_demand_90d: 0,
    ...patch,
  });
  const SET = { frontSku: "CA-FM-TX-F", rearSku: "CA-FM-TX-R", preOrder12: true, preOrder3: null, thirdRows: [], oldSetSkus: [] };
  const rows = () => [
    // The master holds 2 prepacked sets; 3 fronts and 5 rears are loose at TTM.
    statsRow("CA-FM-80-FM1", { total_stock: 2, east_available_stock: 2, ttm_available_stock: 2 }),
    statsRow("CA-FM-TX-F", { total_stock: 3, ttm_available_stock: 3 }),
    statsRow("CA-FM-TX-R", { total_stock: 5, ttm_jeff_available_stock: 5 }),
  ];

  it("adds Loose Sets On Hand to a master's Total Stock and redoes its S.O.D.", async () => {
    repositoryMock.getStatsRows.mockResolvedValue(rows());
    const plain = (await DemandPlanningService.getDashboardData(baseQuery)).data.rows[0];

    repositoryMock.getStatsRows.mockResolvedValue(rows());
    findFloorMatSetsMock.mockResolvedValueOnce(new Map([["CA-FM-80-FM1", SET]]));
    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    const [master, front, rear] = data.rows;

    expect(findFloorMatSetsMock).toHaveBeenLastCalledWith(["CA-FM-80-FM1", "CA-FM-TX-F", "CA-FM-TX-R"]);
    // MIN(3 fronts, 5 rears) = 3 sets on top of the 2 prepacked ones.
    expect(master).toMatchObject({ fm_set: SET, loose_sets_on_hand: 3, total_stock: 5 });
    // One a day: 2 days of stock without the loose sets, 5 with them.
    expect(plain.sod_days_raw).toBe(2);
    expect(master.sod_days_raw).toBe(5);
    // S.O.D. is exactly what a master holding 5 units outright would get.
    repositoryMock.getStatsRows.mockResolvedValue([statsRow("CA-FM-80-FM1", { total_stock: 5 })]);
    const outright = (await DemandPlanningService.getDashboardData(baseQuery)).data.rows[0];
    expect(master.sod).toBe(outright.sod);
    expect(master.sod! > plain.sod!).toBe(true);
    // The components keep their own stock; they are not reduced by the pairing.
    expect(front).toMatchObject({ total_stock: 3 });
    expect(front.loose_sets_on_hand).toBeUndefined();
    expect(rear.total_stock).toBe(5);
  });

  it("changes nothing when no set links are recorded", async () => {
    repositoryMock.getStatsRows.mockResolvedValue(rows());
    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    expect(data.rows[0].total_stock).toBe(2);
    expect(data.rows[0].fm_set).toBeUndefined();
    expect(data.rows[0].loose_sets_on_hand).toBeUndefined();
  });

  it("does not look up sets when the view has no floor mat rows", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([statsRow("CA-SC-1", { category_code: "SC" })]);
    await DemandPlanningService.getDashboardData(baseQuery);
    expect(findFloorMatSetsMock).not.toHaveBeenCalled();
  });
});

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
      fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0, dream_trans_stock: 0, linkone_stock: 0,
      fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0, dream_trans_available_stock: 0, linkone_available_stock: 0,
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

  describe("Min Sales floor on T.Avg current", () => {
    const statsRow = (overrides: Record<string, unknown>) => ({
      sku: "SKU-1", total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
      latest_container: null, latest_eta: null, latest_qty: null,
      sales_status: "Original", category_code: "SC", cbm_per_unit: 0, memo: null, case_qty: 1, moq: 1, order_multiple: 1,
      back: 0, west_stock: 5, east_stock: 5, west_available_stock: 5, east_available_stock: 5, transit_stock: 0,
      fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0, dream_trans_stock: 0, linkone_stock: 0,
      fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0, dream_trans_available_stock: 0, linkone_available_stock: 0,
      total_stock: 10, west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
      east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
      avg_daily_prev: 1, avg_daily_real: 1, avg_daily_curr: 1, east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
      fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
      fba_90d_sales: 0, fba_60d_sales: 0, fba_30d_sales: 0, fba_15d_sales: 0, fba_7d_sales: 0, fba_30d_pre: 0,
      fba_30d: 0, total_avg_prev: 1, total_avg_real: 1, total_avg_curr: 1, total_avg_curr_override: null,
      total_avg_curr_min: null,
      oos_days_90d: 0, oos_lost_demand_90d: 0,
      ...overrides,
    });

    it("shows the minimum and flags it when the calculated value is below it", async () => {
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({ total_avg_curr_min: 3 })]);
      const { data } = await DemandPlanningService.getDashboardData(baseQuery);
      expect(data.rows[0]).toMatchObject({
        total_avg_curr: 3, total_avg_curr_auto: 0.33, total_avg_curr_min: 3, total_avg_curr_min_applied: true,
      });
    });

    it("passes the Replacing Soon registration through, and null when not registered", async () => {
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({
        replacing_soon_days: 30, replacing_soon_replacement_sku: "SKU-NEW", replacing_soon_note: "fabric change",
      })]);
      const { data } = await DemandPlanningService.getDashboardData(baseQuery);
      expect(data.rows[0]).toMatchObject({
        replacing_soon_days: 30, replacing_soon_replacement_sku: "SKU-NEW", replacing_soon_note: "fabric change",
      });

      repositoryMock.getStatsRows.mockResolvedValue([statsRow({})]);
      const { data: plain } = await DemandPlanningService.getDashboardData(baseQuery);
      expect(plain.rows[0]).toMatchObject({ replacing_soon_days: null, replacing_soon_replacement_sku: null });
    });

    it("keeps the calculated value when it is already above the minimum", async () => {
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({ total_avg_curr_min: 0.2 })]);
      const { data } = await DemandPlanningService.getDashboardData(baseQuery);
      expect(data.rows[0]).toMatchObject({ total_avg_curr: 0.33, total_avg_curr_min_applied: false });
    });

    it("lets a manual override win over the minimum", async () => {
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({ total_avg_curr_min: 3, total_avg_curr_override: 2 })]);
      const { data } = await DemandPlanningService.getDashboardData(baseQuery);
      expect(data.rows[0]).toMatchObject({ total_avg_curr: 2, total_avg_curr_min_applied: false });
    });

    it("plans the baseline inventory life on the floored rate", async () => {
      const query = { ...baseQuery, includeContainers: true };
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({})]);
      const before = (await DemandPlanningService.getDashboardData(query)).data.rows[0];
      getCacheMock.mockResolvedValue(null);
      repositoryMock.getStatsRows.mockResolvedValue([statsRow({ total_avg_curr_min: 5 })]);
      const after = (await DemandPlanningService.getDashboardData(query)).data.rows[0];
      expect(after.containers.Base.inv_life as number).toBeLessThan(before.containers.Base.inv_life as number);
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
      fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0, dream_trans_stock: 0, linkone_stock: 0,
      fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0, dream_trans_available_stock: 0, linkone_available_stock: 0,
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

describe("DemandPlanningService.getDashboardData — historical inventory", () => {
  // Current stock: 40 available across the warehouses plus 5 in transit.
  // total_avg_real is what sod_days_raw divides by, so it is kept round.
  function statsRow(overrides: Record<string, unknown> = {}) {
    return {
      sku: "SKU-1", total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
      latest_container: null, latest_eta: null, latest_qty: null,
      sales_status: "Original", category_code: "SC", cbm_per_unit: 0, memo: null, case_qty: 1, moq: 1, order_multiple: 1,
      back: -3, west_stock: 30, east_stock: 10, west_available_stock: 30, east_available_stock: 10, transit_stock: 5,
      fullerton_stock: 20, canary_stock: 10, ttm_stock: 6, ttm_jeff_stock: 4, dream_trans_stock: 3, linkone_stock: 2,
      fullerton_available_stock: 20, canary_available_stock: 10, ttm_available_stock: 6, ttm_jeff_available_stock: 4, dream_trans_available_stock: 3, linkone_available_stock: 2,
      total_stock: 45, west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
      east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
      avg_daily_prev: 1, avg_daily_real: 1, avg_daily_curr: 1, east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
      fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0, fba_30d: 0,
      total_avg_prev: 10, total_avg_real: 10, total_avg_curr: 10,
      oos_days_90d: 0, oos_lost_demand_90d: 0,
      ...overrides,
    };
  }

  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    master_sku: "SKU-1", snapshot_date: "2026-08-10", available_stock: 100, backorder: 0, ...overrides,
  });

  beforeEach(() => {
    repositoryMock.getStatsRows.mockResolvedValue([statsRow({})]);
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue({ min_date: "2026-03-28", max_date: "2026-09-16" });
  });

  it("leaves the inventory history alone when asOf is today or absent", async () => {
    const result = await DemandPlanningService.getDashboardData(baseQuery);

    expect(repositoryMock.getInventorySnapshotAsOf).not.toHaveBeenCalled();
    expect(result.data.rows[0].total_stock).toBe(45);
    expect(result.data.rows[0].west_available_stock).toBe(30);
    expect(result.data.inventory_historical).toBe(false);
  });

  it("replays stock from the history for a past date, keeping transit current", async () => {
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot()]);

    const result = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" });
    const row = result.data.rows[0];

    expect(repositoryMock.getInventorySnapshotAsOf).toHaveBeenCalledWith("2026-08-12");
    // 100 available on the history plus the 5 still in transit today, since
    // transit has no history of its own.
    expect(row.total_stock).toBe(105);
    expect(row.transit_stock).toBe(5);
    expect(result.data.inventory_historical).toBe(true);
    expect(result.data.inventory_snapshot_date).toBe("2026-08-10");
    expect(result.data.as_of).toBe("2026-08-12");
  });

  it("blanks the per-warehouse columns rather than showing today's split", async () => {
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot()]);

    const row = (await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" })).data.rows[0];

    expect(row.west_stock).toBeNull();
    expect(row.east_stock).toBeNull();
    expect(row.west_available_stock).toBeNull();
    expect(row.east_available_stock).toBeNull();
    expect(row.fullerton_available_stock).toBeNull();
    expect(row.canary_available_stock).toBeNull();
    expect(row.ttm_available_stock).toBeNull();
    expect(row.ttm_jeff_available_stock).toBeNull();
    expect(row.dream_trans_available_stock).toBeNull();
    expect(row.linkone_available_stock).toBeNull();
  });

  it("flips the sign on back orders, which the history stores positive", async () => {
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot({ backorder: 7 })]);

    const row = (await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" })).data.rows[0];

    expect(row.back).toBe(-7);
    // A SKU on back order is critical regardless of how much stock it shows.
    expect(row.sod_days_raw).toBe(-1);
  });

  it("derives S.O.D. from the replayed stock, not the current stock", async () => {
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot()]);

    const row = (await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" })).data.rows[0];

    // floor(105 / total_avg_real 10) — against current stock it would be 4.
    expect(row.sod_days_raw).toBe(10);
  });

  it("falls back to current stock for a SKU the history does not cover", async () => {
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot({ master_sku: "SOME-OTHER-SKU" })]);

    const row = (await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" })).data.rows[0];

    expect(row.total_stock).toBe(45);
    expect(row.west_available_stock).toBe(30);
    expect(row.back).toBe(-3);
  });

  it("keeps current stock for a date before the history carries quantities", async () => {
    // Rows do come back for such a date, but every quantity in them is a zero
    // written for out-of-stock tracking; replaying those would read as "the
    // whole catalogue was empty" rather than "this is not knowable".
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([
      snapshot({ snapshot_date: "2026-01-15", available_stock: 0 }),
    ]);

    const result = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-02-01" });

    expect(result.data.rows[0].total_stock).toBe(45);
    expect(result.data.rows[0].west_available_stock).toBe(30);
    expect(result.data.inventory_historical).toBe(false);
    expect(result.data.inventory_history_min_date).toBe("2026-03-28");
  });

  it("floors the picker where both histories can answer completely", async () => {
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue({ min_date: "2026-03-28", max_date: "2026-09-16" });
    repositoryMock.getVelocityHistoryMinDate.mockResolvedValue("2026-02-08");

    const result = await DemandPlanningService.getDashboardData(baseQuery);

    // The velocity snapshot reads back 96 days behind the as-of date to fill
    // the "previous period" windows, so the first date with a whole 90-day
    // window is 2026-02-08 + 96 = 2026-05-15 — later than the inventory floor,
    // so it is the binding one.
    expect(result.data.as_of_min_date).toBe("2026-05-15");
    expect(result.data.sales_history_min_date).toBe("2026-02-08");
    expect(result.data.inventory_history_min_date).toBe("2026-03-28");
  });

  it("falls back to the inventory floor when the sales history reaches further back", async () => {
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue({ min_date: "2026-03-28", max_date: "2026-09-16" });
    repositoryMock.getVelocityHistoryMinDate.mockResolvedValue("2025-01-01");

    const result = await DemandPlanningService.getDashboardData(baseQuery);

    expect(result.data.as_of_min_date).toBe("2026-03-28");
  });

  it("leaves the picker unbounded when neither history can be read", async () => {
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue(null);
    repositoryMock.getVelocityHistoryMinDate.mockResolvedValue(null);

    const result = await DemandPlanningService.getDashboardData(baseQuery);

    expect(result.data.as_of_min_date).toBeNull();
  });

  it("still replays stock when the coverage lookup is unavailable", async () => {
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue(null);
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([snapshot()]);

    const result = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" });

    expect(result.data.rows[0].total_stock).toBe(105);
    expect(result.data.inventory_history_min_date).toBeNull();
  });

  it("survives the lookup DB being down, leaving stock current", async () => {
    repositoryMock.getInventoryHistoryCoverage.mockRejectedValue(new Error("lookup unavailable"));
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([]);

    const result = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-08-12" });

    expect(result.data.rows[0].total_stock).toBe(45);
    expect(result.data.inventory_historical).toBe(false);
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

    expect(result).toEqual({
      inventoryUpserted: 1, linkSalesUpserted: 1, customSalesUpserted: 0, productsBackfilled: 1,
      velocityLinkUpserted: 10, velocityCustomUpserted: 5, velocitySnapshotStale: false,
    });
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

// ─── Final-SKU roll-up (TN→TNS, BKGR→BKLG) ───────────────────────────────
//
// The factory only orders the final SKU now, so its row has to carry the
// legacy SKU's demand and the legacy units still in the warehouse (they ship
// against the final SKU). The legacy SKU's own row must stay untouched.

function ccStatsRow(sku: string, overrides: Record<string, unknown> = {}) {
  return {
    sku, total_inbound_qty: 0, containers_list: null, next_eta: null, cbm_unit: null,
    latest_container: null, latest_eta: null, latest_qty: null,
    sales_status: "Original", category_code: "CC", cbm_per_unit: 0, memo: null,
    case_qty: 1, moq: 1, order_multiple: 1,
    back: 0, west_stock: 0, east_stock: 0, west_available_stock: 0, east_available_stock: 0, transit_stock: 0,
    fullerton_stock: 0, canary_stock: 0, ttm_stock: 0, ttm_jeff_stock: 0,
    fullerton_available_stock: 0, canary_available_stock: 0, ttm_available_stock: 0, ttm_jeff_available_stock: 0,
    total_stock: 0,
    west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
    east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
    avg_daily_prev: 0, avg_daily_real: 0, avg_daily_curr: 0,
    east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
    fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
    fba_90d_sales: 0, fba_60d_sales: 0, fba_30d_sales: 0, fba_15d_sales: 0, fba_7d_sales: 0, fba_30d_pre: 0,
    fba_30d: 0, total_avg_prev: 0, total_avg_real: 0, total_avg_curr: 0, total_avg_curr_override: null,
    oos_days_90d: 0, oos_lost_demand_90d: 0,
    ...overrides,
  };
}

const rowBySku = <T extends { sku: string }>(rows: T[], sku: string): T => rows.find((r) => r.sku === sku)!;

describe("DemandPlanningService.getDashboardData - final SKU sales roll-up", () => {
  it("adds the legacy SKU's sales to the final SKU's row", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-SS-15-K-BKGR-STR", { west_90d: 90, west_60d: 60, west_30d: 30, west_15d: 15, west_7d: 7, fba_90d_sales: 9 }),
      ccStatsRow("CC-SS-15-K-BKLG-STR", { west_90d: 10, west_60d: 6, west_30d: 3, west_15d: 1, west_7d: 1, fba_90d_sales: 1 }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    const final = rowBySku(data.rows, "CC-SS-15-K-BKLG-STR");
    expect(final).toMatchObject({ west_90d: 100, west_60d: 66, west_30d: 33, west_15d: 16, west_7d: 8, fba_90d_sales: 10 });
    expect(final.rolled_up_from).toEqual(["CC-SS-15-K-BKGR-STR"]);
  });

  it("leaves the legacy SKU's own row exactly as it was", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-SS-15-K-BKGR-STR", { west_90d: 90, west_30d: 30, total_stock: 38, west_available_stock: 38, back: -4 }),
      ccStatsRow("CC-SS-15-K-BKLG-STR", { west_90d: 10 }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    const legacy = rowBySku(data.rows, "CC-SS-15-K-BKGR-STR");
    expect(legacy).toMatchObject({ west_90d: 90, west_30d: 30, total_stock: 38, back: -4 });
    expect(legacy.rolled_up_from).toBeUndefined();
  });

  it("accumulates when more than one legacy SKU maps to the same final SKU", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-TN-15-K-BKGR-STR", { west_90d: 10 }),
      ccStatsRow("CC-TN-15-K-BKLG-STR", { west_90d: 20 }),
      ccStatsRow("CC-TNS-15-K-BKLG-STR", { west_90d: 5 }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    const final = rowBySku(data.rows, "CC-TNS-15-K-BKLG-STR");
    expect(final.west_90d).toBe(35);
    expect(final.rolled_up_from).toEqual(["CC-TN-15-K-BKGR-STR", "CC-TN-15-K-BKLG-STR"]);
  });

  it("adds the legacy SKU's available stock (West, East, Transit) to the final SKU, but not its back orders", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-CC-15-VWNB12-BKGR-STR", {
        total_stock: 38, west_stock: 32, west_available_stock: 32, fullerton_available_stock: 32,
        east_stock: 4, east_available_stock: 4, ttm_available_stock: 4, transit_stock: 2, back: -7,
      }),
      ccStatsRow("CC-CC-15-VWNB12-BKLG-STR", {
        total_stock: 25, west_stock: 21, west_available_stock: 21, fullerton_available_stock: 21,
        east_stock: 1, east_available_stock: 1, ttm_available_stock: 1, transit_stock: 3, back: -1,
      }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    expect(rowBySku(data.rows, "CC-CC-15-VWNB12-BKLG-STR")).toMatchObject({
      west_stock: 53, west_available_stock: 53, fullerton_available_stock: 53,
      east_stock: 5, east_available_stock: 5, ttm_available_stock: 5,
      transit_stock: 5, total_stock: 63, back: -1,
    });
    expect(rowBySku(data.rows, "CC-CC-15-VWNB12-BKGR-STR")).toMatchObject({
      west_available_stock: 32, east_available_stock: 4, transit_stock: 2, total_stock: 38, back: -7,
    });
  });

  it("plans the final SKU's inventory life and S.O.D against the combined stock", async () => {
    const sales = { west_90d: 90, west_60d: 60, west_30d: 30, west_15d: 15, west_7d: 7 };
    const finalOnly = ccStatsRow("CC-SS-15-K-BKLG-STR", { ...sales, total_stock: 10, west_available_stock: 10, total_avg_real: 1 });
    const withContainers = { ...baseQuery, includeContainers: true };
    repositoryMock.getStatsRows.mockResolvedValue([finalOnly]);
    const before = rowBySku((await DemandPlanningService.getDashboardData(withContainers)).data.rows, "CC-SS-15-K-BKLG-STR");

    repositoryMock.getStatsRows.mockResolvedValue([
      finalOnly,
      ccStatsRow("CC-SS-15-K-BKGR-STR", { total_stock: 100, west_available_stock: 100 }),
    ]);
    const after = rowBySku((await DemandPlanningService.getDashboardData(withContainers)).data.rows, "CC-SS-15-K-BKLG-STR");

    expect(after.total_stock).toBe(110);
    expect(after.sod! > before.sod!).toBe(true);
    expect(after.containers.Base.avail_qty).toBe(110);
    expect(after.containers.Base.inv_life!).toBeGreaterThan(before.containers.Base.inv_life!);
  });

  it("rolls the legacy SKU's historical stock total onto the final SKU on an As-of view", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-SS-15-K-BKGR-STR", { total_stock: 99, west_available_stock: 99, transit_stock: 2 }),
      ccStatsRow("CC-SS-15-K-BKLG-STR", { total_stock: 99, west_available_stock: 99, transit_stock: 3 }),
    ]);
    repositoryMock.getInventoryHistoryCoverage.mockResolvedValue({ min_date: "2026-03-28", max_date: "2026-10-01" });
    repositoryMock.getInventorySnapshotAsOf.mockResolvedValue([
      { master_sku: "CC-SS-15-K-BKGR-STR", snapshot_date: "2026-09-30", available_stock: 32, backorder: 0 },
      { master_sku: "CC-SS-15-K-BKLG-STR", snapshot_date: "2026-10-01", available_stock: 21, backorder: 0 },
    ]);

    const { data } = await DemandPlanningService.getDashboardData({ ...baseQuery, asOf: "2026-10-01" });
    const final = rowBySku(data.rows, "CC-SS-15-K-BKLG-STR");
    // 21 + 32 historical available, plus both SKUs' current transit (3 + 2).
    expect(final.total_stock).toBe(58);
    expect(final.west_available_stock).toBeNull();
    expect(rowBySku(data.rows, "CC-SS-15-K-BKGR-STR").total_stock).toBe(34);
  });

  it("raises the final SKU's daily average and pulls its S.O.D forward", async () => {
    const withoutLegacy = ccStatsRow("CC-SS-15-K-BKLG-STR", { total_stock: 100, west_90d: 90, west_60d: 60, west_30d: 30, west_15d: 15, west_7d: 7 });
    repositoryMock.getStatsRows.mockResolvedValue([withoutLegacy]);
    const before = rowBySku((await DemandPlanningService.getDashboardData(baseQuery)).data.rows, "CC-SS-15-K-BKLG-STR");

    repositoryMock.getStatsRows.mockResolvedValue([
      withoutLegacy,
      ccStatsRow("CC-SS-15-K-BKGR-STR", { west_90d: 90, west_60d: 60, west_30d: 30, west_15d: 15, west_7d: 7 }),
    ]);
    const after = rowBySku((await DemandPlanningService.getDashboardData(baseQuery)).data.rows, "CC-SS-15-K-BKLG-STR");

    expect(after.west_90d).toBe(before.west_90d * 2);
    // Not exactly double: the FBA and east averages carry a 0.01 floor each.
    expect(after.total_avg_real).toBeGreaterThan(before.total_avg_real);
    expect(after.total_stock).toBe(before.total_stock);
    expect(after.sod! < before.sod!).toBe(true);
  });

  it("leaves a legacy row alone when its final SKU has no row of its own", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CC-CP-15-N-BKGR-STR", { west_90d: 12, total_stock: 1 }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({ sku: "CC-CP-15-N-BKGR-STR", west_90d: 12, total_stock: 1 });
    expect(data.rows[0].rolled_up_from).toBeUndefined();
  });

  it("does not touch non-car-cover SKUs", async () => {
    repositoryMock.getStatsRows.mockResolvedValue([
      ccStatsRow("CA-SC-10-F-10-BK-1TO", { category_code: "SC", west_90d: 1993, fba_90d_sales: 60 }),
    ]);

    const { data } = await DemandPlanningService.getDashboardData(baseQuery);
    expect(data.rows[0]).toMatchObject({ sku: "CA-SC-10-F-10-BK-1TO", west_90d: 1993, fba_90d_sales: 60 });
    expect(data.rows[0].rolled_up_from).toBeUndefined();
  });
});

describe("DemandPlanningService.refreshStats — Step 0 velocity snapshot", () => {
  function primeHappyPath() {
    repositoryMock.getInventoryByWarehouse.mockResolvedValue([{ master_sku: "SKU-1" }]);
    repositoryMock.getOosEpisodes.mockResolvedValue([]);
    repositoryMock.getOosAgg.mockResolvedValue([]);
    repositoryMock.getOosLostDemandRaw.mockResolvedValue([]);
    repositoryMock.getCategoryChannelRatio.mockResolvedValue([]);
    repositoryMock.getSalesVelocity.mockResolvedValue([]);
    insertMissingProductsMock.mockResolvedValue({ inserted: 0 });
  }

  it("pulls the velocity snapshot (incremental) before aggregating sales from it", async () => {
    primeHappyPath();

    await DemandPlanningService.refreshStats({});

    expect(runVelocitySyncMock).toHaveBeenCalledTimes(1);
    expect(runVelocitySyncMock).toHaveBeenCalledWith(false);
    // The snapshot must be current before getSalesVelocity reads it.
    expect(runVelocitySyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      repositoryMock.getSalesVelocity.mock.invocationCallOrder[0],
    );
  });

  it("returns null without touching fc_stats when the lookup DB is unavailable", async () => {
    const { ServiceUnavailableError } = await import("@/lib/errors");
    runVelocitySyncMock.mockRejectedValue(new ServiceUnavailableError("Supabase lookup pool not available"));

    const result = await DemandPlanningService.refreshStats({});

    expect(result).toBeNull();
    expect(repositoryMock.getInventoryByWarehouse).not.toHaveBeenCalled();
    expect(repositoryMock.batchUpsert).not.toHaveBeenCalled();
  });

  it("waits for a concurrent Velocity-page sync to release the lock, then proceeds", async () => {
    vi.useFakeTimers();
    try {
      primeHappyPath();
      runVelocitySyncMock
        .mockRejectedValueOnce(new SyncInProgressErrorMock(10))
        .mockRejectedValueOnce(new SyncInProgressErrorMock(8))
        .mockResolvedValueOnce({ linkUpserted: 0, customUpserted: 0, linkDeleted: 0, customDeleted: 0 });

      const pending = DemandPlanningService.refreshStats({});
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(runVelocitySyncMock).toHaveBeenCalledTimes(3);
      expect(result?.velocitySnapshotStale).toBe(false);
      expect(repositoryMock.getSalesVelocity).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the deadline, computes from the existing snapshot and flags it stale", async () => {
    vi.useFakeTimers();
    try {
      primeHappyPath();
      runVelocitySyncMock.mockRejectedValue(new SyncInProgressErrorMock(null));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const pending = DemandPlanningService.refreshStats({});
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      const result = await pending;

      expect(result?.velocitySnapshotStale).toBe(true);
      expect(result?.velocityLinkUpserted).toBe(0);
      expect(repositoryMock.getSalesVelocity).toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows any other velocity sync failure so the job is marked failed", async () => {
    runVelocitySyncMock.mockRejectedValue(new Error("supabase timeout"));

    await expect(DemandPlanningService.refreshStats({})).rejects.toThrow("supabase timeout");
    expect(repositoryMock.batchUpsert).not.toHaveBeenCalled();
  });
});
