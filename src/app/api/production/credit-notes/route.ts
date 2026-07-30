// Code Guide: List + manual-create API for the Credit 관리 tab. Formalizes credit
// tracking that previously only lived as inline flags on fc_invoice_items.
// Controller layer only: delegates to InvoicePriceControlService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const CreditNoteCreateSchema = z.object({
  sourceInvoiceId: z.string().min(1),
  sku: z.string().trim().min(1),
  expectedUnitPrice: z.number().nonnegative().nullable().optional(),
  invoiceUnitPrice: z.number().nonnegative(),
  qty: z.number().int().positive(),
  creditAmount: z.number().nonnegative().optional(),
  note: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const data = await InvoicePriceControlService.listCreditNotes({
      factoryId: searchParams.get("factoryId")?.trim() ?? "",
      search: searchParams.get("search")?.trim() ?? "",
      statusCsv: searchParams.get("status")?.trim() ?? "",
    });
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const body = await request.json();
    const parsed = CreditNoteCreateSchema.parse(body);
    const data = await InvoicePriceControlService.createCreditNote(parsed);
    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
