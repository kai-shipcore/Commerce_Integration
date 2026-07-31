// Code Guide: GET + POST /api/production/product-vehicles
// GET  — returns all rows from shipcore.sc_product_vehicle
// POST — inserts a new vehicle row

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { VehiclesService } from "@/lib/vehicles/service";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const denied = await guardPermission("production-vehicles", "read");
  if (denied) return denied;

  try {
    const data = await VehiclesService.listVehicles();
    return apiSuccess({ data, total: data.length });
  } catch (error) {
    console.error("product-vehicles GET error:", error);
    return apiError("Database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardPermission("production-vehicles", "create");
  if (denied) return denied;

  try {
    const body = await req.json() as Record<string, unknown>;
    await VehiclesService.createVehicle(body);
    return apiSuccess({});
  } catch (error) {
    if (error instanceof ValidationError) return apiError(error.message, 400);
    console.error("[product-vehicles POST]", error);
    return apiError("DB error", 500);
  }
}
