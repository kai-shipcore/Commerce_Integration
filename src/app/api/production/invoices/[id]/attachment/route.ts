// Code Guide: Upload the original (or signed) invoice file as a reference
// attachment. Reuses the existing shipcore.fc_price_list_files blob table --
// no separate storage or download route needed; downloads go through the
// existing /api/production/price-history/files/[id] route, which only
// depends on the file id and the shared invoice-price-control permission.

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const isSigned = searchParams.get("signed") === "true";

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return apiError("file is required", 400);
    }

    const data = await InvoicePriceControlService.uploadAttachment(id, file, isSigned);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
