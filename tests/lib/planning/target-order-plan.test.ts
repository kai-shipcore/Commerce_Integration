import { describe, it, expect } from "vitest";
import { planTargetOrders, targetOrderQty, type TargetOrderCandidate } from "@/lib/planning/target-order-plan";

function sku(key: string, overrides: Partial<TargetOrderCandidate> = {}): TargetOrderCandidate {
  return {
    key,
    adjDaily: 10,
    targetDays: 60,
    backorder: 0,
    remainingAtArrival: 0,
    moq: 1,
    step: 1,
    cbmUnit: 0.1,
    ...overrides,
  };
}

describe("targetOrderQty", () => {
  it("orders the target-day need net of stock at arrival, rounded to MOQ and order multiple", () => {
    expect(targetOrderQty(sku("A", { remainingAtArrival: 100 }))).toBe(500);
    expect(targetOrderQty(sku("A", { adjDaily: 0.1, targetDays: 10, moq: 50 }))).toBe(50);
    expect(targetOrderQty(sku("A", { adjDaily: 1, targetDays: 33, step: 10 }))).toBe(40);
  });

  it("orders nothing without a positive need or target", () => {
    expect(targetOrderQty(sku("A", { remainingAtArrival: 1000 }))).toBe(0);
    expect(targetOrderQty(sku("A", { targetDays: 0 }))).toBe(0);
    expect(targetOrderQty(sku("A", { targetDays: Number.NaN }))).toBe(0);
  });
});

describe("planTargetOrders", () => {
  it("keeps full target quantities when there is no limit or they fit", () => {
    const candidates = [sku("A"), sku("B")];
    for (const capacity of [null, 1000]) {
      const plan = planTargetOrders(candidates, capacity);
      expect(plan.targetScale).toBe(1);
      expect([...plan.qtyByKey.values()]).toEqual([600, 600]);
    }
  });

  it("spreads a short capacity across every SKU instead of filling the first ones", () => {
    // 5 SKUs × 600 units × 0.1 CBM = 300 CBM needed, only 150 available.
    const candidates = ["A", "B", "C", "D", "E"].map((key) => sku(key));
    const plan = planTargetOrders(candidates, 150);
    const quantities = [...plan.qtyByKey.values()];

    expect(plan.required.cbm).toBeCloseTo(300);
    expect(plan.targetScale).toBeCloseTo(0.5, 2);
    expect(quantities.every((qty) => qty > 0)).toBe(true);
    expect(new Set(quantities).size).toBe(1);
    const cbm = quantities.reduce((sum, qty) => sum + qty * 0.1, 0);
    expect(cbm).toBeLessThanOrEqual(150 + 1e-9);
    expect(cbm).toBeGreaterThan(149);
  });

  it("scales target days, not quantities, so SKUs keep proportional coverage", () => {
    const plan = planTargetOrders([sku("FAST", { adjDaily: 20 }), sku("SLOW", { adjDaily: 5 })], 75);
    // Required: 1200 + 300 units = 150 CBM. Half the target days fit.
    expect(plan.qtyByKey.get("FAST")).toBe(600);
    expect(plan.qtyByKey.get("SLOW")).toBe(150);
  });

  it("never exceeds capacity, even when back orders alone overflow it", () => {
    const candidates = [sku("A", { backorder: 800 }), sku("B", { backorder: 800 })];
    const plan = planTargetOrders(candidates, 100);
    const cbm = [...plan.qtyByKey.values()].reduce((sum, qty) => sum + qty * 0.1, 0);
    expect(plan.targetScale).toBe(0);
    expect(cbm).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("skips needs below MOQ when short, instead of spending the container on rounded-up slow sellers", () => {
    // 100 empty SKUs with MOQ 50 at 0.1 CBM. Rounded up to MOQ, any positive
    // target puts all of them in at 500 CBM against 80 available, which used
    // to collapse the scale to 0 and hand out MOQs only.
    const candidates = Array.from({ length: 100 }, (_, i) =>
      sku(`S${i}`, { adjDaily: 0.1 + i * 0.01, targetDays: 90, moq: 50 }));
    const plan = planTargetOrders(candidates, 80);
    const quantities = candidates.map((candidate) => plan.qtyByKey.get(candidate.key) ?? 0);
    const cbm = quantities.reduce((sum, qty) => sum + qty * 0.1, 0);

    expect(plan.targetScale).toBeGreaterThan(0.5);
    expect(cbm).toBeLessThanOrEqual(80 + 1e-9);
    expect(cbm).toBeGreaterThan(70);
    expect(quantities.filter((qty) => qty > 0).every((qty) => qty >= 50)).toBe(true);
    // The fastest seller gets more than a bare MOQ; the slow half gets nothing.
    expect(quantities[99]).toBeGreaterThan(50);
    expect(quantities.slice(0, 50).every((qty) => qty === 0)).toBe(true);
  });

  it("rounds remaining needs up to MOQ, highest demand first, once every need at or above MOQ fits", () => {
    const plan = planTargetOrders([
      sku("BIG", { adjDaily: 1, targetDays: 100, moq: 10 }),     // 100 units, 10 CBM
      sku("SLOW", { adjDaily: 0.05, targetDays: 100, moq: 10 }), // 5 → MOQ 10, 1 CBM
      sku("SLOWER", { adjDaily: 0.02, targetDays: 100, moq: 10 }), // 2 → MOQ 10, 1 CBM
    ], 11.5);
    expect(plan.targetScale).toBe(1);
    expect([...plan.qtyByKey.values()]).toEqual([100, 10, 0]);
  });

  it("orders nothing when there is no capacity left", () => {
    const plan = planTargetOrders([sku("A"), sku("B")], 0);
    expect([...plan.qtyByKey.values()]).toEqual([0, 0]);
    expect(plan.required.skuCount).toBe(2);
  });
});
