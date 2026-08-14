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
  /** bucket/history_length, collapsed to the vocabulary every other section
   *  reports in. Optional: this app and the API deploy independently, and a
   *  running API that predates the field should thin the breakdown rather than
   *  blank the section. */
  segment?: string;
  /** Units actually sold over the window. Both WAPEs below are divided by this,
   *  so `delta` is bounded by it: a small denominator lets the difference swing
   *  freely, which is why the list is filtered by volume before it is ranked. */
  y_total_cur: number;
  wape_cur: number;
  wape_base: number;
  delta: number;
}

/** Every scored SKU x window row, unranked.
 *
 *  The endpoint used to send the two ranked lists and nothing else, which fixed
 *  the minimum volume at whatever it had chosen. The threshold is a judgement,
 *  so it moves on the page, and the page therefore needs the pool rather than
 *  someone else's extract of it. 572 rows on the current report. */
export interface ValidationOutliers {
  rows: OutlierRow[];
  /** How many rows each list displays, not how many were sent. */
  top_n: number;
  default_min_units: number;
  /** Units across the unfiltered pool. The denominator for what share of scored
   *  demand a filtered list accounts for. */
  scored_units: number;
}

/** `week_of` is the training week a run was made from, W-MON labelled.
 *
 *  It was called `forecast_date` until the API renamed it on 2026-08-12. These
 *  three interfaces kept the old name for a day, which did not fail a type check
 *  because the payload is parsed as JSON and never structurally validated: the
 *  compiler was checking these declarations against nothing. */
export interface RunRow {
  model_version: string;
  week_of: string;
  n_skus: number;
  n_weeks: number;
  forecast_units: number;
}

export interface PerformanceRow {
  model_version: string;
  week_of: string;
  segment: string;
  n_skus: number;
  weeks_scored: number;
  actual_units: number;
  pooled_wape: number;
  /** Percentage points, matching the evaluation module. */
  bias_pct: number;
}

/** What the served version is, read off the registered model class rather than
 *  restated here, so the page cannot describe a version it is not serving.
 *  Null for a version with no registered class, which is the case for the V1
 *  spreadsheet baseline: a formula rather than a fitted model. */
export interface ModelCardMeta {
  version: string;
  description: string | null;
  /** Feature names per segment, for versions that fit one model per segment.
   *  Null for a single-model version. Raw names on purpose: they match the
   *  design doc and the experiment scripts. */
  features: { short: string[]; long: string[] } | null;
}

/** Where the figures on this page came from, and when.
 *
 *  Two dates because they answer different questions. `snapshot` is pinned, so
 *  the accuracy figures deliberately do not move week to week; a reader seeing
 *  the same numbers twice should know that is by design. `trained_through` is
 *  the served forecast's own training week, which does move, and the gap
 *  between them is how you see whether the model being validated is the one
 *  being served. */
export interface ValidationMeta {
  model: ModelCardMeta | null;
  snapshot: string | null;
  accuracy_computed: string | null;
  trained_through: string | null;
}

export interface ValidationResponse {
  meta: ValidationMeta;
  comparison: ValidationComparison;
  coverage: ValidationCoverage;
  outliers: ValidationOutliers;
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
  /** Training week of the run this prediction came from. Renamed from
   *  `forecast_date` on 2026-08-12; see the note above RunRow. */
  week_of: string;
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
  /** Which model version the predicted line is drawn from. Differs from
   *  `version` when the store holds nothing for the current model, which is the
   *  case while seeded sample runs are standing in for real ones. */
  history_version: string | null;
  /** False for the LightGBM track, which emits a point forecast and no bands.
   *  Stated rather than inferred from missing fields, so the chart can say why
   *  there is no interval instead of quietly omitting one. */
  has_intervals: boolean;
}

export interface DemandPatternsResponse {
  weekly: WeeklyPoint[];
  /** The breakpoints the curve is annotated with. Kept alongside `pareto`
   *  rather than derived from it: the curve is downsampled to ~200 points, so a
   *  figure read off it could sit a sample interval away from the true one, and
   *  this section states those figures in words. */
  concentration: { sku_share: number; n_skus: number; demand_share: number }[];
  /** Cumulative share of demand against cumulative share of SKUs, ranked by
   *  demand. Optional: this app and the forecast API deploy independently, so a
   *  running API that predates the curve must fall back rather than blank the
   *  section. */
  pareto?: { sku_pct: number; demand_pct: number }[];
  n_skus?: number;
  segments: { group: string; n_skus: number; units: number }[];
  weeks: number;
}
