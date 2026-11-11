// Code Guide: GET /api/planning/sku-replacing-soon/sku-options — active master SKUs for
// the Replacing Soon register form's SKU picker, filtered by a SKU or product-name
// substring. Lives in this route group because it is guarded by replacing-soon:read.
// Controller only: delegates to SkuReplacingSoonService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { SkuReplacingSoonService } from "@/lib/sku-replacing-soon/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const querySchema = z.object({
  search: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  const denied = await guardPermission("replacing-soon", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.parse({
      search: searchParams.get("search") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    const { data, total } = await SkuReplacingSoonService.searchSkuOptions(parsed.search, parsed.limit);
    return apiSuccess({ data, total });
  } catch (error) {
    return handleApiError(error);
  }
}
