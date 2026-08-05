// Code Guide: GET /api/planning/stats/last-sync
// Read-only "when did the shared refreshStats pipeline last run" timestamp
// (MAX(fc_stats.calculated_at)) — for pages that trigger the same "Sync"
// pipeline as Demand Planning (e.g. OOS Impact) but don't otherwise need the
// full dashboard payload just to show a "last synced" timestamp.
// Controller layer only: delegates to DemandPlanningService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { DemandPlanningService } from "@/lib/demand-planning/service";

export async function GET() {
  try {
    const lastSync = await DemandPlanningService.getLastSync();
    return apiSuccess({ lastSync });
  } catch (error) {
    console.error("GET /api/planning/stats/last-sync failed:", error);
    return handleApiError(error);
  }
}
