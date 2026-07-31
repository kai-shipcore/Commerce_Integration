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

/** Series carry their segment and the client filters, matching the old chart,
 *  so switching segment does not refetch. Segments are taken as of each
 *  window's cutoff rather than from today's profile, so a pill selects the same
 *  population as the grid row of the same name. */
export interface TrendActual {
  ds: string;
  segment: string;
  y: number;
  n_skus: number;
}

/** One (week, lead) pair from the stored runs: what the run made `lead` weeks
 *  before this week said this week would be. A week appears once per run that
 *  covered it, which is what makes "most recent run" a choice. */
export interface TrendPredicted {
  ds: string;
  segment: string;
  yhat: number;
  lead: number;
  n_skus: number;
  forecast_date: string;
}

export interface TrendForward {
  ds: string;
  segment: string;
  yhat: number;
  v1: number | null;
  n_skus: number;
}

export interface DemandVsForecastResponse {
  actuals: TrendActual[];
  predicted: TrendPredicted[];
  forward: TrendForward[];
  segments: string[];
  leads: number[];
  last_complete_week: string | null;
  forward_run_date: string | null;
  /** How many runs the history store holds. Zero means `predicted` is empty
   *  because nothing has been served and scored yet, not because of a fault. */
  runs_stored: number;
  version: string | null;
  /** False for the LightGBM track, which emits a point forecast and no bands.
   *  Stated rather than inferred from missing fields, so the chart can say why
   *  there is no interval instead of quietly omitting one. */
  has_intervals: boolean;
}

export interface DemandPatternsResponse {
  weekly: WeeklyPoint[];
  concentration: { sku_share: number; n_skus: number; demand_share: number }[];
  segments: { group: string; n_skus: number; units: number }[];
  weeks: number;
}
