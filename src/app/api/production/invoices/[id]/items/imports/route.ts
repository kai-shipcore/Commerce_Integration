// Code Guide: Lists Excel import batches for one invoice. Each batch is backed
// by the uploaded source file linked from fc_invoice_items.source_file_id.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rowToImportBatch(row: Record<string, unknown>) {
  return {
    sourceFileId: String(row.source_file_id),
    originalName: row.original_name as string,
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedBy: row.uploaded_by_display as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rowCount: Number(row.row_count ?? 0),
    skuCount: Number(row.sku_count ?? 0),
    totalQty: Number(row.total_qty ?? 0),
    invoiceTotal: Number(row.invoice_total ?? 0),
    errorCount: Number(row.error_count ?? 0),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id } = await params;
    const result = await getPrimaryPool().query(
      `SELECT
         i.source_file_id::text AS source_file_id,
         f.original_name,
         f.size_bytes,
         COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
         f.created_at,
         COUNT(i.id)::int AS row_count,
         COUNT(DISTINCT i.sku)::int AS sku_count,
         COALESCE(SUM(i.qty), 0)::int AS total_qty,
         COALESCE(SUM(i.qty * i.invoice_unit_price), 0)::numeric AS invoice_total,
         COUNT(*) FILTER (WHERE i.result IN ('price_error', 'overcharged'))::int AS error_count
       FROM shipcore.fc_invoice_items i
       JOIN shipcore.fc_price_list_files f ON f.id = i.source_file_id
       LEFT JOIN shipcore.fc_user u ON u.id = f.uploaded_by
       WHERE i.invoice_id = $1::bigint
         AND i.source_file_id IS NOT NULL
       GROUP BY i.source_file_id, f.id, u.name, u.email
       ORDER BY f.created_at DESC, i.source_file_id DESC`,
      [id],
    );

    return NextResponse.json({ success: true, data: result.rows.map(rowToImportBatch) });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
