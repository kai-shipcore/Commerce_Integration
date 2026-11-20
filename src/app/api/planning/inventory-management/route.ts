// Code Guide: GET /api/planning/inventory-management
// Backs the /planning/inventory-management page: every SKU in SKU Master
// (active and inactive) with its stock split by warehouse, and a note on each
// row whose stock comes from another SKU. Read-only; statuses are edited in
// SKU Master. Controller only: the rules live in InventoryManagementService.

import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { InventoryManagementService } from "@/lib/inventory-management/service";

export async function GET() {
  // The same stock the Demand Planning page shows, so the same permission.
  const denied = await guardPermission("demand-planning", "read");
  if (denied) return denied;
  try {
    const data = await InventoryManagementService.list();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
