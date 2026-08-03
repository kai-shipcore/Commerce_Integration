// Code Guide: GET /api/planning/oos-impact/recovery/drilldown?sku=&channel=&restockDate=
// Per-SKU×channel daily trailing-14-day-average series for the
// recovery-screen.tsx drilldown chart — one point per day that actually had a
// sale, from 30 days before the OOS start through 90 days after restock. This
// is the exact same rolling average used to decide daysToRecovery in
// recovery/route.ts, so the chart's "recovery" marker lines up with a real
// point on the line. restockDate disambiguates a SKU×channel pair that has
// gone OOS→restocked more than once. Controller layer only: delegates episode
// lookup + series computation to OosImpactService.

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
