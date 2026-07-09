// Code Guide: Excel/CSV bulk import of invoice SKU lines. Mirrors the parsing
// pattern used by /api/production/price-history (XLSX + flexible column
// matching) since PDF invoices are not auto-parsed -- staff export/prepare a
// spreadsheet of the invoice's SKU/qty/price lines instead.

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { insertInvoiceItemWithComparison, recalculateInvoiceStatus, withInvoiceTransaction } from "@/lib/invoice-comparison";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pickValue(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
    const found = entries.find(([key]) => key.toLowerCase().replace(/[\s_-]/g, "") === normalized);
    if (found) return found[1];
  }
  return undefined;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();

    const invoiceResult = await getPrimaryPool().query(
      `SELECT invoice_number, factory_id::text AS factory_id, invoice_date::text AS invoice_date
       FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (invoiceResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }
    const invoice = invoiceResult.rows[0];

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

    const errors: string[] = [];
    const parsedRows: Array<{ sku: string; qty: number; unitPrice: number }> = [];

    rows.forEach((row, index) => {
      const rowNo = index + 2;
      const sku = String(pickValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
      const qty = Number(pickValue(row, ["qty", "quantity"]));
      const rawPrice = pickValue(row, ["unit_price", "unit price", "price", "cost", "invoice_price", "invoice price"]);
      const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));

      if (!sku || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        errors.push(`Row ${rowNo}: sku, qty, unit_price are required`);
        return;
      }
      parsedRows.push({ sku, qty, unitPrice });
    });

    let sourceFileId: string | null = null;

    await withInvoiceTransaction(async (client) => {
      const fileResult = await client.query(
        `INSERT INTO shipcore.fc_price_list_files
           (original_name, mime_type, size_bytes, file_data, uploaded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id::text AS id`,
        [file.name, file.type || null, buffer.byteLength, buffer, session?.user?.id ?? null],
      );
      sourceFileId = fileResult.rows[0].id;

      for (const parsedRow of parsedRows) {
        await insertInvoiceItemWithComparison(client, id, invoice.factory_id, invoice.invoice_date, {
          ...parsedRow,
          sourceFileId,
        });
      }
      await recalculateInvoiceStatus(client, id);
    });

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: invoice.invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "items_update",
      after: { imported: parsedRows.length, errors, sourceFileId },
    });

    return NextResponse.json({
      success: true,
      data: { sourceFileId, imported: parsedRows.length, errors },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
