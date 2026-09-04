// Code Guide: GET /api/planning/transit-records/master-skus — active master SKUs
// for the Add Record dialog's SKU picker, filtered by a search substring.
// Lives in this route group (not sku-master) because it is guarded by
// transit-stock:read: /api/planning/sku-master needs sku-master:read, which a
// transit-stock-only user does not have.
// Controller layer only: delegates to TransitStockService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { TransitStockService } from "@/lib/transit-stock/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const querySchema = z.object({
  search: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      search: searchParams.get("search") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const { data, total } = await TransitStockService.listMasterSkuOptions(parsed);
    return apiSuccess({ data, total });
  } catch (error) {
    return handleApiError(error);
  }
}
