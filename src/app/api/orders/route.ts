/**
 * Code Guide:
 * This API route owns the orders backend workflow.
 * Controller layer only: parses the request, delegates to OrderService, and
 * formats the response. Data access lives in
 * src/lib/orders/repository.ts, caching in
 * src/lib/orders/service.ts.
 */

import { NextRequest } from "next/server";
import { OrderService } from "@/lib/orders/service";
import type { SalesOrdersQueryOptions } from "@/lib/orders/repository";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const exportAll = searchParams.get("exportAll") === "true";
    const search = searchParams.get("search") || "";
    const platformSource = searchParams.get("platformSource") || "all";
    const orderStatus = searchParams.get("orderStatus") || "all";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const sortBy = (searchParams.get("sortBy") ||
      "orderDate") as SalesOrdersQueryOptions["sortBy"];
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
    const skipMeta = searchParams.get("skipMeta") === "true";

    const result = await OrderService.listOrders({
      page,
      limit,
      exportAll,
      search,
      platformSource,
      orderStatus,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      skipMeta,
    });

    return apiSuccess({
      data: result.rows,
      summary: result.summary,
      platformSources: result.platformSources,
      orderStatuses: result.orderStatuses,
      pagination: {
        page,
        limit,
        total: result.totalRows,
        totalPages: Math.ceil(result.totalRows / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching sales orders:", error);
    return handleApiError(error);
  }
}
