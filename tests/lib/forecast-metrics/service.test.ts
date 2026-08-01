import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = {
  getLastRun: vi.fn(),
  getLastCompletedMonday: vi.fn(),
  getAccuracyRows: vi.fn(),
};

vi.mock("@/lib/forecast-metrics/repository", () => ({ ForecastMetricsRepository: repositoryMock }));

const { ForecastMetricsService } = await import("@/lib/forecast-metrics/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForecastMetricsService.getLastRun", () => {
  it("returns nulls when there is no run history", async () => {
    repositoryMock.getLastRun.mockResolvedValue(undefined);
    expect(await ForecastMetricsService.getLastRun()).toEqual({ run_date: null, horizon_weeks: null });
  });

  it("formats the run date and converts the bigint horizon", async () => {
    repositoryMock.getLastRun.mockResolvedValue({ run_date: new Date("2026-01-01T00:00:00Z"), horizon_weeks: BigInt(13) });
    const result = await ForecastMetricsService.getLastRun();
    expect(result).toEqual({ run_date: "2026-01-01T00:00:00.000Z", horizon_weeks: 13 });
  });
});

describe("ForecastMetricsService.getAccuracy", () => {
  it("returns empty metrics when there are no rows", async () => {
    repositoryMock.getLastCompletedMonday.mockResolvedValue("2026-07-27");
    repositoryMock.getAccuracyRows.mockResolvedValue([]);
    const result = await ForecastMetricsService.getAccuracy("SKU-1");
    expect(result).toEqual({ weeks: [], mae: null, mape: null, coverage: null });
  });

  it("computes MAE/MAPE excluding zero-actual weeks, and PI coverage", async () => {
    repositoryMock.getLastCompletedMonday.mockResolvedValue("2026-07-27");
    repositoryMock.getAccuracyRows.mockResolvedValue([
      { ds: "2026-01-01T00:00:00.000Z", yhat: "10", yhat_lo: "8", yhat_hi: "12", actual: "10" },
      { ds: "2026-01-08T00:00:00.000Z", yhat: "10", yhat_lo: "8", yhat_hi: "12", actual: "20" },
      { ds: "2026-01-15T00:00:00.000Z", yhat: "5", yhat_lo: null, yhat_hi: null, actual: "0" },
    ]);

    const result = await ForecastMetricsService.getAccuracy("SKU-1");

    expect(result.weeks).toHaveLength(3);
    expect(result.weeks[0].ds).toBe("2026-01-01");
    // mae over all 3 weeks: (0 + 10 + 5) / 3 = 5
    expect(result.mae).toBe(5);
    // mape over non-zero-actual weeks only: (0/10 + 10/20) / 2 * 100 = 25
    expect(result.mape).toBe(25);
    // coverage: 1 of 2 PI-bearing weeks falls within [yhat_lo, yhat_hi] -> 50%
    expect(result.coverage).toBe(50);
  });
});
