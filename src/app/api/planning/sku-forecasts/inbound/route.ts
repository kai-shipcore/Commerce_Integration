// Code Guide: GET /api/planning/sku-forecasts/inbound?masterSku=...&includeDrafts=1
// Pending inbound containers for a SKU (shipped/packing_received, optionally
// including drafts). Controller layer only: delegates to SkuForecastsService.

import { guardPermission } from "@/lib/permissions";
import { SkuForecastsService } from "@/lib/sku-forecasts/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: Request) {
  const denied = await guardPermission("sku-forecasts", "read");
  if (denied) return denied;

  try {
    const searchParams = new URL(request.url).searchParams;
    const includeDrafts = searchParams.get("includeDrafts") === "1";
    const data = await SkuForecastsService.getInbound(searchParams.get("masterSku"), includeDrafts);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
