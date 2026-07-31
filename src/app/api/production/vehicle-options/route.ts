// Code Guide: GET /api/production/vehicle-options
// No `make` param — returns distinct Make values from shipcore.sc_product_vehicle.
// `?make=X` — returns distinct Model values for that Make.
// Backs the Make/Model cascading selects in the Part SKU Generator and Product List.
// Shared across two domains: gated on EITHER part-sku-generator:read OR
// project-list:read, since both pages consume this vehicles-owned endpoint.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/api-response";
import { VehiclesService } from "@/lib/vehicles/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError("Unauthorized", 401);
  }
  const role = (session.user.role as string) ?? "user";
  const allowed =
    (await canDo(session.user.id, role, "part-sku-generator", "read")) ||
    (await canDo(session.user.id, role, "project-list", "read"));
  if (!allowed) {
    return apiError("Permission denied", 403);
  }

  const { searchParams } = new URL(request.url);
  const make = searchParams.get("make")?.trim() || null;

  try {
    const data = await VehiclesService.vehicleOptions(make);
    return apiSuccess({ data });
  } catch (error) {
    console.error("vehicle-options GET error:", error);
    return apiError("Database error", 500);
  }
}
