import { describe, expect, it } from "vitest";
import { computeContainerChain } from "@/lib/planning/chain-calc";
import { DEFAULT_SEASONAL_FACTORS } from "@/lib/planning/seasonal-factors";
import type { ContainerMeta, DemandRow } from "@/types/demand-planning";

const containers: ContainerMeta[] = [
  { col: 0, name: "Base", eta: "2026-08-17", cbm_cap: 0, status: "baseline" },
  { col: 1, name: "112-CA", eta: "2026-08-27", cbm_cap: 80, status: "packing_received" },
];

function row(sku: string): DemandRow {
  return {
    sku,
    west_available_stock: 10,
    east_available_stock: 0,
    transit_stock: 0,
    back: 0,
    total_avg_curr: 2,
    total_30d: 60,
    sod: "2026-08-22",
    containers: { "112-CA": { inbound_qty: 5 } },
  } as unknown as DemandRow;
}

describe("Car Cover sheet container chain", () => {
  it("caps -03- estimated sales and suppresses its back order", () => {
    const result = computeContainerChain(
      row("CC-CN-03-P-GR-1TO"), containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    ).get("112-CA");

    expect(result?.avail_qty).toBe(15);
    expect(result?.est_sales).toBe(10);
    expect(result?.backorder).toBe(0);
    expect(result?.carryover).toBe(5);
  });

  it("keeps the normal projection for other Car Cover SKUs", () => {
    const result = computeContainerChain(
      row("CC-CN-15-P-GR-1TO"), containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    ).get("112-CA");

    expect(result?.est_sales).toBe(20);
    expect(result?.backorder).toBe(5);
    expect(result?.carryover).toBe(0);
  });
});
