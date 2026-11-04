/**
 * Floor applied to the Demand Planning "T.Avg 현재" (total_avg_curr) by the
 * Min Sales page (shipcore.fc_sku_min_sales). Pure and client-safe.
 *
 * `applied` is true only when the minimum actually changed the value, so a SKU
 * registered at 2 that is selling 5 a day reads as calculated, not floored.
 */
export function applyMinTotalAvgCurr(calculated: number, minimum: number | null | undefined): { value: number; applied: boolean } {
  if (minimum === null || minimum === undefined || !Number.isFinite(minimum)) {
    return { value: calculated, applied: false };
  }
  if (calculated < minimum) return { value: minimum, applied: true };
  return { value: calculated, applied: false };
}
