/**
 * Code Guide:
 * GET /api/velocity/preorder-enrich — Enriches Link Pre Order rows with Custom + TTM pre order counts.
 * POST /api/velocity/preorder-enrich — Same, accepts { skus, search } JSON body (for export).
 * Called as a second async request after the main Link Pre Order data renders.
 * GET results cached 15 minutes; POST is not cached.
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

    const result = await VelocityService.getPreorderEnrich(skus, search);
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/preorder-enrich] GET error:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const skus: string[] = Array.isArray(body.skus) ? body.skus : [];
    const search: string = typeof body.search === "string" ? body.search.trim() : "";

    const result = await VelocityService.getPreorderEnrichUncached(skus, search);
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/preorder-enrich] POST error:", error);
    return handleApiError(error);
  }
}
