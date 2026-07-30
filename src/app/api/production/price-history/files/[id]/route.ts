// Code Guide: Download an uploaded price list source file by id.

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  const { id } = await params;
  const file = await InvoicePriceControlService.findPriceListFile(id);
  if (!file) return NextResponse.json({ success: false, error: "File not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.fileData), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.originalName.replace(/"/g, "")}"`,
    },
  });
}
