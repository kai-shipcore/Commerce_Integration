/**
 * Code Guide:
 * GET /api/velocity/data — Queries fc_velocity_link_snapshot and fc_velocity_custom_snapshot
 * for the given filters and returns aggregated rows for display on the Velocity page.
 *
 * Query params:
 *   items    — comma-separated item categories (e.g. "Car Cover,Seat Cover")
 *   channels — comma-separated channels (e.g. "Coverland,Amazon")
 *   mode     — "sales" | "ttm" | "preorder"
 *   ranges   — comma-separated "from:to" date pairs (e.g. "2025-01-01:2025-03-31,2025-04-01:2025-04-30")
 *              used by all modes including preorder (client applies 2-day offset via periodsToRanges)
 *   tz       — "utc" (default) | "la" — which date column to filter on
 *   combined — "1" for preorder mode to merge preorder + ttm_preorder by master_sku (Car Cover)
 *
 * Controller layer only: parses the request and delegates to VelocityService.
 */

import { NextRequest } from "next/server";
import { VelocityService } from "@/lib/velocity/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const result = await VelocityService.getSnapshotData({
      items: p.get("items")?.split(",").filter(Boolean) ?? [],
      channels: p.get("channels")?.split(",").filter(Boolean) ?? [],
      mode: p.get("mode") ?? "sales",
      rangesCsv: p.get("ranges") ?? "",
      dateCol: p.get("tz") === "la" ? "order_date_la" : "order_date",
      combined: p.get("combined") === "1",
    });
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/data] GET error:", error);
    return handleApiError(error);
  }
}
