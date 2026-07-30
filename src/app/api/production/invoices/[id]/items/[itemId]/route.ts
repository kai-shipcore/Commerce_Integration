// Code Guide: Edit/delete a single invoice line item -- covers three distinct
// edits (line data, credit tracking, factory-confirmation tracking) behind
// one PATCH handler, matching the containers API's status-vs-details branch
// pattern.
// Controller layer only: the three safeParse checks decide which edit kind to
// send to InvoicePriceControlService.editInvoiceItem (this dispatch stays here
// since it's driven by the request shape). Service does the single
// owner-fetch + transaction/audit logic.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

const LineEditSchema = z.object({
  sku: z.string().trim().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
}).strict();

const CreditEditSchema = z.object({
  creditStatus: z.enum(["requested", "confirmed", "applied"]).nullable(),
}).strict();

const FactoryConfirmEditSchema = z.object({
  factoryConfirmAction: z.enum(["request", "confirm"]),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id, itemId } = await params;
    const body: unknown = await request.json();

    const lineEdit = LineEditSchema.safeParse(body);
    if (lineEdit.success) {
      await InvoicePriceControlService.editInvoiceItem(id, itemId, { kind: "line", ...lineEdit.data });
      return apiSuccess({});
    }

    const creditEdit = CreditEditSchema.safeParse(body);
    if (creditEdit.success) {
      await InvoicePriceControlService.editInvoiceItem(id, itemId, { kind: "credit", creditStatus: creditEdit.data.creditStatus });
      return apiSuccess({});
    }

    const confirmEdit = FactoryConfirmEditSchema.safeParse(body);
    if (confirmEdit.success) {
      await InvoicePriceControlService.editInvoiceItem(id, itemId, { kind: "confirm", action: confirmEdit.data.factoryConfirmAction });
      return apiSuccess({});
    }

    return apiError("Invalid request body", 400);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id, itemId } = await params;
    await InvoicePriceControlService.removeInvoiceItem(id, itemId);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
