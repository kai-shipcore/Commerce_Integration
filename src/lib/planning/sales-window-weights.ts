export const SALES_WINDOW_WEIGHTS_STORAGE_KEY = "planning-dashboard-sales-window-weights";

export const DEFAULT_SALES_WINDOW_WEIGHTS = {
  d90: 0.15,
  d60: 0.2,
  d30: 0.3,
  d15: 0.2,
  d7: 0.15,
  pre: 0,
};

export type SalesWindowWeights = typeof DEFAULT_SALES_WINDOW_WEIGHTS;
export type SalesWindowWeightKey = keyof SalesWindowWeights;

export const SALES_WINDOW_WEIGHT_FIELDS: Array<{ key: SalesWindowWeightKey; label: string }> = [
  { key: "d90", label: "90일" },
  { key: "d60", label: "60일" },
  { key: "d30", label: "30일" },
  { key: "d15", label: "15일" },
  { key: "d7", label: "7일" },
  { key: "pre", label: "Pre" },
];

export const SALES_WINDOW_WEIGHT_COLUMN_KEYS: Record<string, SalesWindowWeightKey> = {
  w90: "d90",
  w60: "d60",
  w30: "d30",
  w15: "d15",
  w7: "d7",
  wpre: "pre",
  e90: "d90",
  e60: "d60",
  e30: "d30",
  e15: "d15",
  e7: "d7",
  epre: "pre",
};

export function normalizeSalesWindowWeights(value: unknown): SalesWindowWeights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SALES_WINDOW_WEIGHTS;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(
    SALES_WINDOW_WEIGHT_FIELDS.map(({ key }) => [
      key,
      isValidWeight(stored[key]) ? stored[key] : DEFAULT_SALES_WINDOW_WEIGHTS[key],
    ]),
  ) as SalesWindowWeights;
}

export function loadSavedSalesWindowWeights(): SalesWindowWeights {
  if (typeof window === "undefined") return DEFAULT_SALES_WINDOW_WEIGHTS;
  try {
    return normalizeSalesWindowWeights(
      JSON.parse(window.localStorage.getItem(SALES_WINDOW_WEIGHTS_STORAGE_KEY) ?? "{}"),
    );
  } catch {
    return DEFAULT_SALES_WINDOW_WEIGHTS;
  }
}

export function salesWindowWeightsParam(weights: SalesWindowWeights): string {
  return encodeURIComponent(JSON.stringify(weights));
}

export function parseSalesWindowWeightsParam(value: string | null): SalesWindowWeights {
  if (!value) return DEFAULT_SALES_WINDOW_WEIGHTS;
  try {
    return normalizeSalesWindowWeights(JSON.parse(value));
  } catch {
    return DEFAULT_SALES_WINDOW_WEIGHTS;
  }
}

export function salesWindowWeightPercentLabel(value: number): string {
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function labelWithSalesWindowWeight(columnId: string, label: string, weights: SalesWindowWeights): string {
  const key = SALES_WINDOW_WEIGHT_COLUMN_KEYS[columnId];
  if (!key) return label;
  return `${label} · ${salesWindowWeightPercentLabel(weights[key])}`;
}

function isValidWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
