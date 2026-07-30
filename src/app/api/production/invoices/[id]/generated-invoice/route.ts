// Code Guide: Generates a commercial invoice workbook for a selected Invoice,
// matching the factory-provided sample layout used by Invoice Price Control.
// Controller layer only: the ExcelJS document generation itself lives in
// src/lib/invoice-price-control/invoice-document.ts.

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { generateInvoiceDocument } from "@/lib/invoice-price-control/invoice-document";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  const { id } = await params;
  const generated = await generateInvoiceDocument(id);
  if (!generated) return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });

  return new NextResponse(generated.buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${generated.fileName}"; filename*=UTF-8''${encodeURIComponent(generated.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
