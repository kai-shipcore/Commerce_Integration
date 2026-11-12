/**
 * Quantity planning behind the Demand Planning grid's automatic order dialogs
 * (fixed target days, and per-group target days by sales range).
 *
 * Each SKU is ordered up to `adjDaily * targetDays + backorder - remainingAtArrival`,
 * rounded up to its MOQ and order multiple. With a CBM capacity, every SKU's
 * target days are scaled down by the same share until the whole order fits,
 * so the container is spread across the SKUs rather than filled by whichever
 * ones come first. The previous version filled SKUs at full target in display
 * order and left everything after the capacity ran out blank. In that scaled
 * plan a need below the SKU's MOQ is skipped instead of rounded up, and any
 * capacity left is handed out by demand, highest first.
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

/**
 * @param roundUpToMoq When false (a capacity-limited plan), a need below the
 *   MOQ orders nothing instead of being rounded up to it.
 */
export function targetOrderQty(candidate: TargetOrderCandidate, scale = 1, roundUpToMoq = true): number {
  if (!Number.isFinite(candidate.targetDays) || candidate.targetDays <= 0) return 0;
  const step = Math.max(1, candidate.step || 1);
  const moq = Math.max(1, candidate.moq || 1);
  const need = candidate.adjDaily * candidate.targetDays * scale + candidate.backorder - candidate.remainingAtArrival;
  if (need <= 0) return 0;
  if (!roundUpToMoq && need < moq) return 0;
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
    // Short on capacity, a need below the MOQ is skipped rather than rounded
    // up. Rounding up spends the container on slow sellers that need a
    // fraction of their MOQ (a Seat Cover container has ~1,100 SKUs selling
    // 0.03 a day, each rounded up to 10) and leaves the fast sellers short.
    // It also makes every empty SKU jump from 0 to its MOQ at the same
    // scale, which collapses the scaling below to 0.
    const strictAt = (scale: number) => candidates.map((candidate) => targetOrderQty(candidate, scale, false));
    let lo = 0;
    let hi = 1;
    let next = full;
    if (cbmOf(strictAt(1)) <= capacity + EPS) {
      lo = 1;
    } else {
      // Quantity only grows with the scale, so the largest scale that fits
      // is a plain bisection.
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (cbmOf(strictAt(mid)) <= capacity + EPS) lo = mid;
        else hi = mid;
      }
      next = strictAt(hi);
    }
    targetScale = lo;
    quantities = strictAt(lo);

    // Back orders alone can still overflow. Trim what remains in order so
    // the result never exceeds capacity.
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

    // Spend what is left SKU by SKU, highest demand first: on the next step
    // of the scale (SKUs whose need just reached their MOQ), or, when every
    // need at or above MOQ already fits, on rounding the rest up to MOQ.
    const order = candidates
      .map((candidate, index) => ({ index, demand: candidate.adjDaily * Math.max(0, candidate.targetDays) }))
      .filter(({ index }) => next[index] > quantities[index])
      .sort((a, b) => b.demand - a.demand);
    for (const { index } of order) {
      const extra = (next[index] - quantities[index]) * candidates[index].cbmUnit;
      if (used + extra > capacity + EPS) continue;
      used += extra;
      quantities[index] = next[index];
    }
  }

  return {
    qtyByKey: new Map(candidates.map((candidate, index) => [candidate.key, quantities[index]])),
    required,
    targetScale,
  };
}
