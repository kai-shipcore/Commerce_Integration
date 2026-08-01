/**
 * Code Guide:
 * This API route owns the analytics / dashboard backend workflow.
 * Controller layer only: parses query params and delegates aggregation +
 * caching to AnalyticsService.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AnalyticsService } from "@/lib/analytics/service";

// GET /api/analytics/dashboard - Get dashboard statistics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const { data, cached } = await AnalyticsService.getDashboard({
      period: searchParams.get("period"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    });

    return apiSuccess({ data, cached });
  } catch (error) {
    console.error("Error fetching dashboard analytics:", error);
    return apiError(error instanceof Error ? error.message : "Unknown error", 500);
  }
}
