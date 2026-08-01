// Code Guide: PATCH /api/production/product-vehicles/[id] — update a vehicle row

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { VehiclesService } from "@/lib/vehicles/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("production-vehicles", "edit");
  if (denied) return denied;

  const { id } = await params;
  if (!id || isNaN(Number(id))) {
    return apiError("Invalid id", 400);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    await VehiclesService.updateVehicle(Number(id), body);
    return apiSuccess({});
  } catch (error) {
    if (error instanceof ValidationError) return apiError(error.message, 400);
    console.error("[product-vehicles PATCH]", error);
    return apiError("DB error", 500);
  }
}
