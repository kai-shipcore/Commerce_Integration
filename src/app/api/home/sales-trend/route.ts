/**
 * Code Guide:
 * Sales trend endpoint for the home dashboard.
 * Queries ecommerce_data.sales_orders (same source as the Orders page) so
 * the home page numbers match what users see in /orders.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { HomeService } from "@/lib/home/service";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  const { searchParams } = new URL(request.url);

  try {
    const { data, cached } = await HomeService.getSalesTrend({
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      prevStartDate: searchParams.get("prevStartDate"),
      prevEndDate: searchParams.get("prevEndDate"),
    });

    return apiSuccess({ data, ...(cached ? { cached: true } : {}) });
  } catch (error) {
    return handleApiError(error);
  }
}
