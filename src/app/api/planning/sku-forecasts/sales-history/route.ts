// Code Guide: GET /api/planning/sku-forecasts/sales-history
// Sales history chart data for a single SKU, bucketed by day/week/month.
// Controller layer only: parses query params and delegates bucket/category
// resolution and aggregation to SkuForecastsService.

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-response";
import { SkuForecastsService } from "@/lib/sku-forecasts/service";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const data = await SkuForecastsService.getSalesHistory({
      sku: params.get("sku"),
      from: params.get("from"),
      to: params.get("to"),
      category: params.get("category"),
      bucket: params.get("bucket"),
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[sku-forecasts/sales-history] GET error:", error);
    return handleApiError(error);
  }
}
