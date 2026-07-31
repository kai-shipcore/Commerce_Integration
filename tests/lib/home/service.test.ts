import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError, ServiceUnavailableError } from "@/lib/errors";

const repositoryMock = {
  isLookupAvailable: vi.fn(),
  getTrend: vi.fn(),
  getTotal: vi.fn(),
  getPrevQty: vi.fn(),
};

const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();

vi.mock("@/lib/home/repository", () => ({ HomeRepository: repositoryMock }));
vi.mock("@/lib/redis", () => ({ CacheManager: { get: cacheGetMock, set: cacheSetMock } }));

const { HomeService } = await import("@/lib/home/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomeService.getSalesTrend", () => {
  it("throws ValidationError when startDate/endDate are missing", async () => {
    await expect(HomeService.getSalesTrend({ startDate: null, endDate: "2026-01-31", prevStartDate: null, prevEndDate: null })).rejects.toThrow(
      ValidationError,
    );
  });

  it("returns cached data without querying the repository", async () => {
    cacheGetMock.mockResolvedValue({ trend: [], total: { quantity: 0, revenue: 0 }, growthPct: null });
    const result = await HomeService.getSalesTrend({ startDate: "2026-01-01", endDate: "2026-01-31", prevStartDate: null, prevEndDate: null });
    expect(result.cached).toBe(true);
    expect(repositoryMock.getTrend).not.toHaveBeenCalled();
  });

  it("throws ServiceUnavailableError when the lookup pool is down", async () => {
    cacheGetMock.mockResolvedValue(null);
    repositoryMock.isLookupAvailable.mockReturnValue(false);
    await expect(
      HomeService.getSalesTrend({ startDate: "2026-01-01", endDate: "2026-01-31", prevStartDate: null, prevEndDate: null }),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("computes growthPct against the previous period and caches the result", async () => {
    cacheGetMock.mockResolvedValue(null);
    repositoryMock.isLookupAvailable.mockReturnValue(true);
    repositoryMock.getTrend.mockResolvedValue([{ day: "2026-01-01", quantity: "3", revenue: "30" }]);
    repositoryMock.getTotal.mockResolvedValue({ quantity: "10", revenue: "100" });
    repositoryMock.getPrevQty.mockResolvedValue("8");

    const result = await HomeService.getSalesTrend({ startDate: "2026-01-01", endDate: "2026-01-31", prevStartDate: "2025-12-01", prevEndDate: "2025-12-31" });

    expect(result.cached).toBe(false);
    expect(result.data).toEqual({
      trend: [{ date: "2026-01-01", quantity: 3, revenue: 30 }],
      total: { quantity: 10, revenue: 100 },
      growthPct: 25,
    });
    expect(cacheSetMock).toHaveBeenCalled();
  });

  it("returns growthPct null when no previous period is given", async () => {
    cacheGetMock.mockResolvedValue(null);
    repositoryMock.isLookupAvailable.mockReturnValue(true);
    repositoryMock.getTrend.mockResolvedValue([]);
    repositoryMock.getTotal.mockResolvedValue({ quantity: "0", revenue: "0" });

    const result = await HomeService.getSalesTrend({ startDate: "2026-01-01", endDate: "2026-01-31", prevStartDate: null, prevEndDate: null });

    expect((result.data as { growthPct: unknown }).growthPct).toBeNull();
    expect(repositoryMock.getPrevQty).not.toHaveBeenCalled();
  });
});
