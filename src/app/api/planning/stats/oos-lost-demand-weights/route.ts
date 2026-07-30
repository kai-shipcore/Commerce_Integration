// Code Guide: GET /api/planning/stats/oos-lost-demand-weights
// Read-only preview of the auto-computed OOS lost-demand weights that
// /api/planning/stats/refresh (Step 5) would use for any category/marketplace
// cell the user hasn't overridden — same ratio (marketplace 90d sales /
// Shopify 90d sales, from shipcore.fc_velocity_link_snapshot) computed live.
// Planning Settings fetches this to pre-fill the non-overridden input cells.
// Controller layer only: delegates to PlanningDashboardService.

import { PlanningDashboardService } from "@/lib/planning-dashboard/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const weights = await PlanningDashboardService.getOosLostDemandWeights();
    return apiSuccess({ weights });
  } catch (error) {
    return handleApiError(error);
  }
}
