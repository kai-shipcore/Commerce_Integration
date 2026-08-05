import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getTopSellers: vi.fn(),
  getRecoveryRows: vi.fn(),
  findLatestEpisode: vi.fn(),
  getDrilldownSeries: vi.fn(),
  getPreorderRows: vi.fn(),
};

const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();

vi.mock("@/lib/oos-impact/repository", () => ({
  OosImpactRepository: repositoryMock,
  DEFAULT_RECOVERY_THRESHOLD_PCT: 0.9,
  RECOVERY_HORIZON_DAYS: 90,
}));
vi.mock("@/lib/redis", () => ({ CacheManager: { get: cacheGetMock, set: cacheSetMock } }));

const { OosImpactService } = await import("@/lib/oos-impact/service");
const { ValidationError, NotFoundError } = await import("@/lib/errors");

beforeEach(() => {
  vi.clearAllMocks();
  cacheGetMock.mockResolvedValue(null);
});

describe("OosImpactService.getTopSellers", () => {
  it("returns cached data without querying the repository", async () => {
    cacheGetMock.mockResolvedValue([{ rank: 1, sku: "SKU-1", categoryCode: "CC", totalQty: 100, avgDaily: 3.3 }]);
    const { data, cached } = await OosImpactService.getTopSellers();
    expect(cached).toBe(true);
    expect(data).toHaveLength(1);
    expect(repositoryMock.getTopSellers).not.toHaveBeenCalled();
  });

  it("ranks rows by query order and computes avgDaily over 30 days", async () => {
    repositoryMock.getTopSellers.mockResolvedValue([
      { master_sku: "SKU-1", category_code: "CC", total_qty: "300" },
      { master_sku: "SKU-2", category_code: null, total_qty: "30" },
    ]);
    const { data, cached } = await OosImpactService.getTopSellers();
    expect(cached).toBe(false);
    expect(data).toEqual([
      { rank: 1, sku: "SKU-1", categoryCode: "CC", totalQty: 300, avgDaily: 10 },
      { rank: 2, sku: "SKU-2", categoryCode: null, totalQty: 30, avgDaily: 1 },
    ]);
    expect(cacheSetMock).toHaveBeenCalledWith("oos-top-sellers:sku-list:v1", data, 600);
  });
});

describe("OosImpactService.getRecovery", () => {
  // daysToRecovery is derived entirely from day0_30_avg/day30_60_avg/day60_90_avg
  // vs. baseline (the same Month 1/2/3 % shown in the table) — there is no
  // separate days_to_recovery field from the repository anymore, precisely so
  // the headline status can never disagree with those columns.
  const baseRow = {
    master_sku: "SKU-1",
    item_category: "Car Cover",
    oos_started_on: "2026-01-01",
    oos_days: 10,
    back_in_stock_on: "2026-01-11",
    days_since_restock: 40,
    baseline: "5.0",
    day0_30_avg: "4.5", // 90% of baseline — exactly at the default threshold
    day30_60_avg: null,
    day60_90_avg: null,
  };

  it("classifies as good when Month 1's average already reaches the threshold", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([baseRow]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].daysToRecovery).toBe(30);
    expect(data[0].severity).toBe("good");
    expect(data[0].label).toBe("정상 회복");
  });

  it("classifies as warning when only Month 2 reaches the threshold", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{
      ...baseRow, days_since_restock: 65, day0_30_avg: "2.0", day30_60_avg: "4.5",
    }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].daysToRecovery).toBe(60);
    expect(data[0].severity).toBe("warning");
    expect(data[0].label).toBe("느린 회복");
  });

  it("classifies as serious when no month has reached the threshold yet but still within the horizon", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{
      ...baseRow, days_since_restock: 50, day0_30_avg: "1.0", day30_60_avg: null,
    }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].daysToRecovery).toBeNull();
    expect(data[0].severity).toBe("serious");
    expect(data[0].label).toBe("관찰중");
  });

  it("classifies as critical when no month reaches the threshold past the horizon", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{
      ...baseRow, days_since_restock: 91, day0_30_avg: "1.0", day30_60_avg: "1.0", day60_90_avg: "1.0",
    }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].daysToRecovery).toBeNull();
    expect(data[0].severity).toBe("critical");
    expect(data[0].label).toBe("미회복");
  });

  it("rounds null day-window averages through as null", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([baseRow]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].day30to60).toBeNull();
    expect(data[0].day60to90).toBeNull();
    expect(data[0].day0to30).toBe(4.5);
  });

  it("computes month1/2/3 recovery % as a share of baseline, null when the window average is null", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([baseRow]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].month1Pct).toBe(90); // 4.5 / 5.0 * 100
    expect(data[0].month2Pct).toBeNull();
    expect(data[0].month3Pct).toBeNull();
  });
});

describe("OosImpactService.getRecoveryDrilldown", () => {
  it("throws ValidationError when sku is missing", async () => {
    await expect(OosImpactService.getRecoveryDrilldown(null, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.findLatestEpisode).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when no resolved episode exists", async () => {
    repositoryMock.findLatestEpisode.mockResolvedValue(undefined);
    await expect(OosImpactService.getRecoveryDrilldown("SKU-1", null)).rejects.toThrow(NotFoundError);
  });

  it("passes restockDate through to disambiguate the episode and rounds the daily trailing-average series", async () => {
    repositoryMock.findLatestEpisode.mockResolvedValue({ oos_started_on: "2026-01-01", back_in_stock_on: "2026-01-11" });
    repositoryMock.getDrilldownSeries.mockResolvedValue({
      baseline: "1.5",
      points: [
        { day_offset: -10, trailing_avg: "1.04", qty: "2" },
        { day_offset: 0, trailing_avg: "0", qty: "0" },
        { day_offset: 13, trailing_avg: "1.26", qty: "3" },
      ],
    });

    const result = await OosImpactService.getRecoveryDrilldown("SKU-1", "2026-01-11");

    expect(repositoryMock.findLatestEpisode).toHaveBeenCalledWith("SKU-1", "2026-01-11");
    expect(repositoryMock.getDrilldownSeries).toHaveBeenCalledWith("SKU-1", "2026-01-01", "2026-01-11");
    expect(result).toEqual({
      points: [
        { dayOffset: -10, value: 1, qty: 2 },
        { dayOffset: 0, value: 0, qty: 0 },
        { dayOffset: 13, value: 1.3, qty: 3 },
      ],
      baseline: 1.5,
      restockDate: "2026-01-11",
    });
  });
});

describe("OosImpactService.getPreorder", () => {
  it("returns cached data without querying the repository", async () => {
    cacheGetMock.mockResolvedValue([{ id: "x", sku: "SKU-1" }]);
    const { cached } = await OosImpactService.getPreorder();
    expect(cached).toBe(true);
    expect(repositoryMock.getPreorderRows).not.toHaveBeenCalled();
  });

  it("computes dropRate and severity, keeping negative drops (sales increased)", async () => {
    repositoryMock.getPreorderRows.mockResolvedValue([
      {
        master_sku: "SKU-1", item_category: "Car Cover", channel: "Coverland B2C",
        normal_start: "2026-01-01", normal_end: "2026-01-10", preorder_start: "2026-01-11", preorder_end: "2026-01-20",
        back_in_stock_on: null, window_days: 10, normal_qty: "100", preorder_qty: "200", stage: "active",
      },
    ]);
    const { data } = await OosImpactService.getPreorder();
    expect(data[0].normalDailyAverage).toBe(10);
    expect(data[0].preorderDailyAverage).toBe(20);
    expect(data[0].dropRate).toBe(-100);
    expect(data[0].severity).toBe("good");
    expect(data[0].id).toBe("SKU-1|Coverland B2C|2026-01-11");
  });

  it("classifies a full demand drop as critical", async () => {
    repositoryMock.getPreorderRows.mockResolvedValue([
      {
        master_sku: "SKU-1", item_category: "Miscellaneous", channel: "Icarcover",
        normal_start: "2026-01-01", normal_end: "2026-01-10", preorder_start: "2026-01-11", preorder_end: "2026-01-20",
        back_in_stock_on: "2026-01-21", window_days: 10, normal_qty: "100", preorder_qty: "0", stage: "ended",
      },
    ]);
    const { data } = await OosImpactService.getPreorder();
    expect(data[0].dropRate).toBe(100);
    expect(data[0].severity).toBe("critical");
  });
});
