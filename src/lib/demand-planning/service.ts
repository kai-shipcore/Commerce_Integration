/**
 * Business logic for the Demand Planning domain: assembling the dashboard's
 * per-SKU demand/supply chain projection (getDashboardData) and the "Sync"
 * stats-refresh pipeline (refreshStats).
 *
 * getDashboardData mirrors the original route's logic closely — this is
 * "demand vs supply matching" math (baseline + left-to-right chain
 * projection across containers), not something safe to redesign during a
 * layering pass. refreshStats similarly preserves the original's lack of a
 * DB transaction: each step is independently idempotent/re-runnable, so
 * wrapping it in one transaction would be a behavior change, not a cleanup.
 *
 * The `fc_pinned_rows` reference-row feature (PINNED_ROWS_ENABLED = false)
 * was dead code — always disabled, never reachable — and has been removed
 * rather than carried over into the service layer.
 */

import { getPlanningDashboardCache, setPlanningDashboardCache, invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { addSheetDays, planningLocalDateString } from "@/lib/planning/date-utils";
import {
  currentDailyAverage,
  fbmThirtyDayAverage,
  forecastCategoryCodeForSku,
  inventoryLifeDays,
} from "@/lib/planning/forecast-calculations";
import { DEFAULT_SEASONAL_FACTORS, seasonalFactorForEta } from "@/lib/planning/seasonal-factors";
import { parseSalesWindowWeightsParam, type SalesWindowWeights } from "@/lib/planning/sales-window-weights";
import {
  DEFAULT_SALES_WINDOW_WEIGHTS,
  normalizeSalesWindowWeights,
} from "@/lib/planning/sales-window-weights";
import {
  DEFAULT_OOS_LOST_DEMAND_WEIGHTS,
  normalizeOosLostDemandWeights,
  type CategoryKey,
  type OosLostDemandWeights,
} from "@/lib/planning/oos-lost-demand-weights";
import { OosImpactService } from "@/lib/oos-impact/service";
import { DemandPlanningRepository, type VelRow } from "@/lib/demand-planning/repository";
import type { ContainerMeta, ContainerRowData, DemandPlanningData, DemandRow } from "@/types/demand-planning";

// ─── Shared parsing helpers ─────────────────────────────────────────────

// Parses seat / no / color / tone from a master SKU string.
// CA-SC-{no}-{seat}-{size}-{color}-{tone}  e.g. CA-SC-10-F-10-BK-1TO
// CA-FM-{no}-{seat}-{size}-{color}          e.g. CA-FM-10-F-10-BK
function parseSku(sku: string): { seat: string; no: number; color: string; tone: string } {
  const p = sku.toUpperCase().split("-");
  if (p[0] === "CA" && p[1] === "SC" && p.length >= 6) {
    return { no: parseInt(p[2]) || 0, seat: p[3] ?? "", color: p[5] ?? "", tone: p[6] ?? "" };
  }
  if (p[0] === "CA" && p[1] === "FM" && p.length >= 5) {
    return { no: parseInt(p[2]) || 0, seat: p[3] ?? "", color: p[5] ?? "", tone: "" };
  }
  return { no: 0, seat: "", color: "", tone: "" };
}

function inferCategoryCode(sku: string): "SC" | "CC" | "FM" | "AC" | "SWC" {
  const normalized = sku.toUpperCase();
  if (normalized.includes("SWC")) return "SWC";
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

// DB status values for containers that have confirmed quantities.
const ACTIVE = `('shipped', 'packing_received')`;

export interface DashboardQuery {
  mode: "link" | "custom";
  includeContainers: boolean;
  rawContainers: boolean;
  includeDrafts: boolean;
  categoryCode: "SC" | "CC" | "FM" | "AC" | null;
  asOf: string | null;
  salesWeightsParam: string | null;
}

export interface DashboardResult {
  data: DemandPlanningData;
  cacheStatus: "HIT" | "MISS";
}

export const DemandPlanningService = {
  // Exposed standalone (not just as part of getDashboardData) for pages like
  // OOS Impact that trigger the same refreshStats pipeline via its "Sync"
  // button but don't otherwise need the full demand-planning dashboard payload.
  async getLastSync(): Promise<string | null> {
    return DemandPlanningRepository.getLastSync();
  },

  async getDashboardData(query: DashboardQuery): Promise<DashboardResult> {
    const inboundStatuses = query.includeDrafts ? "('shipped', 'packing_received', 'draft')" : ACTIVE;
    const todayDefault = planningLocalDateString();
    const todayStr = query.asOf && /^\d{4}-\d{2}-\d{2}$/.test(query.asOf) ? query.asOf : todayDefault;
    const isToday = todayStr === todayDefault;
    const salesWindowWeights = parseSalesWindowWeightsParam(query.salesWeightsParam);
    const salesWeightsCacheKey = encodeURIComponent(JSON.stringify(salesWindowWeights));

    const cached = await getPlanningDashboardCache(
      query.mode, query.includeContainers, isToday ? undefined : todayStr,
      query.includeDrafts, query.categoryCode ?? undefined, query.rawContainers, salesWeightsCacheKey,
    );
    if (cached) {
      return { data: (cached as { data: DemandPlanningData }).data, cacheStatus: "HIT" };
    }

    const filters = { mode: query.mode, categoryCode: query.categoryCode, inboundStatuses };

    const [containersResult, rowsResult, availStockResult, lastSync] = await Promise.all([
      DemandPlanningRepository.getContainerHeaders(query.categoryCode),
      DemandPlanningRepository.getStatsRows(filters),
      DemandPlanningRepository.getAvailableStockTotals(query.categoryCode),
      DemandPlanningRepository.getLastSync(),
    ]);

    const containerIds = containersResult.map((r) => r.id);
    const [categoriesResult, crossResult] = await Promise.all([
      DemandPlanningRepository.getContainerCategories(containerIds),
      query.includeContainers
        ? DemandPlanningRepository.getCrossData({ ...filters, rawContainers: query.rawContainers })
        : Promise.resolve([]),
    ]);

    const categoriesByContainer = new Map<number, string[]>();
    for (const row of categoriesResult) {
      const arr = categoriesByContainer.get(row.container_id) ?? [];
      arr.push(row.category_code);
      categoriesByContainer.set(row.container_id, arr);
    }

    const availStockMap = new Map<string, { remaining: number; mistake: number }>();
    for (const r of availStockResult) {
      const entry = availStockMap.get(r.master_sku) ?? { remaining: 0, mistake: 0 };
      if (r.source_type === "remaining") entry.remaining = parseInt(r.total_qty) || 0;
      if (r.source_type === "mistake") entry.mistake = parseInt(r.total_qty) || 0;
      availStockMap.set(r.master_sku, entry);
    }

    // ── Historical velocity (when asOf != today) ──────────────────────
    type VelEntry = VelRow & { _avg_curr: number; _east_curr: number; _fba_curr: number };
    const linkVelMap = new Map<string, VelEntry>();
    const customVelMap = new Map<string, VelEntry>();

    if (!isToday) {
      function buildVelEntry(r: VelRow): VelEntry {
        const categoryCode = forecastCategoryCodeForSku(r.master_sku);
        const wPrev = Number(r.avg_daily_prev);
        const wReal = Number(r.avg_daily_real);
        const ePrev = Number(r.east_avg_prev);
        const eReal = Number(r.east_avg_real);
        const fbaPrev = Number(r.fba_avg_prev ?? 0);
        const fbaReal = Number(r.fba_avg_real ?? 0);
        return {
          master_sku: r.master_sku,
          west_90d: Number(r.west_90d), west_60d: Number(r.west_60d), west_30d: Number(r.west_30d),
          west_15d: Number(r.west_15d), west_7d: Number(r.west_7d), west_30d_pre: Number(r.west_30d_pre),
          east_90d: Number(r.east_90d), east_60d: Number(r.east_60d), east_30d: Number(r.east_30d),
          east_15d: Number(r.east_15d), east_7d: Number(r.east_7d), east_30d_pre: Number(r.east_30d_pre),
          avg_daily_prev: wPrev, avg_daily_real: wReal,
          east_avg_prev: ePrev, east_avg_real: eReal,
          fba_avg_real: fbaReal, fba_avg_prev: fbaPrev,
          fba_30d: Number(r.fba_30d),
          _avg_curr: currentDailyAverage(wPrev, wReal, categoryCode),
          _east_curr: currentDailyAverage(ePrev, eReal, categoryCode),
          _fba_curr: currentDailyAverage(fbaPrev, fbaReal, categoryCode),
        };
      }

      const [linkVelRows, customVelRows] = await Promise.all([
        query.mode === "link" ? DemandPlanningRepository.getVelocitySnapshot("link", todayStr) : Promise.resolve([]),
        DemandPlanningRepository.getVelocitySnapshot("custom", todayStr),
      ]);
      for (const r of linkVelRows) linkVelMap.set(r.master_sku, buildVelEntry(r));
      for (const r of customVelRows) customVelMap.set(r.master_sku, buildVelEntry(r));
    }

    // ── Assemble response ──────────────────────────────────────────────

    const containers: ContainerMeta[] = [
      { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" },
      ...containersResult.map((r, i) => ({
        col: i + 1,
        container_id: r.id,
        name: r.name,
        eta: r.eta,
        cbm_cap: r.cbm_cap ?? 0,
        status: r.status,
        categories: categoriesByContainer.get(r.id) ?? [],
      })),
    ];

    containers[0] = { col: 0, name: "Base", eta: todayStr, cbm_cap: 0, status: "baseline" };
    const orderedContainers = containers.slice(1).sort((a, b) => {
      const aTime = a.eta ? new Date(a.eta).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.eta ? new Date(b.eta).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name);
    });
    containers.splice(1, containers.length - 1, ...orderedContainers.map((container, i) => ({
      ...container,
      col: i + 1,
    })));

    const crossMap = new Map<string, Map<string, ContainerRowData>>();
    for (const r of crossResult) {
      if (!crossMap.has(r.sku)) crossMap.set(r.sku, new Map());
      crossMap.get(r.sku)!.set(r.container_name, {
        item_id: r.item_id,
        cbm_unit: r.cbm_unit,
        inbound_qty: r.inbound_qty,
        allocated_remaining_qty: r.allocated_remaining_qty ?? 0,
        open_orders: r.open_orders,
        avail_qty: r.avail_qty,
        est_sales: r.est_sales,
        backorder: r.backorder,
        eta: r.eta,
        inv_life: r.inv_life,
        est_sod: r.est_sod,
        plan_sod: r.plan_sod,
        cbm: r.cbm,
      });
    }

    const rows: DemandRow[] = rowsResult.map((r) => {
      const masterSku = r.sku as string;
      const rowSku = masterSku;
      const { seat, no, color, tone } = parseSku(masterSku);
      const categoryCode = r.category_code === "SC" || r.category_code === "CC" || r.category_code === "FM" || r.category_code === "AC" || r.category_code === "SWC"
        ? r.category_code
        : inferCategoryCode(masterSku);

      const containerInfo = r.latest_container
        ? `${r.latest_eta ?? ""} - (${r.latest_container}) - ${r.latest_qty ?? ""}`
        : "";

      const skuCross = query.includeContainers ? crossMap.get(masterSku) : undefined;
      const containersObj: Record<string, ContainerRowData> = {};
      if (skuCross) {
        for (const [name, data] of skuCross) containersObj[name] = data;
      }

      const velSourceMap = (categoryCode === "CC" || categoryCode === "FM" || categoryCode === "SWC") ? customVelMap : linkVelMap;
      const vel = velSourceMap.get(masterSku);
      const west_90d = vel ? vel.west_90d : r.west_90d as number;
      const west_60d = vel ? vel.west_60d : r.west_60d as number;
      const west_30d = vel ? vel.west_30d : r.west_30d as number;
      const west_15d = vel ? vel.west_15d : r.west_15d as number;
      const west_7d = vel ? vel.west_7d : r.west_7d as number;
      const west_30d_pre = vel ? vel.west_30d_pre : r.west_30d_pre as number;
      const east_90d = vel ? vel.east_90d : r.east_90d as number;
      const east_60d = vel ? vel.east_60d : r.east_60d as number;
      const east_30d = vel ? vel.east_30d : r.east_30d as number;
      const east_15d = vel ? vel.east_15d : r.east_15d as number;
      const east_7d = vel ? vel.east_7d : r.east_7d as number;
      const east_30d_pre = vel ? vel.east_30d_pre : r.east_30d_pre as number;
      const avg_daily_prev = Math.max(0.01, vel ? vel.avg_daily_prev : r.avg_daily_prev as number);
      const avg_daily_real = Math.max(0.01, vel ? vel.avg_daily_real : r.avg_daily_real as number);
      const avg_daily_curr = Math.max(0.01, vel ? vel._avg_curr : r.avg_daily_curr as number);
      const east_avg_prev = Math.max(0.01, vel ? vel.east_avg_prev : r.east_avg_prev as number);
      const east_avg_real = Math.max(0.01, vel ? vel.east_avg_real : r.east_avg_real as number);
      // currentDailyAverage's categoryCode param is unused at runtime (kept for call-site symmetry);
      // categoryCode here can be AC/SWC too, which the narrower ForecastCategoryCode type doesn't include.
      const east_avg_curr = Math.max(0.01, vel ? vel._east_curr : currentDailyAverage(east_avg_prev, east_avg_real, categoryCode as "SC" | "CC" | "FM" | undefined));
      const fba_avg_prev = Math.max(0.01, vel ? vel.fba_avg_prev : r.fba_avg_prev as number);
      const fba_avg_real = Math.max(0.01, vel ? vel.fba_avg_real : r.fba_avg_real as number);
      const fba_avg_curr = Math.max(0.01, vel ? vel._fba_curr : r.fba_avg_curr as number);
      const fba_30d = vel ? vel.fba_30d : r.fba_30d as number;
      const oos_days_90d = (r.oos_days_90d as number | null) ?? null;
      const oos_lost_demand_90d = (r.oos_lost_demand_90d as number | null) ?? null;
      const west_fbm_30d = fbmThirtyDayAverage(west_90d, west_60d, west_30d, west_30d_pre, west_15d, west_7d, salesWindowWeights);
      const east_fbm_30d = fbmThirtyDayAverage(east_90d, east_60d, east_30d, east_30d_pre, east_15d, east_7d, salesWindowWeights);
      const total_30d = west_fbm_30d + east_fbm_30d + fba_30d;
      const total_avg_prev = Math.max(0.03, vel ? avg_daily_prev + east_avg_prev + fba_avg_prev : r.total_avg_prev as number);
      const total_avg_real = Math.max(0.03, vel ? avg_daily_real + east_avg_real + fba_avg_real : r.total_avg_real as number);
      const total_avg_curr = Math.max(0.03, vel ? avg_daily_curr + east_avg_curr + fba_avg_curr : r.total_avg_curr as number);

      const availQty = (r.total_stock as number) + (r.back as number);
      const carryover = availQty >= 0 ? availQty : 0;
      const dailyRate = total_avg_curr;
      const invLife = inventoryLifeDays(carryover, dailyRate, seasonalFactorForEta(todayStr, DEFAULT_SEASONAL_FACTORS));
      const asOfMs = new Date(todayStr).getTime();
      const rawAvgCurr = r.total_avg_curr as number;
      const sod_days_raw = (r.back as number) < 0
        ? -1
        : rawAvgCurr > 0
          ? Math.floor((r.total_stock as number) / rawAvgCurr)
          : 9999;
      const sod = (() => {
        const rate = total_avg_curr;
        if (!rate) return null;
        const days = Math.floor((r.total_stock as number) / rate);
        const d = new Date(asOfMs);
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
      })();
      const planSod = invLife !== null ? addSheetDays(todayStr, invLife) : null;

      if (!query.rawContainers) {
        containersObj["Base"] = {
          item_id: null, cbm_unit: null, inbound_qty: null,
          open_orders: 0, avail_qty: availQty, est_sales: 0,
          backorder: availQty < 0 ? Math.abs(availQty) : 0,
          carryover, eta: todayStr, inv_life: invLife,
          est_sod: sod, plan_sod: planSod, cbm: 0,
        };
      }

      if (!query.rawContainers && !containersObj.Base) {
        const baselineData = Object.values(containersObj).find((value) => value.eta === todayStr && value.est_sales === 0 && value.cbm === 0);
        if (baselineData) containersObj.Base = baselineData;
      }

      let prevCarryover = carryover;
      let prevBackorder = availQty < 0 ? Math.abs(availQty) : 0;
      let prevSod = sod;
      let prevEta = todayStr;

      for (const c of query.rawContainers ? [] : containers.slice(1)) {
        const raw = containersObj[c.name];
        if (!raw) continue;
        const qty = raw?.inbound_qty ?? 0;
        const eta = c.eta ?? todayStr;

        const openOrders = prevCarryover > 0 ? 0 : (prevBackorder > qty ? -qty : -prevBackorder);
        const availQtyC = prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder;

        const daysBetween = Math.round(
          (new Date(eta).getTime() - new Date(prevEta).getTime()) / 86400000,
        );
        const seasonalFactor = seasonalFactorForEta(eta, DEFAULT_SEASONAL_FACTORS);
        const estSales = daysBetween * dailyRate * seasonalFactor;
        const backorderC = total_30d <= 0 ? 0 : Math.max(0, estSales - availQtyC);
        const carryoverC = backorderC >= 1 ? 0 : Math.max(0, availQtyC - estSales);
        const invLifeC = inventoryLifeDays(carryoverC, dailyRate, seasonalFactor);

        const sodFromThis = invLifeC !== null ? addSheetDays(eta, invLifeC) : null;
        const estSodC: string | null = (!qty || carryoverC === 0)
          ? prevSod
          : sodFromThis === null
            ? null
            : (prevSod && prevSod > sodFromThis ? prevSod : sodFromThis);
        const planSodC = sodFromThis;

        containersObj[c.name] = {
          ...(raw ?? { item_id: null, cbm_unit: null, inbound_qty: null, cbm: 0, eta }),
          open_orders: openOrders,
          avail_qty: availQtyC,
          est_sales: estSales,
          backorder: backorderC,
          carryover: carryoverC,
          inv_life: invLifeC,
          est_sod: estSodC,
          plan_sod: planSodC,
        };

        prevCarryover = carryoverC;
        prevBackorder = backorderC;
        prevSod = estSodC;
        prevEta = eta;
      }

      return {
        container_info: containerInfo,
        cbm: (r.cbm_unit as number) ?? 0,
        cbm_per_unit: (r.cbm_per_unit as number) ?? 0,
        case_qty: (r.case_qty as number) ?? 1,
        moq: (r.moq as number) ?? 1,
        order_multiple: (r.order_multiple as number) ?? (r.moq as number) ?? 1,
        seat, no, color, tone,
        back: r.back as number,
        sales_status: (r.sales_status as "Original" | "Custom" | "Hold"),
        category_code: categoryCode,
        sku: rowSku,
        west_stock: r.west_stock,
        east_stock: r.east_stock,
        west_available_stock: r.west_available_stock,
        east_available_stock: r.east_available_stock,
        transit_stock: r.transit_stock,
        fullerton_stock: r.fullerton_stock,
        canary_stock: r.canary_stock,
        ttm_stock: r.ttm_stock,
        ttm_jeff_stock: r.ttm_jeff_stock,
        fullerton_available_stock: r.fullerton_available_stock,
        canary_available_stock: r.canary_available_stock,
        ttm_available_stock: r.ttm_available_stock,
        ttm_jeff_available_stock: r.ttm_jeff_available_stock,
        total_stock: r.total_stock,
        stock_mode: "available",
        west_90d, west_60d, west_30d, west_15d, west_7d, west_30d_pre,
        east_90d, east_60d, east_30d, east_15d, east_7d, east_30d_pre,
        avg_daily_prev: Math.round(avg_daily_prev * 100) / 100,
        avg_daily_real: Math.round(avg_daily_real * 100) / 100,
        avg_daily_curr: Math.round(avg_daily_curr * 100) / 100,
        east_avg_prev: Math.round(east_avg_prev * 100) / 100,
        east_avg_real: Math.round(east_avg_real * 100) / 100,
        east_avg_curr: Math.round(east_avg_curr * 100) / 100,
        fba_avg_prev: Math.round(fba_avg_prev * 100) / 100,
        fba_avg_real: Math.round(fba_avg_real * 100) / 100,
        fba_avg_curr: Math.round(fba_avg_curr * 100) / 100,
        west_fbm_30d, east_fbm_30d, fba_30d, total_30d,
        total_avg_prev: Math.round(total_avg_prev * 100) / 100,
        total_avg_real: Math.round(total_avg_real * 100) / 100,
        total_avg_curr: Math.round(total_avg_curr * 100) / 100,
        oos_days_90d, oos_lost_demand_90d,
        total_inbound_qty: r.total_inbound_qty as number | null,
        containers_list: (r.containers_list as string | null) ?? null,
        next_eta: (r.next_eta as string | null) ?? null,
        remaining: availStockMap.get(masterSku)?.remaining ?? 0,
        mistake: availStockMap.get(masterSku)?.mistake ?? 0,
        memo: (r.memo as string | null) ?? null,
        sod,
        sod_days_raw,
        containers: query.includeContainers ? containersObj : {},
      } as DemandRow;
    });

    const data: DemandPlanningData = { containers, rows, pinned_rows: [], last_sync: lastSync };
    const response = { success: true as const, data };
    setPlanningDashboardCache(
      query.mode, response, query.includeContainers, isToday ? undefined : todayStr,
      query.includeDrafts, query.categoryCode ?? undefined, query.rawContainers, salesWeightsCacheKey,
    );

    return { data, cacheStatus: "MISS" };
  },

  // ─── Stats refresh ("Sync" pipeline) ────────────────────────────────

  async refreshStats(rawWeights: { salesWindowWeights?: unknown; oosLostDemandWeights?: unknown }): Promise<{ inventoryUpserted: number; linkSalesUpserted: number; customSalesUpserted: number } | null> {
    const salesWindowWeights: SalesWindowWeights = rawWeights.salesWindowWeights
      ? normalizeSalesWindowWeights(rawWeights.salesWindowWeights)
      : DEFAULT_SALES_WINDOW_WEIGHTS;
    const oosLostDemandWeights: OosLostDemandWeights = rawWeights.oosLostDemandWeights
      ? normalizeOosLostDemandWeights(rawWeights.oosLostDemandWeights)
      : DEFAULT_OOS_LOST_DEMAND_WEIGHTS;

    // ── Step 1: Inventory ────────────────────────────────────────────
    const invRows = await DemandPlanningRepository.getInventoryByWarehouse();
    if (invRows === null) return null; // no lookup DB connection available

    const invCols = ["master_sku", "west_stock", "east_stock", "total_stock", "back", "west_available_stock", "east_available_stock", "fullerton_stock", "canary_stock", "ttm_stock", "ttm_jeff_stock", "fullerton_available_stock", "canary_available_stock", "ttm_available_stock", "ttm_jeff_available_stock"];
    const invUpdate = `west_stock                    = EXCLUDED.west_stock,
       east_stock                    = EXCLUDED.east_stock,
       total_stock                   = EXCLUDED.total_stock,
       back                          = EXCLUDED.back,
       west_available_stock          = EXCLUDED.west_available_stock,
       east_available_stock          = EXCLUDED.east_available_stock,
       fullerton_stock               = EXCLUDED.fullerton_stock,
       canary_stock                  = EXCLUDED.canary_stock,
       ttm_stock                     = EXCLUDED.ttm_stock,
       ttm_jeff_stock                = EXCLUDED.ttm_jeff_stock,
       fullerton_available_stock     = EXCLUDED.fullerton_available_stock,
       canary_available_stock        = EXCLUDED.canary_available_stock,
       ttm_available_stock           = EXCLUDED.ttm_available_stock,
       ttm_jeff_available_stock      = EXCLUDED.ttm_jeff_available_stock,
       calculated_at                 = NOW(),
       updated_at                    = NOW()`;
    await Promise.all([
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats", invRows, invCols, invUpdate),
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats_custom", invRows, invCols, invUpdate),
    ]);

    // ── Step 1b: OOS episodes ────────────────────────────────────────
    const oosEpisodeRows = (await DemandPlanningRepository.getOosEpisodes()).map((r) => ({
      master_sku: r.master_sku,
      oos_started_on: r.oos_started_on,
      back_in_stock_on: r.back_in_stock_on,
      synced_at: new Date(),
    })) as Record<string, unknown>[];
    await DemandPlanningRepository.batchUpsert(
      "shipcore.fc_inventory_history_snapshot",
      oosEpisodeRows,
      ["master_sku", "oos_started_on", "back_in_stock_on", "synced_at"],
      `back_in_stock_on = EXCLUDED.back_in_stock_on,
       synced_at        = EXCLUDED.synced_at`,
      ["master_sku", "oos_started_on"],
    );

    // ── Step 4: OOS days in the last 90 days ─────────────────────────
    const oosAggRows = (await DemandPlanningRepository.getOosAgg()) as Record<string, unknown>[];
    const oosAggCols = ["master_sku", "oos_days_90d"];
    const oosAggUpdate = `oos_days_90d = EXCLUDED.oos_days_90d, updated_at = NOW()`;
    await Promise.all([
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats", oosAggRows, oosAggCols, oosAggUpdate),
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats_custom", oosAggRows, oosAggCols, oosAggUpdate),
    ]);

    // ── Step 5: OOS lost demand ───────────────────────────────────────
    type CategoryRatioRow = { category_code: string; shopify_90d: number; amazon_90d: number; ebay_90d: number; walmart_90d: number };
    function autoWeightsByCategory(rows: CategoryRatioRow[]): Record<string, { amazon: number; ebay: number; walmart: number }> {
      const result: Record<string, { amazon: number; ebay: number; walmart: number }> = {};
      for (const row of rows) {
        const shopify90d = Math.max(Number(row.shopify_90d), 1);
        result[row.category_code] = {
          amazon: Number(row.amazon_90d) / shopify90d,
          ebay: Number(row.ebay_90d) / shopify90d,
          walmart: Number(row.walmart_90d) / shopify90d,
        };
      }
      return result;
    }
    type LostDemandRawRow = {
      master_sku: string; category_code: string; clipped_days: number;
      shopify_qty: number; amazon_qty: number; ebay_qty: number; walmart_qty: number;
    };
    function computeLostDemandBySku(
      rows: LostDemandRawRow[],
      autoWeights: Record<string, { amazon: number; ebay: number; walmart: number }>,
    ): Record<string, unknown>[] {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const cat: CategoryKey = row.category_code === "CC" ? "CC" : row.category_code === "FM" ? "FM" : row.category_code === "SWC" ? "SWC" : "SC";
        const override = oosLostDemandWeights[cat];
        const auto = autoWeights[cat] ?? { amazon: 0, ebay: 0, walmart: 0 };
        const wAmazon = override.amazon ?? auto.amazon;
        const wEbay = override.ebay ?? auto.ebay;
        const wWalmart = override.walmart ?? auto.walmart;
        const shopifyQty = Number(row.shopify_qty);
        const lostAmazon = Math.max(0, shopifyQty * wAmazon - Number(row.amazon_qty));
        const lostEbay = Math.max(0, shopifyQty * wEbay - Number(row.ebay_qty));
        const lostWalmart = Math.max(0, shopifyQty * wWalmart - Number(row.walmart_qty));
        totals.set(row.master_sku, (totals.get(row.master_sku) ?? 0) + lostAmazon + lostEbay + lostWalmart);
      }
      return Array.from(totals, ([master_sku, total]) => ({
        master_sku,
        oos_lost_demand_90d: Math.round(total * 100) / 100,
      }));
    }

    const [lostDemandLinkRows, lostDemandCustomRows, linkRatioRows, customRatioRows] = await Promise.all([
      DemandPlanningRepository.getOosLostDemandRaw("link"),
      DemandPlanningRepository.getOosLostDemandRaw("custom"),
      DemandPlanningRepository.getCategoryChannelRatio("link"),
      DemandPlanningRepository.getCategoryChannelRatio("custom"),
    ]);
    const lostDemandCols = ["master_sku", "oos_lost_demand_90d"];
    const lostDemandUpdate = `oos_lost_demand_90d = EXCLUDED.oos_lost_demand_90d, updated_at = NOW()`;
    await Promise.all([
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats", computeLostDemandBySku(lostDemandLinkRows, autoWeightsByCategory(linkRatioRows)), lostDemandCols, lostDemandUpdate),
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats_custom", computeLostDemandBySku(lostDemandCustomRows, autoWeightsByCategory(customRatioRows)), lostDemandCols, lostDemandUpdate),
    ]);

    // ── Step 2: Sales velocity ────────────────────────────────────────
    const planningDate = planningLocalDateString();
    await DemandPlanningRepository.zeroVelocityColumns();

    const [linkRows, customRows] = await Promise.all([
      DemandPlanningRepository.getSalesVelocity("link", planningDate),
      DemandPlanningRepository.getSalesVelocity("custom", planningDate),
    ]);

    const salesCols = [
      "master_sku", "sales_status",
      "west_90d", "west_60d", "west_30d", "west_15d", "west_7d", "west_30d_pre",
      "east_90d", "east_60d", "east_30d", "east_15d", "east_7d", "east_30d_pre",
      "avg_daily_real", "avg_daily_prev", "avg_daily_curr",
      "east_avg_real", "east_avg_prev", "east_avg_curr",
      "total_avg_prev", "total_avg_real", "total_avg_curr",
      "west_fbm_30d", "east_fbm_30d", "total_30d",
      "fba_avg_prev", "fba_avg_real", "fba_avg_curr", "fba_30d",
    ];
    const salesUpdateSet = `
      sales_status    = EXCLUDED.sales_status,
      west_90d        = EXCLUDED.west_90d,
      west_60d        = EXCLUDED.west_60d,
      west_30d        = EXCLUDED.west_30d,
      west_15d        = EXCLUDED.west_15d,
      west_7d         = EXCLUDED.west_7d,
      west_30d_pre    = EXCLUDED.west_30d_pre,
      east_90d        = EXCLUDED.east_90d,
      east_60d        = EXCLUDED.east_60d,
      east_30d        = EXCLUDED.east_30d,
      east_15d        = EXCLUDED.east_15d,
      east_7d         = EXCLUDED.east_7d,
      east_30d_pre    = EXCLUDED.east_30d_pre,
      avg_daily_real  = EXCLUDED.avg_daily_real,
      avg_daily_prev  = EXCLUDED.avg_daily_prev,
      avg_daily_curr  = EXCLUDED.avg_daily_curr,
      east_avg_real   = EXCLUDED.east_avg_real,
      east_avg_prev   = EXCLUDED.east_avg_prev,
      east_avg_curr   = EXCLUDED.east_avg_curr,
      total_avg_prev  = EXCLUDED.total_avg_prev,
      total_avg_real  = EXCLUDED.total_avg_real,
      total_avg_curr  = EXCLUDED.total_avg_curr,
      west_fbm_30d    = EXCLUDED.west_fbm_30d,
      east_fbm_30d    = EXCLUDED.east_fbm_30d,
      total_30d       = EXCLUDED.total_30d,
      fba_avg_prev    = EXCLUDED.fba_avg_prev,
      fba_avg_real    = EXCLUDED.fba_avg_real,
      fba_avg_curr    = EXCLUDED.fba_avg_curr,
      fba_30d         = EXCLUDED.fba_30d,
      calculated_at   = NOW(),
      updated_at      = NOW()`;

    for (const r of [...linkRows, ...customRows]) {
      const categoryCode = forecastCategoryCodeForSku(String(r.master_sku));
      const wPrev = Number(r.avg_daily_prev);
      const wReal = Number(r.avg_daily_real);
      const ePrev = Number(r.east_avg_prev);
      const eReal = Number(r.east_avg_real);
      const fbaPrev = Number(r.fba_avg_prev ?? 0);
      const fbaReal = Number(r.fba_avg_real ?? 0);
      const wCurr = currentDailyAverage(wPrev, wReal, categoryCode);
      const eCurr = currentDailyAverage(ePrev, eReal, categoryCode);
      const fbaCurr = currentDailyAverage(fbaPrev, fbaReal, categoryCode);

      r.avg_daily_prev = wPrev;
      r.avg_daily_real = wReal;
      r.east_avg_prev = ePrev;
      r.east_avg_real = eReal;
      r.avg_daily_curr = wCurr;
      r.east_avg_curr = eCurr;
      r.total_avg_prev = wPrev + ePrev + fbaPrev;
      r.total_avg_real = wReal + eReal + fbaReal;
      r.total_avg_curr = wCurr + eCurr + fbaCurr;
      r.fba_avg_prev = fbaPrev;
      r.fba_avg_real = fbaReal;
      r.fba_avg_curr = fbaCurr;

      const w90 = Number(r.west_90d), w60 = Number(r.west_60d), w30 = Number(r.west_30d);
      const wPre = Number(r.west_30d_pre), w15 = Number(r.west_15d), w7 = Number(r.west_7d);
      const e90 = Number(r.east_90d), e60 = Number(r.east_60d), e30 = Number(r.east_30d);
      const ePre = Number(r.east_30d_pre), e15 = Number(r.east_15d), e7 = Number(r.east_7d);
      r.west_fbm_30d = fbmThirtyDayAverage(w90, w60, w30, wPre, w15, w7, salesWindowWeights);
      r.east_fbm_30d = fbmThirtyDayAverage(e90, e60, e30, ePre, e15, e7, salesWindowWeights);
      r.total_30d = (r.west_fbm_30d as number) + (r.east_fbm_30d as number) + (r.fba_30d as number);
    }

    await Promise.all([
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats", linkRows, salesCols, salesUpdateSet),
      DemandPlanningRepository.batchUpsert("shipcore.fc_stats_custom", customRows, salesCols, salesUpdateSet),
    ]);

    // ── Step 3: Sync SWC SKUs into fc_products ───────────────────────
    await DemandPlanningRepository.upsertSwcProducts();

    await Promise.all([
      invalidatePlanningDashboardCache(),
      OosImpactService.invalidateAll(),
    ]);

    return {
      inventoryUpserted: invRows.length,
      linkSalesUpserted: linkRows.length,
      customSalesUpserted: customRows.length,
    };
  },
};
