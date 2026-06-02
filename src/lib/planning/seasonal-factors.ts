export const SEASONAL_FACTORS_STORAGE_KEY = "planning-dashboard-seasonal-factors";

export const DEFAULT_SEASONAL_FACTORS = {
  jan: 0.75,
  feb: 0.8,
  mar: 0.9,
  apr: 0.95,
  may: 1,
  jun: 1,
  jul: 1,
  aug: 1,
  sep: 1,
  oct: 1.1,
  nov: 1.25,
  dec: 1.3,
};

export type SeasonalFactors = typeof DEFAULT_SEASONAL_FACTORS;
export type SeasonalFactorKey = keyof SeasonalFactors;

export const SEASONAL_FACTOR_FIELDS: Array<{ key: SeasonalFactorKey; label: string }> = [
  { key: "jan", label: "Jan" },
  { key: "feb", label: "Feb" },
  { key: "mar", label: "Mar" },
  { key: "apr", label: "Apr" },
  { key: "may", label: "May" },
  { key: "jun", label: "Jun" },
  { key: "jul", label: "Jul" },
  { key: "aug", label: "Aug" },
  { key: "sep", label: "Sep" },
  { key: "oct", label: "Oct" },
  { key: "nov", label: "Nov" },
  { key: "dec", label: "Dec" },
];

const MONTH_KEYS: SeasonalFactorKey[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const LEGACY_MAY_SEP_KEYS = new Set<SeasonalFactorKey>(["may", "jun", "jul", "aug", "sep"]);

export function seasonalFactorForEta(eta: string, factors: SeasonalFactors): number {
  const month = Number(eta.slice(5, 7));
  return factors[MONTH_KEYS[month - 1]] ?? 1;
}

export function loadSavedSeasonalFactors(): SeasonalFactors {
  if (typeof window === "undefined") return DEFAULT_SEASONAL_FACTORS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEASONAL_FACTORS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const legacyMaySep = isValidFactor(stored.maySep) ? stored.maySep : undefined;
    return Object.fromEntries(
      SEASONAL_FACTOR_FIELDS.map(({ key }) => [
        key,
        isValidFactor(stored[key])
          ? stored[key]
          : LEGACY_MAY_SEP_KEYS.has(key) && legacyMaySep !== undefined
            ? legacyMaySep
            : DEFAULT_SEASONAL_FACTORS[key],
      ]),
    ) as SeasonalFactors;
  } catch {
    return DEFAULT_SEASONAL_FACTORS;
  }
}

function isValidFactor(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
