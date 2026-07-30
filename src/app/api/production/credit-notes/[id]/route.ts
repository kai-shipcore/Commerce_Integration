// Code Guide: Status transitions (confirm/apply), field edits, and delete for a
// single Credit 관리 record.
// Controller layer only: PATCH checks the record exists before any permission
// gate (preserved from the original route), then dispatches to a
// per-branch permission ("status" for confirm/apply/revert, "edit" for field
// edits) before calling the matching InvoicePriceControlService method.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

const ConfirmSchema = z.object({ status: z.literal("confirmed") }).strict();
const ApplySchema = z.object({
  status: z.literal("applied"),
  appliedInvoiceId: z.string().min(1),
  appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const RevertSchema = z.object({ revert: z.literal(true) }).strict();
const EditSchema = z.object({
  creditAmount: z.number().nonnegative().optional(),
  note: z.string().trim().optional(),
}).strict().refine((data) => data.creditAmount !== undefined || data.note !== undefined, {
  message: "creditAmount 또는 note 중 하나는 있어야 합니다.",
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body: unknown = await request.json();

    await InvoicePriceControlService.assertCreditNoteExists(id);

    const confirmParsed = ConfirmSchema.safeParse(body);
    if (confirmParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;
      await InvoicePriceControlService.confirmCreditNote(id);
      return apiSuccess({});
    }

    const applyParsed = ApplySchema.safeParse(body);
    if (applyParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;
      await InvoicePriceControlService.applyCreditNote(id, applyParsed.data.appliedInvoiceId, applyParsed.data.appliedDate);
      return apiSuccess({});
    }

    const revertParsed = RevertSchema.safeParse(body);
    if (revertParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;
      await InvoicePriceControlService.revertCreditNote(id);
      return apiSuccess({});
    }

    const editParsed = EditSchema.safeParse(body);
    if (editParsed.success) {
      const denied = await guardPermission("invoice-price-control", "edit");
      if (denied) return denied;
      await InvoicePriceControlService.editCreditNote(id, editParsed.data);
      return apiSuccess({});
    }

    return apiError("Invalid request body", 400);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id } = await params;
    await InvoicePriceControlService.deleteCreditNote(id);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
