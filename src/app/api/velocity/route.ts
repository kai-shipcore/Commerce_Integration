/**
 * Code Guide:
 * GET /api/velocity — Master SKU velocity: units sold per rolling window (90D~7D).
 * platformSource param filters by ecommerce_data.vw_sales_order_items.platform_source (Channel tab).
 * Controller layer only: parses the request and delegates to VelocityService.
 */

import { NextRequest } from "next/server";
import { VelocityService } from "@/lib/velocity/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await VelocityService.getChannelVelocity({
      isExport: searchParams.get("export") === "1",
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "100", 10),
      search: searchParams.get("search")?.trim() ?? "",
      platformSource: searchParams.get("platformSource")?.trim() ?? "",
      fulfillmentChannel: searchParams.get("fulfillmentChannel")?.trim() ?? "",
      sortByKey: searchParams.get("sortBy") ?? "qty90d",
      sortOrder: searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
      source: searchParams.get("source")?.trim() ?? "",
    });
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity] GET error:", error);
    return handleApiError(error);
  }
}
