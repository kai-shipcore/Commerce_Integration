import { NextRequest, NextResponse } from "next/server";
import {
  getSalesOrders,
  type SalesOrdersQueryOptions,
} from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

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

    const cacheKey = `orders:v2:${page}:${limit}:${sortBy}:${sortOrder}:${search}:${platformSource}:${orderStatus}:${startDate}:${endDate}`;

    if (!exportAll) {
      const cached = await CacheManager.get<object>(cacheKey);
      if (cached) return NextResponse.json(cached);
    }

    const result = await getSalesOrders({
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

    const response = {
      success: true,
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
    };

    if (!exportAll) {
      await CacheManager.set(cacheKey, response, 120);
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Error fetching sales orders:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
