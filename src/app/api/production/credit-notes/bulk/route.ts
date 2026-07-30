// Code Guide: Bulk-create Credit 관리 records from the Invoice 검수 tab's
// "선택 항목 내보내기" action. One credit note per overcharged invoice item;
// items that already have a credit note (unique index on source_invoice_item_id)
// are silently skipped so re-exporting the same lines never duplicates credits.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const BulkCreateSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const body = await request.json();
    const parsed = BulkCreateSchema.parse(body);
    const data = await InvoicePriceControlService.bulkCreateCreditNotes(parsed.itemIds);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
