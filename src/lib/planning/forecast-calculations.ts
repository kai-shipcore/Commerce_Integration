export type ForecastCategoryCode = "SC" | "CC" | "FM";

export function forecastCategoryCodeForSku(sku: string): ForecastCategoryCode {
  const normalized = sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  return "SC";
}

export function currentDailyAverage(prev: number, real: number, _categoryCode?: ForecastCategoryCode): number {
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
): number {
  return Math.ceil((
    sales90d / 90 * 30
    + sales60d / 60 * 30
    + sales30d
    + preorder30d
    + sales15d / 15 * 30
    + sales7d / 7 * 30
  ) / 5);
}

export function inventoryLifeDays(carryover: number, dailyRate: number, seasonalFactor: number): number | null {
  const adjustedDailyRate = dailyRate * seasonalFactor;
  return adjustedDailyRate > 0 ? carryover / adjustedDailyRate : null;
}
