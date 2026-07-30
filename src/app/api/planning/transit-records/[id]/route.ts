// Code Guide: PATCH + DELETE /api/planning/transit-records/[id] — update status/qty/notes or delete.
// After each mutation, syncs fc_stats.transit_stock for the affected SKU.
// Controller layer only: delegates to TransitStockService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getIp } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { TransitStockService } from "@/lib/transit-stock/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const patchSchema = z.object({
  status: z.enum(["in_transit", "arrived", "cancelled"]).optional(),
  qty: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("transit-stock", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    const session = await auth();

    await TransitStockService.updateRecord(
      id,
      parsed,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );

    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("transit-stock", "delete");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();

    await TransitStockService.deleteRecord(
      id,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );

    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
