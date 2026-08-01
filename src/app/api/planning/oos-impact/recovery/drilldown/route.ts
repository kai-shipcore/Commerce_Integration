// Code Guide: GET /api/planning/oos-impact/recovery/drilldown?sku=&channel=&restockDate=
// Per-SKU×channel daily-quantity series for the recovery-screen.tsx drilldown
// chart. Returns 7 points aligned to the fixed x-axis anchors the chart already
// uses: [-30,-15,0,15,30,60,90] (days relative to restock). restockDate
// disambiguates a SKU×channel pair that has gone OOS→restocked more than once.
// Controller layer only: delegates episode lookup + series computation to
// OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { OosImpactService } from "@/lib/oos-impact/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");
    const channel = searchParams.get("channel");
    const restockDate = searchParams.get("restockDate");

    const data = await OosImpactService.getRecoveryDrilldown(sku, channel, restockDate);
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/recovery/drilldown failed:", error);
    return handleApiError(error);
  }
}
