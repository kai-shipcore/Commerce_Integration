// Code Guide: Edit/delete a single invoice line item -- covers three distinct
// edits (line data, credit tracking, factory-confirmation tracking) behind
// one PATCH handler, matching the containers API's status-vs-details branch
// pattern.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { recalculateInvoiceStatus, recompareInvoiceItems, withInvoiceTransaction } from "@/lib/invoice-comparison";

const LineEditSchema = z.object({
  sku: z.string().trim().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
}).strict();

const CreditEditSchema = z.object({
  creditStatus: z.enum(["requested", "confirmed", "applied"]).nullable(),
}).strict();

const FactoryConfirmEditSchema = z.object({
  factoryConfirmAction: z.enum(["request", "confirm"]),
}).strict();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function assertItemBelongsToInvoice(invoiceId: string, itemId: string) {
  const result = await getPrimaryPool().query(
    `SELECT
       i.invoice_id::text AS invoice_id,
       inv.invoice_number,
       i.sku,
       i.qty,
       i.invoice_unit_price,
       i.credit_status::text AS credit_status,
       i.factory_confirm_requested_at,
       i.factory_confirm_confirmed_at
     FROM shipcore.fc_invoice_items i
     JOIN shipcore.fc_invoices inv ON inv.id = i.invoice_id
     WHERE i.id = $1::bigint`,
    [itemId],
  );
  if (result.rowCount === 0 || result.rows[0].invoice_id !== invoiceId) return null;
  return result.rows[0] as {
    invoice_id: string;
    invoice_number: string;
    sku: string;
    qty: number;
    invoice_unit_price: string | number;
    credit_status: string | null;
    factory_confirm_requested_at: Date | null;
    factory_confirm_confirmed_at: Date | null;
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id, itemId } = await params;
    const session = await auth();
    const body: unknown = await request.json();

    const owner = await assertItemBelongsToInvoice(id, itemId);
    if (!owner) return NextResponse.json({ success: false, error: "Invoice item not found" }, { status: 404 });

    const lineEdit = LineEditSchema.safeParse(body);
    if (lineEdit.success) {
      await withInvoiceTransaction(async (client) => {
        await client.query(
          `UPDATE shipcore.fc_invoice_items
           SET sku = UPPER($2), qty = $3::int, invoice_unit_price = $4::numeric, updated_at = NOW()
           WHERE id = $1::bigint`,
          [itemId, lineEdit.data.sku, lineEdit.data.qty, lineEdit.data.unitPrice],
        );
        await recompareInvoiceItems(client, id);
        await recalculateInvoiceStatus(client, id);
      });

      void logInvoiceAudit({
        invoiceId: id,
        invoiceNumber: owner.invoice_number,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "items_update",
        before: {
          itemId,
          sku: owner.sku,
          qty: Number(owner.qty),
          unitPrice: Number(owner.invoice_unit_price),
        },
        after: { itemId, ...lineEdit.data },
      });

      return NextResponse.json({ success: true });
    }

    const creditEdit = CreditEditSchema.safeParse(body);
    if (creditEdit.success) {
      await getPrimaryPool().query(
        `UPDATE shipcore.fc_invoice_items
         SET credit_status = $2,
             credit_updated_by = $3,
             credit_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1::bigint`,
        [itemId, creditEdit.data.creditStatus, session?.user?.name ?? session?.user?.email ?? null],
      );

      void logInvoiceAudit({
        invoiceId: id,
        invoiceNumber: owner.invoice_number,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "credit_update",
        before: { itemId, creditStatus: owner.credit_status },
        after: { itemId, creditStatus: creditEdit.data.creditStatus },
      });

      return NextResponse.json({ success: true });
    }

    const confirmEdit = FactoryConfirmEditSchema.safeParse(body);
    if (confirmEdit.success) {
      const who = session?.user?.name ?? session?.user?.email ?? null;
      const column = confirmEdit.data.factoryConfirmAction === "request"
        ? { by: "factory_confirm_requested_by", at: "factory_confirm_requested_at" }
        : { by: "factory_confirm_confirmed_by", at: "factory_confirm_confirmed_at" };

      await getPrimaryPool().query(
        `UPDATE shipcore.fc_invoice_items
         SET ${column.by} = $2, ${column.at} = NOW(), updated_at = NOW()
         WHERE id = $1::bigint`,
        [itemId, who],
      );

      void logInvoiceAudit({
        invoiceId: id,
        invoiceNumber: owner.invoice_number,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "factory_confirm_update",
        before: {
          itemId,
          requestedAt: owner.factory_confirm_requested_at?.toISOString() ?? null,
          confirmedAt: owner.factory_confirm_confirmed_at?.toISOString() ?? null,
        },
        after: { itemId, action: confirmEdit.data.factoryConfirmAction },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id, itemId } = await params;
    const session = await auth();
    const owner = await assertItemBelongsToInvoice(id, itemId);
    if (!owner) return NextResponse.json({ success: false, error: "Invoice item not found" }, { status: 404 });

    await withInvoiceTransaction(async (client) => {
      await client.query(`DELETE FROM shipcore.fc_invoice_items WHERE id = $1::bigint`, [itemId]);
      await recalculateInvoiceStatus(client, id);
    });

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: owner.invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "items_update",
      before: {
        itemId,
        sku: owner.sku,
        qty: Number(owner.qty),
        unitPrice: Number(owner.invoice_unit_price),
        creditStatus: owner.credit_status,
      },
      after: { removedItemId: itemId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
