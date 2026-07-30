// Code Guide: GET /api/planning/sku-forecasts/inbound-history?masterSku=...
// Per-SKU inbound history joining container items to their remaining/mistake
// available-stock allocations. Controller layer only: delegates to
// SkuForecastsService.

import { guardPermission } from "@/lib/permissions";
import { SkuForecastsService } from "@/lib/sku-forecasts/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: Request) {
  const denied = await guardPermission("sku-forecasts", "read");
  if (denied) return denied;

  try {
    const searchParams = new URL(request.url).searchParams;
    const data = await SkuForecastsService.getInboundHistory(searchParams.get("masterSku"));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
