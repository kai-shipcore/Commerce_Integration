/**
 * Code Guide:
 * This API route owns the skus / [id] backend workflow.
 * Controller layer only: parses the request, validates input, delegates to
 * SkuService, and formats the response. Business logic and data access live
 * in src/lib/skus/service.ts and src/lib/skus/repository.ts.
 *
 * Read-only: this detail endpoint backs the /skus/[id] page, which is still
 * linked from Dashboard/Analytics/Collections. The edit/delete SKU management
 * UI (the standalone /skus list page) has been removed since it was hidden
 * from navigation and unreachable.
 */

import { NextRequest } from "next/server";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { SkuService } from "@/lib/skus/service";

// GET /api/skus/[id] - Get a single product by master_sku
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await SkuService.getSkuDetail(id);
    return apiSuccess({ data });
  } catch (error: unknown) {
    console.error("Error fetching SKU:", error);
    return handleApiError(error);
  }
}
