// Code Guide: Explicit "재검수" action -- re-runs the price comparison for
// every line on an invoice against the current fc_sku_price_history. Needed
// because factories often send their price list after the invoice itself,
// so lines entered as "no_price_history" can become comparable later.

import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    await InvoicePriceControlService.recompareInvoice(id);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
