/**
 * Code Guide:
 * This API route owns the warehouses backend workflow.
 * Controller layer only: parses the request, validates input, applies the
 * auth guard, and delegates to WarehousesService for business logic and
 * audit logging. Data access lives in src/lib/warehouses/repository.ts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { WarehousesService } from "@/lib/warehouses/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const WarehouseCreateSchema = z.object({
  warehouseCode: z.string().min(1),
  warehouseName: z.string().min(1),
  warehouseType: z.enum(["own", "fba", "3pl", "transit"]),
  country: z.string().optional(),
  stateRegion: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("warehouse", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const data = await WarehousesService.listWarehouses({
      search: searchParams.get("search") ?? "",
      type: searchParams.get("type") ?? "",
      active: searchParams.get("active"),
    });
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching warehouses:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("warehouse", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = WarehouseCreateSchema.parse(body);
    const data = await WarehousesService.createWarehouse(validated, getIp(request.headers));
    return apiSuccess({ data }, 201);
  } catch (error) {
    console.error("Error creating warehouse:", error);
    return handleApiError(error);
  }
}
