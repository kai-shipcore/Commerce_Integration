/**
 * Code Guide:
 * This API route owns the orders / [id] backend workflow.
 * Controller layer only: parses the request, delegates to OrderService, and
 * formats the response. Data access lives in
 * src/lib/orders/repository.ts.
 */

import { NextRequest } from "next/server";
import { OrderService } from "@/lib/orders/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const order = await OrderService.getOrderDetail(id);
    return apiSuccess({ data: order });
  } catch (error: unknown) {
    console.error("Error fetching sales order detail:", error);
    return handleApiError(error);
  }
}
