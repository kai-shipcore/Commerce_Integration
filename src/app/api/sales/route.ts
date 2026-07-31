/**
 * Code Guide:
 * This API route owns the sales backend workflow.
 * Reads from sc_sales_orders + sc_sales_order_items (primary DB).
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { SalesService } from "@/lib/sales/service";

// GET /api/sales - Query sales data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const filters = {
      masterSkuCode: searchParams.get("masterSkuCode"),
      platform: searchParams.get("platform"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    };
    const groupBy = searchParams.get("groupBy"); // 'day' | 'week' | 'month'
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(500, parseInt(searchParams.get("limit") || "100"));

    if (groupBy && filters.masterSkuCode) {
      const rows = await SalesService.listGrouped(filters, groupBy);
      return apiSuccess({ data: rows, groupBy });
    }

    const { rows, pagination } = await SalesService.listPaged(filters, page, limit);
    return apiSuccess({ data: rows, pagination });
  } catch (error) {
    console.error("Error fetching sales:", error);
    return apiError(error instanceof Error ? error.message : "Unknown error", 500);
  }
}
