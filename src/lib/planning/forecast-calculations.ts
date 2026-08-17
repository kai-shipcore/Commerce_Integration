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
  return prev * 0.3 + real * 0.7;
}

export function fivePeriodThirtyDayAverage(
  sales90d: number,
  sales60d: number,
  sales30d: number,
  preorder30d: number,
  sales15d: number,
  sales7d: number,
): number {
  return Math.ceil(
    (
      sales90d / 90 * 30
      + sales60d / 60 * 30
      + sales30d
      + preorder30d
      + sales15d / 15 * 30
      + sales7d / 7 * 30
    ) / 5,
  );
}

export function weightedDailyAverage(
  sales90d: number,
  sales60d: number,
  sales30d: number,
  preorder30d: number,
  sales15d: number,
  sales7d: number,
  weights: SalesWindowWeights = DEFAULT_SALES_WINDOW_WEIGHTS,
): number {
  return Math.max(
    0.01,
    sales90d / 90 * weights.d90
      + sales60d / 60 * weights.d60
      + sales30d / 30 * weights.d30
      + preorder30d / 30 * weights.pre
      + sales15d / 15 * weights.d15
      + sales7d / 7 * weights.d7,
  );
}

export function inventoryLifeDays(carryover: number, dailyRate: number, seasonalFactor: number): number | null {
  const adjustedDailyRate = dailyRate * seasonalFactor;
  return adjustedDailyRate > 0 ? carryover / adjustedDailyRate : null;
}

/** Google Sheet BF (Base Back Order): no recent sales means no back order. */
export function baselineBackorderQty(availableQty: number, total30d: number): number {
  return total30d <= 0 ? 0 : Math.max(0, -availableQty);
}

/** Car Cover's source sheet suppresses back orders for the `-03-` SKU family. */
export function isCarCover03Sku(sku: string): boolean {
  const normalized = sku.toUpperCase();
  return normalized.startsWith("CC-") && normalized.includes("-03-");
}

export function sheetBaselineBackorderQty(sku: string, availableQty: number, total30d: number): number {
  return isCarCover03Sku(sku) ? 0 : baselineBackorderQty(availableQty, total30d);
}

/** Mirrors the sheet's Est. Sales formula for each container interval. */
export function sheetContainerEstimatedSales(
  sku: string,
  daysBetween: number,
  dailyRate: number,
  seasonalFactor: number,
  availableQty: number,
  inboundQty: number,
): number {
  const projectedSales = daysBetween * dailyRate * seasonalFactor;
  if (isCarCover03Sku(sku)) {
    return Math.min(projectedSales, Math.max(availableQty - inboundQty, 0));
  }
  return sku.toUpperCase().startsWith("CC-") && availableQty === 0 ? 0 : projectedSales;
}

export function sheetContainerBackorderQty(
  sku: string,
  total30d: number,
  estimatedSales: number,
  availableQty: number,
): number {
  if (isCarCover03Sku(sku) || total30d <= 0) return 0;
  return Math.max(0, estimatedSales - availableQty);
}
