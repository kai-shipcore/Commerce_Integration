/**
 * Code Guide:
 * GET /api/planning/warehouses — list active warehouses for transit record
 * dropdowns. Controller layer only: delegates to WarehousesService (shared
 * with /api/warehouses, since both read the same fc_warehouses table).
 */

import { guardPermission } from "@/lib/permissions";
import { WarehousesService } from "@/lib/warehouses/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET() {
  const denied = await guardPermission("transit-stock", "read");
  if (denied) return denied;
  try {
    const data = await WarehousesService.listActiveForDropdown();
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching warehouses for dropdown:", error);
    return handleApiError(error);
  }
}
