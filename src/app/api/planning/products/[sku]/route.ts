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
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;

  try {
    const { sku } = await params;
    const body = await req.json() as { cbm_per_unit?: unknown };
    const result = await PlanningDashboardService.updateProductCbm(sku, body.cbm_per_unit, getIp(req.headers));

    return apiSuccess({ cbm_per_unit: result.cbmPerUnit, container_items: result.containerItems });
  } catch (error) {
    return handleApiError(error);
  }
}
