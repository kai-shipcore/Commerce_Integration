/**
 * Code Guide:
 * This API route owns the warehouses / [id] backend workflow.
 * Controller layer only: parses the request, validates input, applies the
 * auth guard, and delegates to WarehousesService for business logic and
 * audit logging. Data access lives in src/lib/warehouses/repository.ts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { WarehousesService, isStatusOnlyUpdate } from "@/lib/warehouses/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const WarehouseUpdateSchema = z.object({
  warehouseCode: z.string().min(1).optional(),
  warehouseName: z.string().min(1).optional(),
  warehouseType: z.enum(["own", "fba", "3pl", "transit"]).optional(),
  country: z.string().optional(),
  stateRegion: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = WarehouseUpdateSchema.parse(body);
    const requiredAction = isStatusOnlyUpdate(validated) ? (validated.isActive ? "status" : "delete") : "edit";
    const denied = await guardPermission("warehouse", requiredAction);
    if (denied) return denied;

    const data = await WarehousesService.updateWarehouse(id, validated, getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error updating warehouse:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("warehouse", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    await WarehousesService.deactivateWarehouse(id, getIp(request.headers));
    return apiSuccess({ message: "Warehouse deactivated successfully" });
  } catch (error) {
    console.error("Error deleting warehouse:", error);
    return handleApiError(error);
  }
}
