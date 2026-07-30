// Code Guide: Detail read/update/delete API for a single invoice, used by the
// Invoice Review right-hand panel.
// Controller layer only: PATCH tries a status-only schema first (used by the
// board's drag-and-drop status change), falling back to the full details
// schema — this dispatch stays here since it's driven by the request shape,
// not business logic. Delegates to InvoicePriceControlService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getIp } from "@/lib/audit";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const InvoiceStatusSchema = z.enum([
  "received",
  "price_review",
  "discrepancy_found",
  "factory_confirmation",
  "approved",
  "signed",
  "sent_to_factory",
]);

const InvoiceDetailsSchema = z.object({
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  containerId: z.string().trim().optional(),
  containerNumber: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).strict();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id } = await params;
    const data = await InvoicePriceControlService.getInvoiceDetail(id);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const ip = getIp(request.headers);
    const body: unknown = await request.json();

    const statusOnly = z.object({ status: InvoiceStatusSchema }).strict().safeParse(body);
    if (statusOnly.success) {
      const data = await InvoicePriceControlService.updateInvoiceStatus(id, statusOnly.data.status, ip);
      return apiSuccess({ data });
    }

    const details = InvoiceDetailsSchema.parse(body);
    const data = await InvoicePriceControlService.updateInvoiceDetails(id, details, ip);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id } = await params;
    await InvoicePriceControlService.deleteInvoice(id, getIp(request.headers));
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
