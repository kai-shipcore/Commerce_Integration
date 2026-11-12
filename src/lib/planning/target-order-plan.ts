/**
 * Quantity planning behind the Demand Planning grid's automatic order dialogs
 * (fixed target days, and per-group target days by sales range).
 *
 * Each SKU is ordered up to `adjDaily * targetDays + backorder - remainingAtArrival`,
 * rounded up to its MOQ and order multiple. With a CBM capacity, every SKU's
 * target days are scaled down by the same share until the whole order fits,
 * so the container is spread across the SKUs rather than filled by whichever
 * ones come first. The previous version filled SKUs at full target in display
 * order and left everything after the capacity ran out blank.
 */

export type TargetOrderCandidate = {
  key: string;
  adjDaily: number;
  /** Already resolved (Replacing Soon applied). Non-finite or <= 0 orders nothing. */
  targetDays: number;
  backorder: number;
  remainingAtArrival: number;
  moq: number;
  step: number;
  cbmUnit: number;
};

export type TargetOrderPlan = {
  /** Planned quantity per candidate key; 0 when the SKU gets nothing. */
  qtyByKey: Map<string, number>;
  /** What the full target days call for, before any capacity limit. */
  required: { skuCount: number; qty: number; cbm: number };
  /** Share of the target days the plan covers: 1 = full target. */
  targetScale: number;
};

const EPS = 1e-9;

export function targetOrderQty(candidate: TargetOrderCandidate, scale = 1): number {
  if (!Number.isFinite(candidate.targetDays) || candidate.targetDays <= 0) return 0;
  const step = Math.max(1, candidate.step || 1);
  const moq = Math.max(1, candidate.moq || 1);
  const need = candidate.adjDaily * candidate.targetDays * scale + candidate.backorder - candidate.remainingAtArrival;
  if (need <= 0) return 0;
  return Math.ceil(Math.max(need, moq) / step) * step;
}

/**
 * @param capacityCbm CBM available to these candidates (after anything that
 *   stays in the container), or null for no limit.
 */
export function planTargetOrders(candidates: TargetOrderCandidate[], capacityCbm: number | null): TargetOrderPlan {
  const quantitiesAt = (scale: number) => candidates.map((candidate) => targetOrderQty(candidate, scale));
  const cbmOf = (quantities: number[]) =>
    quantities.reduce((sum, qty, index) => sum + qty * candidates[index].cbmUnit, 0);

  const full = quantitiesAt(1);
  const required = {
    skuCount: full.filter((qty) => qty > 0).length,
    qty: full.reduce((sum, qty) => sum + qty, 0),
    cbm: cbmOf(full),
  };

  let quantities = full;
  let targetScale = 1;
  if (capacityCbm != null && required.cbm > capacityCbm + EPS) {
    const capacity = Math.max(0, capacityCbm);
    // Quantity only grows with the scale, so the largest scale that fits is a
    // plain bisection.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (cbmOf(quantitiesAt(mid)) <= capacity + EPS) lo = mid;
      else hi = mid;
    }
    targetScale = lo;
    quantities = quantitiesAt(lo);

    // Back orders alone, or MOQ / order-multiple rounding at a near-zero
    // scale, can still overflow. Trim what remains in order so the result
    // never exceeds capacity.
    let used = 0;
    quantities = quantities.map((qty, index) => {
      if (qty <= 0) return 0;
      const candidate = candidates[index];
      const remaining = capacity - used;
      let planned = qty;
      if (planned * candidate.cbmUnit > remaining + EPS) {
        const step = Math.max(1, candidate.step || 1);
        const moq = Math.max(1, candidate.moq || 1);
        planned = candidate.cbmUnit > 0 ? Math.floor(remaining / candidate.cbmUnit / step) * step : 0;
        if (planned < moq) return 0;
      }
      used += planned * candidate.cbmUnit;
      return planned;
    });
  }

  return {
    qtyByKey: new Map(candidates.map((candidate, index) => [candidate.key, quantities[index]])),
    required,
    targetScale,
  };
}
