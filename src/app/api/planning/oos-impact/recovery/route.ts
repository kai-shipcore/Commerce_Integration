// Code Guide: GET /api/planning/oos-impact/recovery
// Real-data feed for the "타 채널 재입고 회복 추이" screen. Base rows come from
// shipcore.fc_inventory_history_snapshot (OOS episodes with a resolved
// back_in_stock_on), joined to per-day qty summed across all marketplace
// channels (Amazon FBA/FBM, Walmart, eBay) to compute a pre-OOS baseline daily
// rate and month 1/2/3 recovery averages per Master SKU. "Days to recovery" is
// the first of those three 30-day blocks whose average reaches threshold% of
// baseline — not a daily/trailing crossing, so it can't disagree with the
// month 1/2/3 % columns shown in the same table. One row per SKU, not per
// SKU×channel — a SKU restocks once physically for every channel, so
// splitting by channel just fragmented one SKU's recovery story into up to 5
// rows. Controller layer only: delegates aggregation + severity classification
// + caching to OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { OosImpactService, DEFAULT_RECOVERY_THRESHOLD_PCT } from "@/lib/oos-impact/service";

function parseThreshold(raw: string | null): number {
  if (raw === null) return DEFAULT_RECOVERY_THRESHOLD_PCT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new ValidationError("threshold must be a number between 0 (exclusive) and 1 (inclusive)");
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const thresholdPct = parseThreshold(searchParams.get("threshold"));
    const { data } = await OosImpactService.getRecovery(thresholdPct);
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery failed:", error);
    return handleApiError(error);
  }
}
