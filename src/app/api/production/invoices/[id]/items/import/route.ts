// Code Guide: Excel/CSV bulk import of invoice SKU lines. Mirrors the parsing
// pattern used by /api/production/price-history (XLSX + flexible column
// matching) since PDF invoices are not auto-parsed -- staff export/prepare a
// spreadsheet of the invoice's SKU/qty/price lines instead.
// Controller layer only: validates the multipart upload shape and delegates
// Excel parsing + the price-comparison transaction to InvoicePriceControlService.

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return apiError("file is required", 400);
    }

    const data = await InvoicePriceControlService.importInvoiceItemsFromExcel(id, file);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
