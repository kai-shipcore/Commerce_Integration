/**
 * Business logic for forecast run metadata and backtest accuracy.
 * getAccuracy pins to the OLDEST forecast run with at least one completed
 * week (the backtest seed) rather than the latest production run, since a
 * shorter look-ahead would make accuracy look artificially good.
 */

import { ForecastMetricsRepository } from "@/lib/forecast-metrics/repository";

export interface LastRunResult {
  run_date: string | null;
  horizon_weeks: number | null;
}

export interface AccuracyWeek {
  ds: string;
  yhat: number;
  yhat_lo: number | null;
  yhat_hi: number | null;
  actual: number;
}

export interface AccuracyResult {
  weeks: AccuracyWeek[];
  mae: number | null;
  mape: number | null;
  coverage: number | null;
}

export const ForecastMetricsService = {
  async getLastRun(): Promise<LastRunResult> {
    const row = await ForecastMetricsRepository.getLastRun();
    if (!row || !row.run_date) {
      return { run_date: null, horizon_weeks: null };
    }

    return {
      run_date: row.run_date.toISOString(),
      horizon_weeks: row.horizon_weeks ? Number(row.horizon_weeks) : null,
    };
  },

  async getAccuracy(sku: string): Promise<AccuracyResult> {
    const lastMonday = await ForecastMetricsRepository.getLastCompletedMonday();
    const rows = await ForecastMetricsRepository.getAccuracyRows(sku, lastMonday);

    if (rows.length === 0) {
      return { weeks: [], mae: null, mape: null, coverage: null };
    }

    const weeks: AccuracyWeek[] = rows.map((r) => ({
      ds: r.ds.slice(0, 10),
      yhat: Number(r.yhat),
      yhat_lo: r.yhat_lo != null ? Number(r.yhat_lo) : null,
      yhat_hi: r.yhat_hi != null ? Number(r.yhat_hi) : null,
      actual: Number(r.actual),
    }));

    // Only compute metrics on weeks that actually have sales (exclude 0-sale weeks from MAPE)
    const nonZero = weeks.filter((w) => w.actual > 0);
    const mae = weeks.length > 0
      ? Math.round(weeks.reduce((s, w) => s + Math.abs(w.yhat - w.actual), 0) / weeks.length)
      : null;
    const mape = nonZero.length > 0
      ? Math.round(nonZero.reduce((s, w) => s + Math.abs(w.yhat - w.actual) / w.actual, 0) / nonZero.length * 100)
      : null;
    const coverage = weeks.filter((w) => w.yhat_lo != null).length > 0
      ? Math.round(
          weeks.filter((w) => w.yhat_lo != null && w.actual >= w.yhat_lo! && w.actual <= w.yhat_hi!).length /
          weeks.filter((w) => w.yhat_lo != null).length * 100,
        )
      : null;

    return { weeks, mae, mape, coverage };
  },
};
