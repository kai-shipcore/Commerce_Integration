// Code Guide: GET /api/planning/oos-impact/top-sellers
// Top 100 SKUs by trailing-30-day sales quantity, aggregated at the Master SKU
// level across ALL channels (Shopify included) — unrelated to OOS/restock
// history. Companion reference view to the recovery screen's "채널 비교"/
// "스큐 비교" toggle, for "what are our current best sellers" context.
// Controller layer only: delegates ranking + caching to OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { OosImpactService } from "@/lib/oos-impact/service";

export async function GET() {
  try {
    const { data } = await OosImpactService.getTopSellers();
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/top-sellers failed:", error);
    return handleApiError(error);
  }
}
