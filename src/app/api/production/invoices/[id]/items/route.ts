// Code Guide: Add a single manual SKU line item to an invoice, running the
// price-history comparison inline and re-deriving the invoice's status.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { insertInvoiceItemWithComparison, recalculateInvoiceStatus, withInvoiceTransaction } from "@/lib/invoice-comparison";

const ItemCreateSchema = z.object({
  sku: z.string().trim().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();
    const body = await request.json();
    const parsed = ItemCreateSchema.parse(body);

    const invoiceResult = await getPrimaryPool().query(
      `SELECT invoice_number, factory_id::text AS factory_id, invoice_date::text AS invoice_date
       FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (invoiceResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }
    const invoice = invoiceResult.rows[0];

    const item = await withInvoiceTransaction(async (client) => {
      const inserted = await insertInvoiceItemWithComparison(client, id, invoice.factory_id, invoice.invoice_date, {
        sku: parsed.sku,
        qty: parsed.qty,
        unitPrice: parsed.unitPrice,
      });
      await recalculateInvoiceStatus(client, id);
      return inserted;
    });

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: invoice.invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "items_update",
      after: { added: parsed },
    });

    return NextResponse.json({ success: true, data: item }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
