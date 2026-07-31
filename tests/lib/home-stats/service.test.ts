import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getCatDetail: vi.fn(),
  getLastSync: vi.fn(),
  getInboundContainers: vi.fn(),
  getSalesSince: vi.fn(),
  getSalesQtyBetween: vi.fn(),
  getCatTopCritical: vi.fn(),
  getDelayedContainers: vi.fn(),
};

const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();
const cacheDeleteMock = vi.fn();

vi.mock("@/lib/home-stats/repository", () => ({ HomeStatsRepository: repositoryMock }));
vi.mock("@/lib/redis", () => ({ CacheManager: { get: cacheGetMock, set: cacheSetMock, delete: cacheDeleteMock } }));

const { HomeStatsService } = await import("@/lib/home-stats/service");

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.getCatDetail.mockResolvedValue([]);
  repositoryMock.getLastSync.mockResolvedValue(null);
  repositoryMock.getInboundContainers.mockResolvedValue([]);
  repositoryMock.getSalesSince.mockResolvedValue({ qty: "0", revenue: "0" });
  repositoryMock.getSalesQtyBetween.mockResolvedValue({ qty: "0" });
  repositoryMock.getCatTopCritical.mockResolvedValue([]);
  repositoryMock.getDelayedContainers.mockResolvedValue([]);
  cacheGetMock.mockResolvedValue(null);
});

describe("HomeStatsService.getStats", () => {
  it("returns cached data without querying the repository", async () => {
    cacheGetMock.mockResolvedValue({ kpis: {} });
    const result = await HomeStatsService.getStats(false);
    expect(result.cached).toBe(true);
    expect(repositoryMock.getCatDetail).not.toHaveBeenCalled();
  });

  it("busts the cache key instead of reading it when bustCache is true", async () => {
    await HomeStatsService.getStats(true);
    expect(cacheDeleteMock).toHaveBeenCalledWith("home:planning-stats:v28");
    // The main response cache is never read on a bust — only the per-category
    // kpi-snap lookups (used for day-over-day deltas) still run.
    expect(cacheGetMock).not.toHaveBeenCalledWith("home:planning-stats:v28");
  });

  it("defaults every category to zeroed KPIs when no rows are returned", async () => {
    const result = await HomeStatsService.getStats(false);
    const data = result.data as { byCategoryFull: Record<string, { kpis: { criticalSku: number } }> };
    expect(data.byCategoryFull.fm.kpis.criticalSku).toBe(0);
    expect(data.byCategoryFull.cc.kpis.criticalSku).toBe(0);
    expect(data.byCategoryFull.sc.kpis.criticalSku).toBe(0);
  });

  it("computes deltas against yesterday's snapshot and persists today's", async () => {
    repositoryMock.getCatDetail.mockResolvedValue([
      { cat: "fm", critical_sku: "5", expected_oos: "0", overstock_sku: "0", urgent_po: "0", d0_30: "5", d30_60: "0", d60_180: "0", d180plus: "0", backorder: "0" },
    ]);
    cacheGetMock.mockImplementation((key: string) =>
      key.startsWith("home:kpi-snap:fm:") ? Promise.resolve({ criticalSku: 3, expectedOos: 0, overstockSku: 0, urgentPo: 0 }) : Promise.resolve(null),
    );

    const result = await HomeStatsService.getStats(false);
    const data = result.data as { byCategoryFull: Record<string, { kpis: { deltas: { criticalSku: number } } }> };

    expect(data.byCategoryFull.fm.kpis.deltas.criticalSku).toBe(2);
    expect(cacheSetMock).toHaveBeenCalledWith(
      expect.stringMatching(/^home:kpi-snap:fm:/),
      expect.objectContaining({ criticalSku: 5 }),
      48 * 60 * 60,
    );
  });

  it("computes sales growthPct against the prior 30-day window", async () => {
    repositoryMock.getSalesSince.mockResolvedValue({ qty: "150", revenue: "1500" });
    repositoryMock.getSalesQtyBetween.mockResolvedValue({ qty: "100" });

    const result = await HomeStatsService.getStats(false);
    const data = result.data as { sales30d: { units: number; revenue: number; growthPct: number } };

    expect(data.sales30d).toEqual({ units: 150, revenue: 1500, growthPct: 50 });
  });

  it("returns 0 growthPct when there were no sales in the prior period", async () => {
    const result = await HomeStatsService.getStats(false);
    const data = result.data as { sales30d: { growthPct: number } };
    expect(data.sales30d.growthPct).toBe(0);
  });

  it("sums per-category stock distributions into the global distribution", async () => {
    repositoryMock.getCatDetail.mockResolvedValue([
      { cat: "fm", critical_sku: "0", expected_oos: "0", overstock_sku: "0", urgent_po: "0", d0_30: "1", d30_60: "2", d60_180: "3", d180plus: "4", backorder: "0" },
      { cat: "cc", critical_sku: "0", expected_oos: "0", overstock_sku: "0", urgent_po: "0", d0_30: "10", d30_60: "0", d60_180: "0", d180plus: "0", backorder: "0" },
    ]);
    const result = await HomeStatsService.getStats(false);
    const data = result.data as { stockDistribution: { d0_30: number; d30_60: number; d60_180: number; d180plus: number } };
    expect(data.stockDistribution).toEqual({ d0_30: 11, d30_60: 2, d60_180: 3, d180plus: 4 });
  });
});
