import { describe, expect, it } from "vitest";
import { calcOrderQty, type SkuOrderInput } from "@/lib/planning/order-optimizer";

function sku(overrides: Partial<SkuOrderInput> = {}): SkuOrderInput {
  return {
    sku: "CC-CC-15-CHCM14-DGBK-STR",
    adj_daily: 0,
    cbm_per_unit: 0.031,
    moq: 1,
    order_multiple: 1,
    remaining_at_arrival: 0,
    backorder_at_arrival: 0,
    tier_bonus: 0,
    ...overrides,
  };
}

describe("calcOrderQty with no velocity", () => {
  it("orders nothing when there is no back order either", () => {
    expect(calcOrderQty(sku(), 60, 30)).toBe(0);
  });

  it("ships the back order even though there is no forecast to size against", () => {
    // These SKUs have been out of stock long enough that their sales — and so
    // their velocity — fell to zero. The back order is demand already placed.
    expect(calcOrderQty(sku({ backorder_at_arrival: 2 }), 60, 30)).toBe(2);
  });

  it("respects MOQ and the order multiple", () => {
    expect(calcOrderQty(sku({ backorder_at_arrival: 2, moq: 10 }), 60, 30)).toBe(10);
    expect(calcOrderQty(sku({ backorder_at_arrival: 7, order_multiple: 5 }), 60, 30)).toBe(10);
    expect(calcOrderQty(sku({ backorder_at_arrival: 2, moq: 10, order_multiple: 4 }), 60, 30)).toBe(12);
  });
});

describe("calcOrderQty with velocity is unchanged", () => {
  it("still returns nothing when inventory life already covers the target", () => {
    expect(calcOrderQty(
      sku({ adj_daily: 1, remaining_at_arrival: 1000 }), 60, 30,
    )).toBe(0);
  });

  it("still adds the back order on top of the forecast need", () => {
    const withoutBackorder = calcOrderQty(sku({ adj_daily: 1 }), 60, 30);
    const withBackorder = calcOrderQty(sku({ adj_daily: 1, backorder_at_arrival: 25 }), 60, 30);
    expect(withBackorder).toBe(withoutBackorder + 25);
  });
});
