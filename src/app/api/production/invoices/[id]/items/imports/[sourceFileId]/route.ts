// Code Guide: Shows and deletes invoice line items created from one uploaded
// Excel file. The delete path is intentionally scoped to one invoice.
// Both a missing invoice and a batch with zero matching rows map to the same
// "Upload batch not found" 404 -- preserved as-is from the original route.

import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sourceFileId: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id, sourceFileId } = await params;
    const data = await InvoicePriceControlService.getImportBatchDetail(id, sourceFileId);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sourceFileId: string }> }) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id, sourceFileId } = await params;
    const data = await InvoicePriceControlService.deleteImportBatch(id, sourceFileId);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
