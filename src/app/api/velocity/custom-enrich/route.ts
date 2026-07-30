/**
 * Code Guide:
 * GET /api/velocity/custom-enrich — Custom Sales enrichment for a given list of Link master SKUs.
 * POST /api/velocity/custom-enrich — Same, but accepts { skus, search } in JSON body (for large SKU lists on export).
 * Called as a second async request after the main Link Sales data renders.
 * GET results are cached for 15 minutes to avoid repeated expensive view scans; POST is not cached.
 * Controller layer only: parses the request and delegates to VelocityService.
 */

import { NextRequest } from "next/server";
import { VelocityService } from "@/lib/velocity/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skusParam = searchParams.get("skus") ?? "";
    const search = searchParams.get("search")?.trim() ?? "";
    const skus = skusParam ? skusParam.split(",").filter(Boolean) : [];

    const result = await VelocityService.getCustomEnrich(skus, search);
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/custom-enrich] GET error:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const skus: string[] = Array.isArray(body.skus) ? body.skus : [];
    const search: string = typeof body.search === "string" ? body.search.trim() : "";

    const result = await VelocityService.getCustomEnrichUncached(skus, search);
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/custom-enrich] POST error:", error);
    return handleApiError(error);
  }
}
