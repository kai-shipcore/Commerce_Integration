// GET /api/planning/oos-impact/preorder
// Shopify Pre-Order demand drop by SKU, channel, and OOS episode.
// The OOS episode supplies the comparison anchor; the custom velocity snapshot
// supplies normal/pre-order quantities. Missing sales dates are represented by
// the fixed window denominator, so a day without an order correctly counts as 0.
// Controller layer only: delegates aggregation + severity classification +
// caching to OosImpactService.

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { OosImpactService } from "@/lib/oos-impact/service";

export async function GET() {
  try {
    const { data } = await OosImpactService.getPreorder();
    return apiSuccess({ data });
  } catch (error) {
    console.error("GET /api/planning/oos-impact/preorder failed:", error);
    return handleApiError(error);
  }
}
