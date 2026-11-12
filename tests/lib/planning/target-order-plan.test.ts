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

  it("orders nothing when there is no capacity left", () => {
    const plan = planTargetOrders([sku("A"), sku("B")], 0);
    expect([...plan.qtyByKey.values()]).toEqual([0, 0]);
    expect(plan.required.skuCount).toBe(2);
  });
});
