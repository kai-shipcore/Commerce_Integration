// Code Guide: Lists Excel import batches for one invoice. Each batch is backed
// by the uploaded source file linked from fc_invoice_items.source_file_id.

import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id } = await params;
    const data = await InvoicePriceControlService.listImportBatches(id);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
