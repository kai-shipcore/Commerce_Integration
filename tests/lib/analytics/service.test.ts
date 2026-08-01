import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  countSkus: vi.fn(),
  countCollections: vi.fn(),
  findLowStockSkus: vi.fn(),
  getSalesAgg: vi.fn(),
  getTopSkus: vi.fn(),
  getRecentActivity: vi.fn(),
  getSalesTrend: vi.fn(),
};

const integrationsServiceMock = { listActiveIntegrations: vi.fn() };
const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();

vi.mock("@/lib/analytics/repository", () => ({ AnalyticsRepository: repositoryMock }));
vi.mock("@/lib/integrations/service", () => ({ IntegrationsService: integrationsServiceMock }));
vi.mock("@/lib/redis", () => ({ CacheManager: { get: cacheGetMock, set: cacheSetMock } }));

const { AnalyticsService } = await import("@/lib/analytics/service");

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.countSkus.mockResolvedValue(5);
  repositoryMock.countCollections.mockResolvedValue(2);
  repositoryMock.findLowStockSkus.mockResolvedValue([]);
  repositoryMock.getSalesAgg.mockResolvedValue({ qty: "0", revenue: "0", cnt: "0" });
  repositoryMock.getTopSkus.mockResolvedValue([]);
  repositoryMock.getRecentActivity.mockResolvedValue([]);
  repositoryMock.getSalesTrend.mockResolvedValue([]);
  integrationsServiceMock.listActiveIntegrations.mockResolvedValue([]);
  cacheGetMock.mockResolvedValue(null);
});

describe("AnalyticsService.getDashboard", () => {
  it("returns cached data without querying the repository", async () => {
    cacheGetMock.mockResolvedValue({ overview: {} });
    const result = await AnalyticsService.getDashboard({ period: "30d", startDate: null, endDate: null });
    expect(result.cached).toBe(true);
    expect(repositoryMock.countSkus).not.toHaveBeenCalled();
  });

  it("falls back to 0 active integrations when the integrations lookup throws", async () => {
    integrationsServiceMock.listActiveIntegrations.mockRejectedValue(new Error("boom"));
    const result = await AnalyticsService.getDashboard({ period: "30d", startDate: null, endDate: null });
    expect((result.data as { overview: { totalActiveIntegrations: number } }).overview.totalActiveIntegrations).toBe(0);
  });

  it("computes growthPercentage from 7-day vs 30-day averages", async () => {
    repositoryMock.getSalesAgg
      .mockResolvedValueOnce({ qty: "300", revenue: "3000", cnt: "30" }) // 30d: avg 10/day
      .mockResolvedValueOnce({ qty: "140", revenue: "1400", cnt: "14" }); // 7d: avg 20/day

    const result = await AnalyticsService.getDashboard({ period: "30d", startDate: null, endDate: null });
    const sales = (result.data as { sales: { growthPercentage: number } }).sales;
    expect(sales.growthPercentage).toBe(100);
  });

  it("returns 0 growthPercentage when the 30-day average is 0 (avoids divide-by-zero)", async () => {
    const result = await AnalyticsService.getDashboard({ period: "30d", startDate: null, endDate: null });
    const sales = (result.data as { sales: { growthPercentage: number } }).sales;
    expect(sales.growthPercentage).toBe(0);
  });

  it("uses a custom cache key and end-of-day end date for explicit startDate/endDate", async () => {
    await AnalyticsService.getDashboard({ period: null, startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(cacheGetMock).toHaveBeenCalledWith("dashboard:analytics:2026-01-01:2026-01-31");
  });

  it("falls back skuName to channel_sku when master_sku is missing in recent activity", async () => {
    repositoryMock.getRecentActivity.mockResolvedValue([
      { master_sku: null, channel_sku: "CH-1", platform_source: "shopify", order_date: "2026-01-01", quantity: "2" },
    ]);
    const result = await AnalyticsService.getDashboard({ period: "30d", startDate: null, endDate: null });
    const activity = (result.data as { recentActivity: Array<{ skuCode: string }> }).recentActivity;
    expect(activity[0].skuCode).toBe("CH-1");
  });
});
