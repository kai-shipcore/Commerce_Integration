// Code Guide: GET + POST /api/planning/transit-records — list and create transit stock records.
// After creation, syncs fc_stats.transit_stock for the affected SKU.
// Controller layer only: delegates to TransitStockService. Data access lives
// in src/lib/transit-stock/repository.ts.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getIp } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { TransitStockService } from "@/lib/transit-stock/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const createSchema = z.object({
  sourceWarehouseCode: z.string().min(1),
  destWarehouseCode: z.string().min(1),
  masterSku: z.string().min(1),
  qty: z.number().int().min(1),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const data = await TransitStockService.listRecords(searchParams.get("status"));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "create");
  if (denied) return denied;

  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);
    const session = await auth();

    const data = await TransitStockService.createRecord(
      parsed,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );

    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
