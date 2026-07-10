import type { SeasonalFactors } from "./seasonal-factors";
import { DEFAULT_SALES_WINDOW_WEIGHTS, type SalesWindowWeights } from "./sales-window-weights";

const MONTH_KEYS_FC = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

export function projectInventoryLifeDays(
  carryover: number,
  dailyRate: number,
  startDateStr: string,
  seasonalFactors: SeasonalFactors,
  maxDays = 730,
): number | null {
  if (carryover <= 0) return 0;
  if (dailyRate <= 0) return null;

  let remaining = carryover;
  let date = new Date(startDateStr + "T00:00:00Z");
  let totalDays = 0;

  while (totalDays < maxDays) {
    const month = date.getUTCMonth();
    const factor = seasonalFactors[MONTH_KEYS_FC[month]] ?? 1;
    const adjRate = dailyRate * factor;

    const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeftInMonth = lastDayOfMonth - date.getUTCDate() + 1;
    const daysToCheck = Math.min(daysLeftInMonth, maxDays - totalDays);

    if (adjRate > 0) {
      const daysToDeplete = remaining / adjRate;
      if (daysToDeplete <= daysToCheck) {
        return totalDays + Math.ceil(daysToDeplete);
      }
      remaining -= adjRate * daysToCheck;
    }

    totalDays += daysToCheck;
    date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }

  return null;
}

export type ForecastCategoryCode = "SC" | "CC" | "FM";

export function forecastCategoryCodeForSku(sku: string): ForecastCategoryCode {
  const normalized = sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  return "SC";
}

export function currentDailyAverage(prev: number, real: number, _categoryCode?: ForecastCategoryCode): number {
  void _categoryCode;
  if (prev === 0) return real;
  const change = Math.abs((real - prev) / prev);
  if (change < 0.5) return prev * 0.1 + real * 0.9;
  return prev * 0.2 + real * 0.8;
}

export function fbmThirtyDayAverage(
  sales90d: number,
  sales60d: number,
  sales30d: number,
  preorder30d: number,
  sales15d: number,
  sales7d: number,
  weights: SalesWindowWeights = DEFAULT_SALES_WINDOW_WEIGHTS,
): number {
  return Math.ceil(
    sales90d / 90 * 30 * weights.d90
    + sales60d / 60 * 30 * weights.d60
    + sales30d * weights.d30
    + preorder30d * weights.pre
    + sales15d / 15 * 30 * weights.d15
    + sales7d / 7 * 30 * weights.d7
  );
}

export function inventoryLifeDays(carryover: number, dailyRate: number, seasonalFactor: number): number | null {
  const adjustedDailyRate = dailyRate * seasonalFactor;
  return adjustedDailyRate > 0 ? carryover / adjustedDailyRate : null;
}
