/**
 * Code Guide:
 * This API route owns the skus backend workflow.
 * Controller layer only: parses the request, validates input, delegates to
 * SkuService, and formats the response. Business logic and data access live
 * in src/lib/skus/service.ts and src/lib/skus/repository.ts.
 *
 * Read-only: this list endpoint is still consumed as a SKU picker by the
 * Sales/Collections forms and the Analytics overview. The create/edit/delete
 * SKU management UI (the standalone /skus page) has been removed since it
 * was hidden from navigation and unreachable.
 */

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { SkuService, resolveSalesPeriodDays } from "@/lib/skus/service";

// GET /api/skus - List products from sc_products + sc_inventory_snapshot
export async function GET(request: NextRequest) {
  const denied = await guardPermission("sku-master", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const sortBy = searchParams.get("sortBy") || "masterSkuCode";
    const sortOrder = searchParams.get("sortOrder") === "desc" ? "desc" : "asc";
    const search = searchParams.get("search")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const salesPeriodDays = resolveSalesPeriodDays(searchParams.get("salesPeriod"));

    const result = await SkuService.listSkus({
      page,
      limit,
      sortBy,
      sortOrder,
      search,
      category,
      salesPeriodDays,
    });

    return apiSuccess(result);
  } catch (error: unknown) {
    console.error("Error fetching SKUs:", error);
    return handleApiError(error);
  }
}
