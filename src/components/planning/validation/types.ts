/**
 * Code Guide:
 * Response shapes for /api/planning/validation and /api/planning/demand-patterns.
 *
 * Model versions are keys rather than fields. The grid carries one entry per
 * version present in the accuracy report, so a new model appears without this
 * file changing, and nothing is named after v11.
 */

export interface ValidationCell {
  segment: string;
  window: string;
  /** Pooled WAPE per model version, keyed by version name. */
  [version: string]: number | string | null | undefined;
  n_skus?: number;
  actual_units?: number;
  /** Percentage points, not a fraction: +1.0 means over-forecast by 1%. */
  bias_pct?: number;
  /** Current minus baseline. Negative means the current model is better. */
  delta?: number;
  winner?: string;
}

export interface ValidationHeadline {
  current: number;
  baseline: number;
  /** Fractional reduction in error against the baseline. */
  improvement: number;
  cells_won: number;
  cells_total: number;
}

export interface ValidationComparison {
  grid: ValidationCell[];
  versions: string[];
  current: string;
  baseline: string;
  windows: string[];
  headline: ValidationHeadline | null;
}

/** What the comparison can and cannot speak for. The unscored group is
 *  overwhelmingly SKUs promoted from intermittent, whose training start moves
 *  with every profiling run and so are ineligible at any fixed cutoff. */
export interface ValidationCoverage {
  served: number;
  scored: number;
  unscored: number;
  share: number;
}

export interface OutlierRow {
  unique_id: string;
  window: string;
  y_total_cur: number;
  wape_cur: number;
  wape_base: number;
  delta: number;
}

export interface RunRow {
  model_version: string;
  forecast_date: string;
  n_skus: number;
  n_weeks: number;
  forecast_units: number;
}

export interface PerformanceRow {
  model_version: string;
  forecast_date: string;
  segment: string;
  n_skus: number;
  weeks_scored: number;
  actual_units: number;
  pooled_wape: number;
  /** Percentage points, matching the evaluation module. */
  bias_pct: number;
}

export interface ValidationResponse {
  comparison: ValidationComparison;
  coverage: ValidationCoverage;
  outliers: { best: OutlierRow[]; worst: OutlierRow[] };
  over_time: {
    runs: RunRow[];
    performance: PerformanceRow[];
    last_complete_week: string;
  };
  final_test: { cutoff: string; evaluated: boolean };
}

/** Weekly demand split by whether the model forecasts the SKU. The
 *  `not_forecast` series is the intermittent tail: real revenue with no
 *  prediction behind it, so it is a fact about the business rather than about
 *  any model. `units` is the sum of the two. */
export interface WeeklyPoint {
  ds: string;
  forecast: number;
  not_forecast: number;
  units: number;
}

/** One backtest week. `actual` and `predicted` come from the same rows, so they
 *  cover the same SKUs by construction. `n_skus` is carried because that
 *  population is not constant: a SKU needs history reaching past a window's
 *  cutoff to be backtestable at all, so both lines step together at window
 *  boundaries. */
export interface TrendWeek {
  ds: string;
  actual: number;
  predicted: number;
  n_skus: number;
  lead: number;
}

export interface TrendBoundary {
  window: string;
  start: string;
  end: string;
  n_skus: number;
}

export interface DemandVsForecastResponse {
  weekly: TrendWeek[];
  forward: { ds: string; value: number }[];
  boundaries: TrendBoundary[];
  windows: string[];
  window: string;
  /** The span between the last scored week and the first forward week. Left
   *  empty on purpose: it is the quarantined final test window. */
  quarantine: { start: string; end: string | null } | null;
  sku_count: number;
  version: string | null;
}

export interface DemandPatternsResponse {
  weekly: WeeklyPoint[];
  concentration: { sku_share: number; n_skus: number; demand_share: number }[];
  segments: { group: string; n_skus: number; units: number }[];
  weeks: number;
}
