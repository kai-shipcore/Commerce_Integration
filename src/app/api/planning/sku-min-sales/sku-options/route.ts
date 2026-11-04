// Code Guide: GET /api/planning/sku-min-sales/sku-options — active master SKUs for the
// Min Sales register form's SKU picker, filtered by a SKU or product-name substring.
// Lives in this route group (not sku-master) because it is guarded by min-sales:read:
// /api/planning/sku-master needs sku-master:read, which a min-sales user may not have.
// Controller only: delegates to SkuMinSalesService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { SkuMinSalesService } from "@/lib/sku-min-sales/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const querySchema = z.object({
  search: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  const denied = await guardPermission("min-sales", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      search: searchParams.get("search") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    const { data, total } = await SkuMinSalesService.searchSkuOptions(parsed.search, parsed.limit);
    return apiSuccess({ data, total });
  } catch (error) {
    return handleApiError(error);
  }
}
