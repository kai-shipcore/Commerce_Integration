// Code Guide: Shows and deletes invoice line items created from one uploaded
// Excel file. The delete path is intentionally scoped to one invoice.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { recalculateInvoiceStatus, withInvoiceTransaction } from "@/lib/invoice-comparison";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rowToItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sku: row.sku as string,
    qty: Number(row.qty),
    invoiceUnitPrice: Number(row.invoice_unit_price),
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
    result: row.result as string,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sourceFileId: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id, sourceFileId } = await params;
    const result = await getPrimaryPool().query(
      `SELECT
         f.id::text AS source_file_id,
         f.original_name,
         f.size_bytes,
         COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
         f.created_at,
         i.id::text AS id,
         i.sku,
         i.qty,
         i.invoice_unit_price,
         i.expected_unit_price,
         i.diff_unit_price,
         i.result::text AS result
       FROM shipcore.fc_price_list_files f
       JOIN shipcore.fc_invoice_items i ON i.source_file_id = f.id
       LEFT JOIN shipcore.fc_user u ON u.id = f.uploaded_by
       WHERE i.invoice_id = $1::bigint
         AND i.source_file_id = $2::bigint
       ORDER BY i.id ASC`,
      [id, sourceFileId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Upload batch not found" }, { status: 404 });
    }

    const first = result.rows[0];
    return NextResponse.json({
      success: true,
      data: {
        sourceFileId: first.source_file_id as string,
        originalName: first.original_name as string,
        sizeBytes: Number(first.size_bytes ?? 0),
        uploadedBy: first.uploaded_by_display as string | null,
        createdAt: first.created_at instanceof Date ? first.created_at.toISOString() : String(first.created_at),
        items: result.rows.map(rowToItem),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sourceFileId: string }> }) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id, sourceFileId } = await params;
    const session = await auth();

    const result = await withInvoiceTransaction(async (client) => {
      const invoiceResult = await client.query(
        `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
        [id],
      );
      if (invoiceResult.rowCount === 0) {
        return { notFound: true, deletedRows: 0, invoiceNumber: null as string | null, originalName: null as string | null };
      }

      const fileResult = await client.query(
        `SELECT original_name FROM shipcore.fc_price_list_files WHERE id = $1::bigint`,
        [sourceFileId],
      );

      const deleted = await client.query(
        `DELETE FROM shipcore.fc_invoice_items
         WHERE invoice_id = $1::bigint
           AND source_file_id = $2::bigint`,
        [id, sourceFileId],
      );
      if ((deleted.rowCount ?? 0) === 0) {
        return {
          notFound: true,
          deletedRows: 0,
          invoiceNumber: invoiceResult.rows[0].invoice_number as string,
          originalName: fileResult.rows[0]?.original_name as string | null,
        };
      }

      await recalculateInvoiceStatus(client, id);
      await client.query(
        `UPDATE shipcore.fc_invoices
         SET attachment_file_id = CASE WHEN attachment_file_id = $2::bigint THEN NULL ELSE attachment_file_id END,
             updated_at = NOW()
         WHERE id = $1::bigint`,
        [id, sourceFileId],
      );
      await client.query(
        `DELETE FROM shipcore.fc_price_list_files f
         WHERE f.id = $1::bigint
           AND NOT EXISTS (SELECT 1 FROM shipcore.fc_invoice_items i WHERE i.source_file_id = f.id)
           AND NOT EXISTS (SELECT 1 FROM shipcore.fc_sku_price_history h WHERE h.source_file_id = f.id)
           AND NOT EXISTS (SELECT 1 FROM shipcore.fc_invoices inv WHERE inv.attachment_file_id = f.id OR inv.signed_attachment_file_id = f.id)`,
        [sourceFileId],
      );

      return {
        notFound: false,
        deletedRows: deleted.rowCount ?? 0,
        invoiceNumber: invoiceResult.rows[0].invoice_number as string,
        originalName: fileResult.rows[0]?.original_name as string | null,
      };
    });

    if (result.notFound) {
      return NextResponse.json({ success: false, error: "Upload batch not found" }, { status: 404 });
    }

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: result.invoiceNumber,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "items_update",
      after: { deletedImportSourceFileId: sourceFileId, originalName: result.originalName, deletedRows: result.deletedRows },
    });

    return NextResponse.json({ success: true, data: { deletedRows: result.deletedRows } });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
