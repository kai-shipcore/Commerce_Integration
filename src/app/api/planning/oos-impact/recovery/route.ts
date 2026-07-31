// Code Guide: GET /api/planning/oos-impact/recovery
// Real-data feed for the "타 채널 재입고 회복 추이" screen's SKU-comparison view.
// Base rows come from shipcore.fc_inventory_history_snapshot (OOS episodes with
// a resolved back_in_stock_on), joined to per-day per-channel qty to compute a
// pre-OOS baseline daily rate and a "days to recovery" outcome. Channel
// comparison (the line chart) is out of scope here and still uses sample data.
// Controller layer only: delegates aggregation + severity classification +
// caching to OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { OosImpactService } from "@/lib/oos-impact/service";

export async function GET() {
  try {
    const { data } = await OosImpactService.getRecovery();
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery failed:", error);
    return handleApiError(error);
  }
}
