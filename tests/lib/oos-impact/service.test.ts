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

vi.mock("@/lib/oos-impact/repository", () => ({ OosImpactRepository: repositoryMock }));
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
  const baseRow = {
    master_sku: "SKU-1",
    channel: "Amazon FBA",
    oos_started_on: "2026-01-01",
    oos_days: 10,
    back_in_stock_on: "2026-01-11",
    days_since_restock: 40,
    baseline: "5.0",
    day0_30_avg: "4.0",
    day30_60_avg: null,
    day60_90_avg: null,
  };

  it("classifies as good when daysToRecovery is within 30 days", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{ ...baseRow, days_to_recovery: 20 }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].severity).toBe("good");
    expect(data[0].label).toBe("정상 회복");
  });

  it("classifies as warning when recovered but later than 30 days", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{ ...baseRow, days_to_recovery: 45 }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].severity).toBe("warning");
  });

  it("classifies as serious when not yet recovered but still within the horizon", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{ ...baseRow, days_since_restock: 50, days_to_recovery: null }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].severity).toBe("serious");
    expect(data[0].label).toBe("관찰중");
  });

  it("classifies as critical when never recovered past the horizon", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{ ...baseRow, days_since_restock: 91, days_to_recovery: null }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].severity).toBe("critical");
    expect(data[0].label).toBe("미회복");
  });

  it("rounds null day-window averages through as null", async () => {
    repositoryMock.getRecoveryRows.mockResolvedValue([{ ...baseRow, days_to_recovery: 20 }]);
    const { data } = await OosImpactService.getRecovery();
    expect(data[0].day30to60).toBeNull();
    expect(data[0].day60to90).toBeNull();
    expect(data[0].day0to30).toBe(4);
  });
});

describe("OosImpactService.getRecoveryDrilldown", () => {
  it("throws ValidationError when sku is missing", async () => {
    await expect(OosImpactService.getRecoveryDrilldown(null, "Amazon FBA", null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.findLatestEpisode).not.toHaveBeenCalled();
  });

  it("throws ValidationError when channel is missing", async () => {
    await expect(OosImpactService.getRecoveryDrilldown("SKU-1", null, null)).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when no resolved episode exists", async () => {
    repositoryMock.findLatestEpisode.mockResolvedValue(undefined);
    await expect(OosImpactService.getRecoveryDrilldown("SKU-1", "Amazon FBA", null)).rejects.toThrow(NotFoundError);
  });

  it("passes restockDate through to disambiguate the episode and builds the 7-point series", async () => {
    repositoryMock.findLatestEpisode.mockResolvedValue({ oos_started_on: "2026-01-01", back_in_stock_on: "2026-01-11" });
    repositoryMock.getDrilldownSeries.mockResolvedValue({
      pre1: "1.0", pre2: "2.0", baseline: "1.5", d15: "3.0", d30: "4.0", d60: "5.0", d90: "6.0",
    });

    const result = await OosImpactService.getRecoveryDrilldown("SKU-1", "Amazon FBA", "2026-01-11");

    expect(repositoryMock.findLatestEpisode).toHaveBeenCalledWith("SKU-1", "2026-01-11");
    expect(repositoryMock.getDrilldownSeries).toHaveBeenCalledWith("SKU-1", "Amazon FBA", "2026-01-01", "2026-01-11");
    expect(result).toEqual({
      points: [1, 2, 0, 3, 4, 5, 6],
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
