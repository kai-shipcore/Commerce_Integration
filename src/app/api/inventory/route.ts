import { NextRequest, NextResponse } from "next/server";
import {
  getCoverlandInventory,
  isLookupConnectionError,
} from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const exportAll = searchParams.get("exportAll") === "true";
    const groupBy = searchParams.get("groupBy") === "product" ? "product" : "warehouse";
    const search = searchParams.get("search") || "";
    const warehouse = searchParams.get("warehouse") || "all";
    const sortBy = searchParams.get("sortBy") || "masterSku";
    const sortOrder = searchParams.get("sortOrder") === "desc" ? "desc" : "asc";

    const result = await getCoverlandInventory({
      page,
      limit,
      exportAll,
      groupBy,
      search,
      warehouse,
      sortBy: sortBy as
        | "masterSku"
        | "warehouse"
        | "warehouseCount"
        | "onHand"
        | "allocated"
        | "available"
        | "backorder"
        | "createdAt",
      sortOrder,
    });

    return NextResponse.json({
      success: true,
      data: result.rows,
      warehouses: result.warehouses,
      summary: {
        totalRows: result.totalRows,
        totalProducts: result.totalProducts,
        totalWarehouses: result.totalWarehouses,
        ...result.totals,
      },
      pagination: {
        page,
        limit,
        total: result.totalRows,
        totalPages: Math.ceil(result.totalRows / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching external inventory:", error);

    if (isLookupConnectionError(error)) {
      return NextResponse.json({
        success: true,
        data: [],
        warehouses: [],
        summary: {
          totalRows: 0,
          totalProducts: 0,
          totalWarehouses: 0,
          onHand: 0,
          allocated: 0,
          available: 0,
          backorder: 0,
        },
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
        degraded: true,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
