// Code Guide: Bulk-create Credit 관리 records from the Invoice 검수 tab's
// "선택 항목 내보내기" action. One credit note per overcharged invoice item;
// items that already have a credit note (unique index on source_invoice_item_id)
// are silently skipped so re-exporting the same lines never duplicates credits.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

const BulkCreateSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json();
    const parsed = BulkCreateSchema.parse(body);

    const itemsResult = await getPrimaryPool().query(
      `SELECT
         ii.id AS item_id,
         ii.invoice_id,
         ii.sku,
         ii.qty,
         ii.invoice_unit_price,
         ii.expected_unit_price,
         ii.diff_unit_price,
         i.invoice_number,
         i.factory_id,
         i.container_id,
         i.container_number
       FROM shipcore.fc_invoice_items ii
       JOIN shipcore.fc_invoices i ON i.id = ii.invoice_id
       WHERE ii.id = ANY($1::bigint[])
         AND ii.result = 'overcharged'`,
      [parsed.itemIds],
    );

    if (itemsResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "과청구(overcharged) 라인이 없습니다." }, { status: 400 });
    }

    const who = session?.user?.name ?? session?.user?.email ?? null;
    let created = 0;
    let skipped = 0;

    for (const row of itemsResult.rows) {
      const creditAmount = Number(row.qty) * Number(row.diff_unit_price ?? 0);
      const insertResult = await getPrimaryPool().query(
        `INSERT INTO shipcore.fc_credit_notes
           (factory_id, container_id, container_number, source_invoice_id, source_invoice_item_id, sku,
            expected_unit_price, invoice_unit_price, qty, credit_amount, created_by, requested_at)
         VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5::bigint, $6, $7::numeric, $8::numeric, $9::int, $10::numeric, $11, NOW())
         ON CONFLICT (source_invoice_item_id) WHERE source_invoice_item_id IS NOT NULL DO NOTHING
         RETURNING id::text AS id`,
        [
          row.factory_id,
          row.container_id,
          row.container_number,
          row.invoice_id,
          row.item_id,
          row.sku,
          row.expected_unit_price,
          row.invoice_unit_price,
          row.qty,
          creditAmount,
          who,
        ],
      );

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        created += 1;
        void logInvoiceAudit({
          invoiceId: String(row.invoice_id),
          invoiceNumber: row.invoice_number,
          userId: session?.user?.id ?? null,
          userName: session?.user?.name ?? null,
          userEmail: session?.user?.email ?? null,
          action: "credit_note_create",
          after: { creditNoteId: insertResult.rows[0].id, sku: row.sku, creditAmount, source: "bulk_export" },
        });
      } else {
        skipped += 1;
      }
    }

    return NextResponse.json({ success: true, data: { created, skipped } });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
