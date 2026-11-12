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
    total_stock: 10,
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

describe("a back order on a SKU with no recent sales", () => {
  /** The shape of the reported SKUs: stock gone, a real back order, and no
   *  sales in 30 days precisely because it has been unavailable. */
  function stalledRow(sku: string, back: number): DemandRow {
    return {
      sku,
      west_available_stock: 0,
      east_available_stock: 0,
      transit_stock: 0,
      total_stock: 0,
      back,
      total_avg_curr: 0,
      total_30d: 0,
      sod: null,
      containers: { "112-CA": { inbound_qty: 5 } },
    } as unknown as DemandRow;
  }

  it("shows the back order on the baseline instead of zero", () => {
    const chain = computeContainerChain(
      stalledRow("CC-CC-15-CHCM14-DGBK-STR", -2), containers, new Map(),
      "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    );
    expect(chain.get("Base")?.backorder).toBe(2);
  });

  it("nets it out against the first container, once", () => {
    const chain = computeContainerChain(
      stalledRow("CC-CC-15-CHCM14-DGBK-STR", -2), containers, new Map(),
      "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    );
    const first = chain.get("112-CA");
    // 5 inbound less the 2 owed, and the debt is settled rather than carried
    // forward into another order.
    expect(first?.avail_qty).toBe(3);
    expect(first?.open_orders).toBe(-2);
    expect(first?.backorder).toBe(0);
  });

  it("carries it through a container that does not ship the SKU", () => {
    // The second report: CC-CC-15-DOCA26-BKLG-STR read Back Order 0 from the
    // first container on, so the auto-fill for any later container, which
    // sizes against the previous container's back order, had nothing to ship.
    const twoContainers: ContainerMeta[] = [
      ...containers,
      { col: 2, name: "121-CA", eta: "2026-09-10", cbm_cap: 80, status: "draft" },
    ];
    const stalled = { ...stalledRow("CC-CC-15-DOCA26-BKLG-STR", -2), containers: {} } as DemandRow;
    const chain = computeContainerChain(
      stalled, twoContainers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    );
    expect(chain.get("112-CA")?.backorder).toBe(2);
    expect(chain.get("121-CA")?.backorder).toBe(2);
  });

  it("carries only what a short container leaves unpaid", () => {
    const stalled = { ...stalledRow("CC-CC-15-CHCM14-DGBK-STR", -4), containers: { "112-CA": { inbound_qty: 1 } } } as unknown as DemandRow;
    const chain = computeContainerChain(
      stalled, containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    );
    expect(chain.get("112-CA")?.backorder).toBe(3);
  });

  it("leaves a SKU with no back order at zero", () => {
    const chain = computeContainerChain(
      stalledRow("CC-CC-15-CHCM14-DGBK-STR", 0), containers, new Map(),
      "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    );
    expect(chain.get("Base")?.backorder).toBe(0);
    expect(chain.get("112-CA")?.avail_qty).toBe(5);
  });
});

describe("cleared Con. Qty override", () => {
  it("treats an override of null as zero rather than falling back to the server qty", () => {
    const overrides = new Map([["CC-CN-15-P-GR-1TO::112-CA", { inbound_qty: null }]]);
    const cleared = computeContainerChain(
      row("CC-CN-15-P-GR-1TO"), containers, overrides, "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    ).get("112-CA");
    const untouched = computeContainerChain(
      row("CC-CN-15-P-GR-1TO"), containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
    ).get("112-CA");

    // Base carries 10 forward; with the 5-unit order erased only those 10 remain.
    expect(cleared?.avail_qty).toBe(10);
    expect(untouched?.avail_qty).toBe(15);
  });
});

describe("floor mat back orders along the chain", () => {
  const chainFor = (salesStatus: DemandRow["sales_status"]) => computeContainerChain(
    { ...row("CA-FM-80-FM15116"), sales_status: salesStatus }, containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS,
  ).get("112-CA");

  it("accumulates a forecast shortfall for a full set and a 3rd Row", () => {
    // 15 available against 20 forecast sales over the 10 days: 5 short.
    expect(chainFor("1+2 Set")).toMatchObject({ avail_qty: 15, est_sales: 20, backorder: 5, carryover: 0 });
    expect(chainFor("3rd Row")?.backorder).toBe(5);
  });

  it("does not accumulate one for a 1st / 2nd Row component", () => {
    expect(chainFor("1st Row")).toMatchObject({ avail_qty: 15, est_sales: 20, backorder: 0 });
    expect(chainFor("2nd Row")?.backorder).toBe(0);
  });

  it("still carries a component's live back order until a container covers it", () => {
    const owing = { ...row("CA-FM-TX-80-T1-FD-F509"), sales_status: "1st Row" as const, total_stock: 0, back: -8 };
    const result = computeContainerChain(owing, containers, new Map(), "2026-08-17", DEFAULT_SEASONAL_FACTORS);
    expect(result.get("Base")?.backorder).toBe(8);
    // 5 arrive against 8 owed: 3 still owed, and no forecast sales added on top.
    expect(result.get("112-CA")).toMatchObject({ avail_qty: -3, backorder: 3 });
  });
});
