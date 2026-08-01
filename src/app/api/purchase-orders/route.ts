// Code Guide: Factory planning purchase orders (shipcore.fc_purchase_orders +
// fc_purchase_order_items). Controller layer only: parses/validates requests
// and delegates the workflow state machine, SKU validation, and factory
// upsert logic to PurchaseOrdersService.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { PurchaseOrdersService } from "@/lib/purchase-orders/service";
import { z } from "zod";

const WorkflowActionSchema = z.object({
  action: z.enum(["request_review", "approve", "reject", "send_to_factory"]),
});

const PurchaseOrderCreateSchema = z.object({
  number: z.string().trim().min(1),
  date: z.string().trim().min(1),
  eta: z.string().trim().min(1),
  factory: z.string().trim().min(1),
  destination: z.string().trim().optional(),
  manager: z.string().trim().optional(),
  note: z.string().trim().optional(),
  status: z.enum(["draft", "pending", "approved", "sent"]).default("draft"),
  items: z.array(z.object({
    sku: z.string().trim().min(1),
    moq: z.number().int().positive().default(5),
    qty: z.number().int().positive(),
    cbm: z.number().nonnegative().default(0),
    unitPrice: z.number().nonnegative().nullable().optional(),
  })).min(1),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get("nextNumber") === "true") {
      const nextNumber = await PurchaseOrdersService.getNextNumber();
      return apiSuccess({ data: { nextNumber } });
    }

    const search = searchParams.get("search")?.trim() ?? "";
    const data = await PurchaseOrdersService.listPurchaseOrders(search);
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const body = await request.json();
    const validated = PurchaseOrderCreateSchema.parse(body);

    const result = await PurchaseOrdersService.createPurchaseOrder(validated, session?.user?.id ?? null);
    return apiSuccess({ data: result }, 201);
  } catch (error) {
    console.error("Error creating purchase order:", error);
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) return apiError("Purchase order id is required", 400);
    if (!/^\d+$/.test(id)) return apiError("Invalid purchase order id", 400);

    if (searchParams.get("workflow") === "true") {
      const session = await auth();
      if (!session?.user?.id) return apiError("Unauthorized", 401);

      const body = await request.json();
      const { action } = WorkflowActionSchema.parse(body);

      const result = await PurchaseOrdersService.transitionWorkflow(id, action, session.user.role as string | undefined);
      return apiSuccess({ data: result });
    }

    const body = await request.json();
    const validated = PurchaseOrderCreateSchema.parse(body);

    const result = await PurchaseOrdersService.updatePurchaseOrder(id, validated);
    return apiSuccess({ data: result });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!isAdminLikeRole(session.user.role)) return apiError("Forbidden", 403);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) return apiError("Purchase order id is required", 400);
    if (!/^\d+$/.test(id)) return apiError("Invalid purchase order id", 400);

    const result = await PurchaseOrdersService.deletePurchaseOrder(id);
    return apiSuccess({ data: result });
  } catch (error) {
    console.error("Error deleting purchase order:", error);
    return handleApiError(error);
  }
}
