/**
 * Code Guide:
 * Response shapes for /api/planning/action-list.
 *
 * These mirror the columns src/planning/calc.py produces in the forecasting
 * repo. They are written out rather than loosened to Record<string, unknown> so
 * that a column renamed on the Python side becomes a TypeScript error here
 * rather than a silently blank cell in the table.
 */

/** One forecastable SKU with its order recommendation and the inputs to it. */
export interface ActionListRow {
  unique_id: string;
  product_name: string | null;
  product_category: string | null;
  history_group: "short" | "long" | string;

  // Position: what is here, owed, and on its way.
  available_inventory: number;
  preorder_backlog: number;
  confirmed_inbound: number;
  inbound_eta: string | null;
  transit_stock: number | null;

  // Demand: what has sold recently and what is forecast.
  recent_units: number;
  avg_daily_sales: number;
  forecast_total: number;
  forecast_per_week: number | null;

  // Action: when it runs out and what to buy.
  days_to_stockout: number | null;
  estimated_stockout_date: string | null;
  coverage_demand: number;
  safety_stock: number;
  inbound_in_window: number;
  recommended_order_qty: number;
  priority_label: string;

  // Confidence: how wrong this SKU's forecast has been, and on what basis.
  wape: number | null;
  tier: "good" | "fair" | "poor" | "none" | string;
  error_used: number;
  error_basis: "measured" | "promoted cohort" | "segment median" | string;
  n_windows: number;

  // Caveats.
  demand_state: "collapsing" | "falling" | "steady" | "rising" | "unknown" | string;
  forecast_runs_high: boolean;
  forecast_over_recent: number | null;
  forecast_excess: number | null;
  flags: string[];
}

export interface ActionListMetrics {
  forecasted_skus: number;
  preorder_priority: number;
  out_of_stock: number;
  best_sellers_at_risk: number;
  stockout_within_horizon: number;
  total_recommended_order_qty: number;
  horizon_days: number;
}

export interface ActionListMeta {
  sku_count: number;
  /** Size of the non-forecast section. Carried here so the toggle can label
   *  both halves without fetching that section, which is seven times larger and
   *  often never opened. */
  not_forecast_count: number;
  /** SKUs the forecast covered that segmentation has since demoted, and which
   *  are therefore absent from `rows`. Surfaced so totals can be reconciled
   *  against the forecast run rather than appearing quietly short. */
  demoted_since_forecast: number;
  trained_through: string | null;
  inventory_is_sample: boolean;
}

export interface ActionListParams {
  lead_time_weeks: number;
  review_period_weeks: number;
  service_z: number;
  stockout_horizon_days: number;
}

export const DEFAULT_PLANNING_PARAMS: ActionListParams = {
  lead_time_weeks: 8,
  review_period_weeks: 1,
  service_z: 1.0,
  stockout_horizon_days: 30,
};

/** Planning parameters as a query string.
 *
 *  Every figure on both screens is computed under these, so they travel in the
 *  URL rather than living in per-page state. Streamlit kept them in a sidebar
 *  that persisted across pages; here each page mounts independently, and
 *  without this the detail view answered at the default lead time while the row
 *  the user clicked answered at theirs, with nothing on screen to explain the
 *  difference. Carrying them in the URL also makes a shared link reproduce the
 *  assumptions it was computed under, which the sidebar never did.
 */
export function planningQuery(p: ActionListParams): string {
  return new URLSearchParams({
    lead_time_weeks: String(p.lead_time_weeks),
    review_period_weeks: String(p.review_period_weeks),
    service_z: String(p.service_z),
    stockout_horizon_days: String(p.stockout_horizon_days),
  }).toString();
}

/** Read planning parameters out of a URL, falling back per field.
 *  Values are clamped to the same bounds FastAPI enforces, so a hand-edited URL
 *  cannot produce a request the server will reject. */
export function planningParamsFrom(
  get: (key: string) => string | null | undefined,
): ActionListParams {
  const num = (key: string, fallback: number, lo: number, hi: number) => {
    const raw = get(key);
    const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  return {
    lead_time_weeks: num("lead_time_weeks", 8, 1, 52),
    review_period_weeks: num("review_period_weeks", 1, 1, 13),
    service_z: num("service_z", 1.0, 0, 4),
    stockout_horizon_days: num("stockout_horizon_days", 30, 1, 365),
  };
}

export interface ActionListResponse {
  params: ActionListParams;
  metrics: ActionListMetrics;
  rows: ActionListRow[];
  meta: ActionListMeta;
}

/** One SKU the model does not forecast.
 *
 *  Deliberately shares no column names with ActionListRow beyond identity and
 *  stock position. There is no coverage demand, safety stock, order quantity,
 *  stockout date or reliability tier, because none of those exist without a
 *  forecast. `days_of_cover` comes from a 13-week average rather than a scored
 *  model, and is named differently from anything on the forecast table so the
 *  two are not read as the same kind of figure. */
export interface NotForecastRow {
  unique_id: string;
  product_name: string | null;
  product_category: string | null;
  bucket: string;
  /** Units sold over the trailing window, and the rates implied by it. */
  recent_units: number;
  weekly_rate: number;
  daily_rate: number;
  last_sale_week: string | null;
  available_inventory: number | null;
  preorder_backlog: number | null;
  confirmed_inbound: number | null;
  inbound_eta: string | null;
  /** Null where nothing has sold recently: dividing by a zero rate would read
   *  as "never runs out" when the question simply does not apply. */
  days_of_cover: number | null;
  /** Stock runs out before a replacement could arrive. A statement about
   *  timing, not a quantity to buy. */
  reorder_signal: boolean;
  active_weeks: number | null;
  zero_pct: number | null;
}

export interface NotForecastMetrics {
  skus: number;
  selling: number;
  dormant: number;
  reorder_signal: number;
  out_of_stock: number;
  recent_units: number;
  lead_time_days: number;
}

export interface NotForecastResponse {
  params: ActionListParams;
  metrics: NotForecastMetrics;
  rows: NotForecastRow[];
  meta: { sku_count: number; window_weeks: number; inventory_is_sample: boolean };
}

/** One line of the order-quantity arithmetic.
 *  `Sign` is +1 add, -1 subtract, 0 the total line, null an aside shown for
 *  context but not part of the sum. It is carried explicitly rather than
 *  inferred from the value because a component of zero has a direction, and
 *  deriving it would render "+0" for something being subtracted. */
export interface OrderBreakdownLine {
  Component: string;
  Units: number;
  Sign: 1 | -1 | 0 | null;
}

/** One backtest window: what the model predicted over it against what happened. */
export interface BacktestWindow {
  unique_id: string;
  model_version: string;
  window: string;
  cutoff: string;
  bucket: string;
  history_length: string;
  yhat_total: number;
  y_total: number;
  ae: number;
  bias: number;
}

/** One predicted week inside a backtest window. `lead` is weeks after cutoff. */
export interface BacktestWeek {
  unique_id: string;
  model_version: string;
  window: string;
  cutoff: string;
  ds: string;
  lead: number;
  yhat: number;
  y: number;
}

export interface ForecastWeek {
  ds: string;
  yhat: number;
  /** Legacy spreadsheet baseline, kept for comparison. Null where V1 did not
   *  cover this SKU, which is normal and not an error. */
  v1_yhat: number | null;
}

export interface HistoryWeek {
  ds: string;
  y: number;
}

export interface SkuDetailResponse {
  params: ActionListParams;
  row: ActionListRow & {
    /** Mean weekly units over the last 4 weeks, on raw demand. The figure the
     *  runs-high callout compares the forecast against. */
    wa4: number | null;
  };
  flags: string[];
  order: {
    total: number;
    band: { low: number; high: number };
    breakdown: OrderBreakdownLine[];
  };
  history: HistoryWeek[];
  forecast: ForecastWeek[];
  backtest: {
    windows: BacktestWindow[];
    weekly: BacktestWeek[];
  };
}
