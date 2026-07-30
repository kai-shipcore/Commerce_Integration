// Code Guide: Add a single manual SKU line item to an invoice, running the
// price-history comparison inline and re-deriving the invoice's status.
// Controller layer only: delegates to InvoicePriceControlService, which owns
// the price-comparison transaction.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const ItemCreateSchema = z.object({
  sku: z.string().trim().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = ItemCreateSchema.parse(body);
    const data = await InvoicePriceControlService.addInvoiceItem(id, parsed);
    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
