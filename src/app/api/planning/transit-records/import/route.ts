// Code Guide: POST /api/planning/transit-records/import — bulk-create transit records from Excel upload.
// Caller pre-selects source/dest warehouses; rows only carry masterSku, qty, notes.
// After insert, syncs fc_stats.transit_stock for all affected SKUs.
// Controller layer only: delegates to TransitStockService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getIp } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { TransitStockService } from "@/lib/transit-stock/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const importSchema = z.object({
  sourceWarehouseCode: z.string().min(1),
  destWarehouseCode: z.string().min(1),
  rows: z.array(z.object({
    masterSku: z.string().min(1),
    qty: z.number().int().min(1),
    notes: z.string().optional(),
  })).min(1).max(2000),
}).refine((d) => d.sourceWarehouseCode !== d.destWarehouseCode, {
  message: "Source and destination warehouses must be different",
});

export async function POST(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "create");
  if (denied) return denied;

  try {
    const body = await req.json();
    const parsed = importSchema.parse(body);
    const session = await auth();

    const inserted = await TransitStockService.importRecords(
      parsed,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );

    return apiSuccess({ inserted });
  } catch (error) {
    return handleApiError(error);
  }
}
