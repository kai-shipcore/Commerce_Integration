// Code Guide: GET /api/planning/oos-impact/recovery
// Real-data feed for the "타 채널 재입고 회복 추이" screen's SKU-comparison view.
// Base rows come from shipcore.fc_inventory_history_snapshot (OOS episodes with
// a resolved back_in_stock_on), joined to per-day per-channel qty to compute a
// pre-OOS baseline daily rate and a "days to recovery" outcome. Channel
// comparison (the line chart) is out of scope here and still uses sample data.
// Controller layer only: delegates aggregation + severity classification +
// caching to OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import {
  OosImpactService, DEFAULT_RECOVERY_THRESHOLD_PCT, DEFAULT_MIN_RECOVERY_DAYS, RECOVERY_HORIZON_DAYS,
} from "@/lib/oos-impact/service";

function parseThreshold(raw: string | null): number {
  if (raw === null) return DEFAULT_RECOVERY_THRESHOLD_PCT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new ValidationError("threshold must be a number between 0 (exclusive) and 1 (inclusive)");
  }
  return value;
}

// Below DEFAULT_MIN_RECOVERY_DAYS the trailing window would reach before the
// restock date; at/above the horizon there'd be no days left to search.
function parseMinRecoveryDays(raw: string | null): number {
  if (raw === null) return DEFAULT_MIN_RECOVERY_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < DEFAULT_MIN_RECOVERY_DAYS || value >= RECOVERY_HORIZON_DAYS) {
    throw new ValidationError(`minRecoveryDays must be an integer between ${DEFAULT_MIN_RECOVERY_DAYS} and ${RECOVERY_HORIZON_DAYS - 1}`);
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const thresholdPct = parseThreshold(searchParams.get("threshold"));
    const minRecoveryDays = parseMinRecoveryDays(searchParams.get("minRecoveryDays"));
    const { data } = await OosImpactService.getRecovery(thresholdPct, minRecoveryDays);
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery failed:", error);
    return handleApiError(error);
  }
}
