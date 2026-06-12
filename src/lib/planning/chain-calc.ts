import { inventoryLifeDays } from "./forecast-calculations";
import { seasonalFactorForEta, type SeasonalFactors } from "./seasonal-factors";
import type { ContainerMeta, DemandRow } from "@/types/demand-planning";

export type ChainDerived = {
  open_orders: number | null;
  avail_qty: number | null;
  est_sales: number | null;
  backorder: number | null;
  carryover: number | null;
  inv_life: number | null;
  est_sod: string | null;
  plan_sod: string | null;
};

export function computeContainerChain(
  row: DemandRow,
  cons: ContainerMeta[],
  overrides: Map<string, { inbound_qty: number | null }>,
  todayStr: string,
  seasonalFactors: SeasonalFactors,
): Map<string, ChainDerived> {
  const result = new Map<string, ChainDerived>();

  const effectiveTotal = row.stock_mode === 'available'
    ? ((row.west_available_stock ?? 0) + (row.east_available_stock ?? 0) + (row.transit_stock ?? 0))
    : (row.total_stock ?? 0);
  const availQty  = effectiveTotal + (row.back ?? 0);
  const carryover = availQty >= 0 ? availQty : 0;
  const dailyRate = row.total_avg_curr ?? 0;

  let prevCarryover = carryover;
  let prevBackorder = availQty < 0 ? Math.abs(availQty) : 0;
  let prevSod: string | null = row.sod;
  let prevEta = todayStr;
  let cumulativeAvailQty = availQty;
  const baseline = cons[0];
  const baselineSeasonalFactor = seasonalFactorForEta(baseline?.eta ?? todayStr, seasonalFactors);
  const baselineInventoryLife = inventoryLifeDays(carryover, dailyRate, baselineSeasonalFactor);
  const baselinePlanSod = baselineInventoryLife === null
    ? null
    : new Date(new Date(baseline?.eta ?? todayStr).getTime() + baselineInventoryLife * 86400000).toISOString().slice(0, 10);

  if (baseline) {
    result.set(baseline.name, {
      open_orders: 0,
      avail_qty: availQty,
      est_sales: 0,
      backorder: prevBackorder,
      carryover,
      inv_life: baselineInventoryLife,
      est_sod: row.sod,
      plan_sod: baselinePlanSod,
    });
  }

  for (const c of cons.slice(1)) {
    const eKey = `${row.sku}::${c.name}`;
    const ov = overrides.get(eKey);
    const rawData = row.containers?.[c.name];
    const qty = ov !== undefined ? (ov.inbound_qty ?? 0) : (rawData?.inbound_qty ?? 0);
    const eta = c.eta ?? todayStr;
    cumulativeAvailQty += qty;

    const openOrders = prevCarryover > 0 ? 0 : (prevBackorder > qty ? -qty : -prevBackorder);
    const availQtyC  = Math.round(prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder);

    const daysBetween = Math.round(
      (new Date(eta).getTime() - new Date(prevEta).getTime()) / 86400000
    );
    const seasonalFactor = seasonalFactorForEta(eta, seasonalFactors);
    const estSales   = Math.round(daysBetween * dailyRate * seasonalFactor);
    const backorderC = Math.max(0, Math.round(estSales - availQtyC));
    const carryoverC = backorderC >= 1 ? 0 : Math.max(0, Math.round(availQtyC - estSales));
    const invLifeC   = inventoryLifeDays(carryoverC, dailyRate, seasonalFactor);
    const adjustedRate = dailyRate * seasonalFactor;
    const invLifeFloor = adjustedRate > 0 ? Math.floor(carryoverC / adjustedRate) : null;

    const sodFromThis = invLifeFloor !== null
      ? new Date(new Date(eta).getTime() + invLifeFloor * 86400000).toISOString().slice(0, 10)
      : null;
    const estSodC: string | null = (!qty || carryoverC === 0)
      ? prevSod
      : prevSod && sodFromThis ? (prevSod > sodFromThis ? prevSod : sodFromThis) : (sodFromThis ?? prevSod);

    result.set(c.name, {
      open_orders: openOrders,
      avail_qty:   cumulativeAvailQty,
      est_sales:   estSales,
      backorder:   backorderC,
      carryover:   carryoverC,
      inv_life:    invLifeC,
      est_sod:     estSodC,
      plan_sod:    sodFromThis,
    });

    prevCarryover = carryoverC;
    prevBackorder = backorderC;
    prevSod       = estSodC;
    prevEta       = eta;
  }

  return result;
}
