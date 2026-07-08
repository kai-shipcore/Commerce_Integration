// Code Guide: Upload the original (or signed) invoice file as a reference
// attachment. Reuses the existing shipcore.fc_price_list_files blob table --
// no separate storage or download route needed; downloads go through the
// existing /api/production/price-history/files/[id] route, which only
// depends on the file id and the shared invoice-price-control permission.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const isSigned = searchParams.get("signed") === "true";

    const invoiceResult = await getPrimaryPool().query(
      `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (invoiceResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileResult = await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_price_list_files
         (original_name, mime_type, size_bytes, file_data, uploaded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id::text AS id`,
      [file.name, file.type || null, buffer.byteLength, buffer, session?.user?.id ?? null],
    );
    const fileId = fileResult.rows[0].id as string;

    const column = isSigned ? "signed_attachment_file_id" : "attachment_file_id";
    await getPrimaryPool().query(
      `UPDATE shipcore.fc_invoices SET ${column} = $2::bigint, updated_at = NOW() WHERE id = $1::bigint`,
      [id, fileId],
    );

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: invoiceResult.rows[0].invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "attachment_update",
      after: { fileId, signed: isSigned },
    });

    return NextResponse.json({ success: true, data: { fileId } });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
