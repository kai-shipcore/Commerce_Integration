// Code Guide: Explicit "재검수" action -- re-runs the price comparison for
// every line on an invoice against the current fc_sku_price_history. Needed
// because factories often send their price list after the invoice itself,
// so lines entered as "no_price_history" can become comparable later.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { recalculateInvoiceStatus, recompareInvoiceItems, withInvoiceTransaction } from "@/lib/invoice-comparison";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();

    const invoiceResult = await getPrimaryPool().query(
      `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (invoiceResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    const who = session?.user?.name ?? session?.user?.email ?? null;
    await withInvoiceTransaction(async (client) => {
      await recompareInvoiceItems(client, id);
      await recalculateInvoiceStatus(client, id);
      await client.query(
        `UPDATE shipcore.fc_invoices SET last_compared_at = NOW(), last_compared_by = $2, updated_at = NOW() WHERE id = $1::bigint`,
        [id, who],
      );
    });

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: invoiceResult.rows[0].invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "recompare",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
