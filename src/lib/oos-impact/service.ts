/**
 * Business logic for the OOS Impact screens: top sellers ranking, cross-channel
 * recovery severity classification, per-SKU recovery drilldown series, and
 * Pre-Order demand-drop severity. Caching (Redis) and row-shaping live here;
 * raw SQL lives in OosImpactRepository.
 */

import { CacheManager } from "@/lib/redis";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { OosImpactRepository, DEFAULT_RECOVERY_THRESHOLD_PCT, DEFAULT_MIN_RECOVERY_DAYS, RECOVERY_HORIZON_DAYS } from "@/lib/oos-impact/repository";

export { DEFAULT_RECOVERY_THRESHOLD_PCT, DEFAULT_MIN_RECOVERY_DAYS, RECOVERY_HORIZON_DAYS };

const WINDOW_DAYS = 30;

export interface TopSellerRow {
  rank: number;
  sku: string;
  categoryCode: string | null;
  totalQty: number;
  avgDaily: number;
}

export const TOP_SELLERS_CACHE_KEY = "oos-top-sellers:sku-list:v1";
const TOP_SELLERS_CACHE_TTL_SECONDS = 600;

export type RecoverySeverity = "good" | "warning" | "serious" | "critical";

export interface RecoveryRow {
  sku: string;
  channel: string;
  itemCategory: string;
  oosStartedOn: string;
  restockDate: string;
  oosDays: number;
  daysSinceRestock: number;
  baseline: number;
  day0to30: number | null;
  day30to60: number | null;
  day60to90: number | null;
  daysToRecovery: number | null;
  severity: RecoverySeverity;
  label: string;
}

export const RECOVERY_CACHE_KEY = "oos-recovery:sku-list:v3";
const RECOVERY_CACHE_TTL_SECONDS = 600;

function recoverySeverityOf(daysToRecovery: number | null, daysSinceRestock: number): { severity: RecoverySeverity; label: string } {
  if (daysToRecovery !== null && daysToRecovery <= 30) return { severity: "good", label: "정상 회복" };
  if (daysToRecovery !== null) return { severity: "warning", label: "느린 회복" };
  if (daysSinceRestock < RECOVERY_HORIZON_DAYS) return { severity: "serious", label: "관찰중" };
  return { severity: "critical", label: "미회복" };
}

export interface RecoveryDrilldownPoint {
  dayOffset: number;
  value: number;
  qty: number;
}

export interface RecoveryDrilldownResult {
  points: RecoveryDrilldownPoint[];
  baseline: number;
  restockDate: string;
}

export type PreorderDropSeverity = "good" | "warning" | "serious" | "critical";

export interface PreorderDropRow {
  id: string;
  sku: string;
  itemCategory: "Car Cover" | "Seat Cover" | "Floor Mat" | "SWC" | "Miscellaneous";
  channel: string;
  normalStart: string;
  normalEnd: string;
  preorderStart: string;
  preorderEnd: string;
  conversionDate: string;
  restockDate: string | null;
  windowDays: number;
  normalQty: number;
  preorderQty: number;
  normalDailyAverage: number;
  preorderDailyAverage: number;
  dropRate: number;
  severity: PreorderDropSeverity;
  stage: "active" | "ended";
}

export const PREORDER_CACHE_KEY = "oos-preorder:sku-list:v4";
const PREORDER_CACHE_TTL_SECONDS = 600;

function preorderSeverityOf(dropRate: number): PreorderDropSeverity {
  if (dropRate < 20) return "good";
  if (dropRate < 40) return "warning";
  if (dropRate < 60) return "serious";
  return "critical";
}

export const OosImpactService = {
  async getTopSellers(): Promise<{ data: TopSellerRow[]; cached: boolean }> {
    const cached = await CacheManager.get<TopSellerRow[]>(TOP_SELLERS_CACHE_KEY);
    if (cached) return { data: cached, cached: true };

    const rows = await OosImpactRepository.getTopSellers();
    const data: TopSellerRow[] = rows.map((r, i) => {
      const totalQty = Number(r.total_qty);
      return {
        rank: i + 1,
        sku: r.master_sku,
        categoryCode: r.category_code,
        totalQty,
        avgDaily: Math.round((totalQty / WINDOW_DAYS) * 10) / 10,
      };
    });

    await CacheManager.set(TOP_SELLERS_CACHE_KEY, data, TOP_SELLERS_CACHE_TTL_SECONDS);
    return { data, cached: false };
  },

  async getRecovery(
    thresholdPct: number = DEFAULT_RECOVERY_THRESHOLD_PCT,
    minRecoveryDays: number = DEFAULT_MIN_RECOVERY_DAYS,
  ): Promise<{ data: RecoveryRow[]; cached: boolean }> {
    // Cache key includes both knobs so a custom value never serves (or
    // evicts) another combination's result — each distinct pair gets its own
    // short-lived cache entry.
    const cacheKey = `${RECOVERY_CACHE_KEY}:${thresholdPct}:${minRecoveryDays}`;
    const cached = await CacheManager.get<RecoveryRow[]>(cacheKey);
    if (cached) return { data: cached, cached: true };

    const rows = await OosImpactRepository.getRecoveryRows(thresholdPct, minRecoveryDays);
    const round1 = (avg: string | null) => (avg === null ? null : Math.round(Number(avg) * 10) / 10);

    const data: RecoveryRow[] = rows.map((r) => {
      const baseline = Number(r.baseline);
      const { severity, label } = recoverySeverityOf(r.days_to_recovery, r.days_since_restock);

      return {
        sku: r.master_sku,
        channel: r.channel,
        itemCategory: r.item_category,
        oosStartedOn: r.oos_started_on,
        restockDate: r.back_in_stock_on,
        oosDays: r.oos_days,
        daysSinceRestock: r.days_since_restock,
        baseline: Math.round(baseline * 10) / 10,
        day0to30: round1(r.day0_30_avg),
        day30to60: round1(r.day30_60_avg),
        day60to90: round1(r.day60_90_avg),
        daysToRecovery: r.days_to_recovery,
        severity,
        label,
      };
    });

    await CacheManager.set(cacheKey, data, RECOVERY_CACHE_TTL_SECONDS);
    return { data, cached: false };
  },

  async getRecoveryDrilldown(
    sku: string | null,
    channel: string | null,
    restockDate: string | null,
  ): Promise<RecoveryDrilldownResult> {
    if (!sku || !channel) {
      throw new ValidationError("sku and channel are required");
    }

    const episode = await OosImpactRepository.findLatestEpisode(sku, restockDate);
    if (!episode) {
      throw new NotFoundError("No resolved OOS episode found for this SKU");
    }

    const s = await OosImpactRepository.getDrilldownSeries(
      sku,
      channel,
      episode.oos_started_on,
      episode.back_in_stock_on,
    );
    const round1 = (v: string) => Math.round(Number(v) * 10) / 10;

    return {
      points: s.points.map((p) => ({ dayOffset: p.day_offset, value: round1(p.trailing_avg), qty: Number(p.qty) })),
      baseline: round1(s.baseline),
      restockDate: episode.back_in_stock_on,
    };
  },

  async getPreorder(): Promise<{ data: PreorderDropRow[]; cached: boolean }> {
    const cached = await CacheManager.get<PreorderDropRow[]>(PREORDER_CACHE_KEY);
    if (cached) return { data: cached, cached: true };

    const rows = await OosImpactRepository.getPreorderRows();
    const data: PreorderDropRow[] = rows.map((row) => {
      const normalQty = Number(row.normal_qty);
      const preorderQty = Number(row.preorder_qty);
      const normalDailyAverage = normalQty / row.window_days;
      const preorderDailyAverage = preorderQty / row.window_days;
      const dropRate = Math.round(Math.min(100, ((normalDailyAverage - preorderDailyAverage) / normalDailyAverage) * 100));

      return {
        id: `${row.master_sku}|${row.channel}|${row.preorder_start}`,
        sku: row.master_sku,
        itemCategory: row.item_category,
        channel: row.channel,
        normalStart: row.normal_start,
        normalEnd: row.normal_end,
        preorderStart: row.preorder_start,
        preorderEnd: row.preorder_end,
        conversionDate: row.preorder_start,
        restockDate: row.back_in_stock_on,
        windowDays: row.window_days,
        normalQty,
        preorderQty,
        normalDailyAverage: Math.round(normalDailyAverage * 10_000) / 10_000,
        preorderDailyAverage: Math.round(preorderDailyAverage * 10_000) / 10_000,
        dropRate,
        severity: preorderSeverityOf(dropRate),
        stage: row.stage,
      };
    });

    await CacheManager.set(PREORDER_CACHE_KEY, data, PREORDER_CACHE_TTL_SECONDS);
    return { data, cached: false };
  },

  // Called after stats/refresh repopulates fc_inventory_history_snapshot /
  // fc_velocity_*_snapshot, so the three OOS Impact screens don't keep serving
  // stale cached rows for up to CACHE_TTL_SECONDS.
  async invalidateAll(): Promise<void> {
    await Promise.all([
      CacheManager.delete(TOP_SELLERS_CACHE_KEY),
      // Recovery is cached per threshold value (see getRecovery) — a plain
      // delete(RECOVERY_CACHE_KEY) would miss every non-default threshold.
      CacheManager.deletePattern(`${RECOVERY_CACHE_KEY}:*`),
      CacheManager.delete(PREORDER_CACHE_KEY),
    ]);
  },
};
