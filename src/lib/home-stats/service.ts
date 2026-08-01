/**
 * Business logic for the home dashboard "Command Center" stats widget:
 * per-category KPI/stock-distribution computation, day-over-day deltas via
 * Redis snapshots, the backward-compat byCategory shape, and global rollups.
 */

import { CacheManager } from "@/lib/redis";
import { HomeStatsRepository, type CatTopRow } from "@/lib/home-stats/repository";

const CACHE_KEY = "home:planning-stats:v28";
const CACHE_TTL = 10 * 60; // 10 minutes

type CatKey = "fm" | "cc" | "sc";
const CATS: CatKey[] = ["fm", "cc", "sc"];

interface CatKpiSnap {
  criticalSku: number; expectedOos: number; overstockSku: number; urgentPo: number;
}

export interface HomeStatsResult {
  data: unknown;
  cached: boolean;
}

export const HomeStatsService = {
  async getStats(bustCache: boolean): Promise<HomeStatsResult> {
    if (bustCache) {
      await CacheManager.delete(CACHE_KEY);
    } else {
      const cached = await CacheManager.get<unknown>(CACHE_KEY);
      if (cached) {
        return { data: cached, cached: true };
      }
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      catDetailResult,
      lastSync,
      containersResult,
      sales30Result,
      salesPrev30Result,
      catTopResult,
      delayedContainersResult,
    ] = await Promise.all([
      HomeStatsRepository.getCatDetail(),
      HomeStatsRepository.getLastSync(),
      HomeStatsRepository.getInboundContainers(),
      HomeStatsRepository.getSalesSince(thirtyDaysAgo),
      HomeStatsRepository.getSalesQtyBetween(sixtyDaysAgo, thirtyDaysAgo),
      HomeStatsRepository.getCatTopCritical(),
      HomeStatsRepository.getDelayedContainers(),
    ]);

    // ── Parse catDetailResult into per-category maps ───────────────────────────
    const emptyDetail = {
      critical_sku: "0", expected_oos: "0", overstock_sku: "0", urgent_po: "0",
      d0_30: "0", d30_60: "0", d60_180: "0", d180plus: "0", backorder: "0",
    };
    const catDetailMap: Record<CatKey, typeof emptyDetail & { cat: CatKey }> = {
      fm: { cat: "fm", ...emptyDetail },
      cc: { cat: "cc", ...emptyDetail },
      sc: { cat: "sc", ...emptyDetail },
    };
    for (const row of catDetailResult) {
      const k = row.cat as CatKey;
      if (k in catDetailMap) catDetailMap[k] = { ...row, cat: k };
    }

    // ── Parse catTopResult into per-category arrays ────────────────────────────
    const catTopMap: Record<CatKey, CatTopRow[]> = { fm: [], cc: [], sc: [] };
    for (const row of catTopResult) {
      const k = row.cat as CatKey;
      if (k in catTopMap) catTopMap[k].push(row);
    }

    // ── Per-category Redis delta snapshots ────────────────────────────────────
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

    const prevSnaps = Object.fromEntries(
      await Promise.all(
        CATS.map(async (cat) => [
          cat,
          await CacheManager.get<CatKpiSnap>(`home:kpi-snap:${cat}:${yesterdayStr}`),
        ]),
      ),
    ) as Record<CatKey, CatKpiSnap | null>;

    // ── Build byCategoryFull ──────────────────────────────────────────────────
    const byCategoryFull = Object.fromEntries(
      CATS.map((cat) => {
        const d = catDetailMap[cat];
        const prev = prevSnaps[cat];

        const criticalSku = parseInt(d.critical_sku, 10);
        const urgentPo = parseInt(d.urgent_po, 10);
        const backorder = parseInt(d.backorder, 10);
        const expectedOos = parseInt(d.expected_oos, 10);
        const overstockSku = parseInt(d.overstock_sku, 10);

        const delta = (curr: number, field: keyof CatKpiSnap) =>
          prev ? curr - prev[field] : 0;

        const kpis = {
          criticalSku,
          expectedOos,
          overstockSku,
          urgentPo,
          deltas: {
            criticalSku: delta(criticalSku, "criticalSku"),
            expectedOos: delta(expectedOos, "expectedOos"),
            overstockSku: delta(overstockSku, "overstockSku"),
            urgentPo: delta(urgentPo, "urgentPo"),
          },
        };

        const stockDistribution = {
          d0_30: parseInt(d.d0_30, 10),
          d30_60: parseInt(d.d30_60, 10),
          d60_180: parseInt(d.d60_180, 10),
          d180plus: parseInt(d.d180plus, 10),
        };

        const topCritical = catTopMap[cat].map((row) => ({
          sku: row.sku,
          totalStock: parseInt(row.total_stock, 10),
          avgDaily: parseFloat(row.total_avg_curr),
          sodDays: parseInt(row.sod_days, 10),
          back: parseInt(row.back, 10),
          nextEta: row.next_eta ?? null,
        }));

        return [cat, { kpis, stockDistribution, topCritical, backorder }];
      }),
    ) as Record<CatKey, { kpis: { criticalSku: number; expectedOos: number; overstockSku: number; urgentPo: number; deltas: unknown }; stockDistribution: { d0_30: number; d30_60: number; d60_180: number; d180plus: number }; topCritical: object[]; backorder: number }>;

    // Persist today's per-cat snapshots for tomorrow's delta (48h TTL)
    await Promise.all(
      CATS.map((cat) => {
        const f = byCategoryFull[cat];
        return CacheManager.set(
          `home:kpi-snap:${cat}:${todayStr}`,
          {
            criticalSku: f.kpis.criticalSku,
            expectedOos: f.kpis.expectedOos,
            overstockSku: f.kpis.overstockSku,
            urgentPo: f.kpis.urgentPo,
          } satisfies CatKpiSnap,
          48 * 60 * 60,
        );
      }),
    );

    // ── Backward-compat byCategory (old CatStats shape) ──────────────────────
    const byCategory = Object.fromEntries(
      CATS.map((cat) => {
        const d = catDetailMap[cat];
        const bf = byCategoryFull[cat];
        return [cat, {
          critical: bf.kpis.criticalSku,
          warning: parseInt(d.d30_60, 10),
          backorder: bf.backorder,
          total: parseInt(d.d0_30, 10) + parseInt(d.d30_60, 10) + parseInt(d.d60_180, 10) + parseInt(d.d180plus, 10),
        }];
      }),
    );

    // ── Global KPIs (sum of all 3 categories) ─────────────────────────────────
    const globalKpis = CATS.reduce(
      (acc, cat) => {
        const k = byCategoryFull[cat].kpis;
        acc.criticalSku += k.criticalSku;
        acc.expectedOos += k.expectedOos;
        acc.overstockSku += k.overstockSku;
        acc.urgentPo += k.urgentPo;
        return acc;
      },
      { criticalSku: 0, expectedOos: 0, overstockSku: 0, urgentPo: 0 },
    );

    const globalDistribution = CATS.reduce(
      (acc, cat) => {
        const sd = byCategoryFull[cat].stockDistribution;
        acc.d0_30 += sd.d0_30;
        acc.d30_60 += sd.d30_60;
        acc.d60_180 += sd.d60_180;
        acc.d180plus += sd.d180plus;
        return acc;
      },
      { d0_30: 0, d30_60: 0, d60_180: 0, d180plus: 0 },
    );

    // ── inboundContainers ─────────────────────────────────────────────────────
    const containers = containersResult.map((r) => ({
      name: r.name,
      eta: r.eta ?? null,
      confirmedDate: r.confirmed_date ?? null,
      confirmedTime: r.confirmed_time ? r.confirmed_time.slice(0, 5) : null,
      qty: parseInt(r.total_qty ?? "0", 10),
      status: r.status,
      cbmCapacity: parseFloat(r.cbm_capacity ?? "0"),
      usedCbm: parseFloat(r.used_cbm ?? "0"),
      skuCount: parseInt(r.sku_count ?? "0", 10),
    }));
    const totalInboundQty = containers.reduce((sum, c) => sum + c.qty, 0);

    // ── delayedContainerList ──────────────────────────────────────────────────
    const delayedContainerList = delayedContainersResult.map((r) => ({
      name: r.name,
      eta: r.eta ?? null,
      delayDays: parseInt(r.delay_days ?? "0", 10),
      status: r.status,
    }));
    const delayedContainersCount = delayedContainerList.length;

    // ── Sales 30d ─────────────────────────────────────────────────────────────
    const units30 = parseInt(sales30Result?.qty ?? "0", 10);
    const revenue30 = parseFloat(sales30Result?.revenue ?? "0");
    const unitsPrev30 = parseInt(salesPrev30Result?.qty ?? "0", 10);
    const growthPct = unitsPrev30 > 0
      ? Math.round(((units30 - unitsPrev30) / unitsPrev30) * 1000) / 10
      : 0;

    const data = {
      byCategoryFull,
      kpis: {
        ...globalKpis,
        delayedContainers: delayedContainersCount,
        deltas: { criticalSku: 0, expectedOos: 0, overstockSku: 0, delayedContainers: 0, urgentPo: 0 },
      },
      stockDistribution: globalDistribution,
      topCritical: catTopResult
        .map((row) => ({
          sku: row.sku,
          totalStock: parseInt(row.total_stock, 10),
          avgDaily: parseFloat(row.total_avg_curr),
          sodDays: parseInt(row.sod_days, 10),
          back: parseInt(row.back, 10),
          nextEta: row.next_eta ?? null,
        }))
        .sort((a, b) => a.sodDays - b.sodDays)
        .slice(0, 5),
      delayedContainerList,
      byCategory,
      inboundContainers: containers,
      totalInboundQty,
      sales30d: { units: units30, revenue: revenue30, growthPct },
      lastSync,
    };

    await CacheManager.set(CACHE_KEY, data, CACHE_TTL);
    return { data, cached: false };
  },
};
