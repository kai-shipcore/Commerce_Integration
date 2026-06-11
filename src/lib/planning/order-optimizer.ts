export type GradientTier = { min_sales: number; bonus: number; tier: string };

export type SkuOrderInput = {
  sku: string;
  adj_daily: number;            // total_avg_curr * seasonalFactor
  cbm_per_unit: number;
  moq: number;
  order_multiple: number;
  remaining_at_arrival: number; // chainMap[sku][prevContainer].carryover
  backorder_at_arrival: number; // chainMap[sku][prevContainer].backorder
  tier_bonus: number;           // pre-computed from appropriate gradient
  use_gap_days?: boolean;       // CC=true (default), SC=false
};

export function getTier(daily: number, gradient: GradientTier[]): GradientTier {
  for (const g of gradient) {
    if (daily >= g.min_sales) return g;
  }
  return gradient[gradient.length - 1];
}

export function calcOrderQty(
  sku: SkuOrderInput,
  baseTarget: number,
  nextGapDays: number,
): number {
  const { adj_daily, moq, order_multiple: step, remaining_at_arrival: rem, backorder_at_arrival: bo } = sku;
  if (adj_daily <= 0) return 0;
  const target = baseTarget + sku.tier_bonus;
  const useGap = sku.use_gap_days !== false;

  const availIfNoOrder = bo > 0 ? -bo : rem;
  const invLifeNow = useGap ? availIfNoOrder / adj_daily - nextGapDays : availIfNoOrder / adj_daily;
  if (invLifeNow >= target) return 0;

  let need = useGap
    ? (target + nextGapDays) * adj_daily - rem
    : target * adj_daily - rem;
  if (bo > 0) need += bo;
  if (need <= 0) return 0;

  return Math.ceil(Math.max(need, moq) / step) * step;
}

export function calcTotalCbm(
  baseTarget: number,
  skus: SkuOrderInput[],
  nextGapDays: number,
): number {
  let total = 0;
  for (const s of skus) {
    total += calcOrderQty(s, baseTarget, nextGapDays) * s.cbm_per_unit;
  }
  return total;
}

export function findOptimalBaseTarget(
  skus: SkuOrderInput[],
  targetCbm: number,
  nextGapDays: number,
): number {
  if (targetCbm <= 0) return 0;
  let lo = 0;
  let hi = 180;
  let best = 0;
  for (let i = 0; i < 500; i++) {
    const mid = (lo + hi) / 2;
    const cbm = calcTotalCbm(mid, skus, nextGapDays);
    if (cbm <= targetCbm) {
      best = mid;
      lo = mid + 0.01;
    } else {
      hi = mid - 0.01;
    }
  }
  return best;
}

export function generateOrders(
  skus: SkuOrderInput[],
  baseTarget: number,
  nextGapDays: number,
): Array<{ sku: string; qty: number; cbm: number }> {
  const results: Array<{ sku: string; qty: number; cbm: number }> = [];
  for (const s of skus) {
    const qty = calcOrderQty(s, baseTarget, nextGapDays);
    if (qty > 0) results.push({ sku: s.sku, qty, cbm: qty * s.cbm_per_unit });
  }
  return results;
}
