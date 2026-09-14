// Code Guide: PATCH /api/planning/products/[sku] — update cbm_per_unit for a SKU in fc_products.
// Used by the planning dashboard inline CBM editor. Cascades to fc_container_items
// and audit-logs the change. Controller layer only: delegates to
// PlanningDashboardService; the response uses the original route's snake_case
// field names (cbm_per_unit, container_items) since the frontend already
// consumes that exact shape.

import { getIp } from "@/lib/audit";
import { guardPermission } from "@/lib/permissions";
import { PlanningDashboardService } from "@/lib/planning-dashboard/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const { sku } = await params;
    const body = await req.json() as { cbm_per_unit?: unknown; total_avg_prev_override?: unknown; total_avg_real_override?: unknown; total_avg_curr_override?: unknown };
    const isAverageOverride = ["total_avg_prev_override", "total_avg_real_override", "total_avg_curr_override"]
      .some((field) => Object.prototype.hasOwnProperty.call(body, field));
    const denied = await guardPermission("demand-planning", isAverageOverride ? "create" : "edit");
    if (denied) return denied;
    if (Object.prototype.hasOwnProperty.call(body, "total_avg_prev_override")) {
      const result = await PlanningDashboardService.updateTotalAvgPrevOverride(sku, body.total_avg_prev_override, getIp(req.headers));
      return apiSuccess({ total_avg_prev_override: result.totalAvgPrevOverride });
    }
    if (Object.prototype.hasOwnProperty.call(body, "total_avg_real_override")) {
      const result = await PlanningDashboardService.updateTotalAvgRealOverride(sku, body.total_avg_real_override, getIp(req.headers));
      return apiSuccess({ total_avg_real_override: result.totalAvgRealOverride });
    }
    if (Object.prototype.hasOwnProperty.call(body, "total_avg_curr_override")) {
      const result = await PlanningDashboardService.updateTotalAvgCurrentOverride(
        sku,
        body.total_avg_curr_override,
        getIp(req.headers),
      );
      return apiSuccess({ total_avg_curr_override: result.totalAvgCurrentOverride });
    }
    const result = await PlanningDashboardService.updateProductCbm(sku, body.cbm_per_unit, getIp(req.headers));

    return apiSuccess({ cbm_per_unit: result.cbmPerUnit, container_items: result.containerItems });
  } catch (error) {
    return handleApiError(error);
  }
}
