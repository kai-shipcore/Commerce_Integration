// Code Guide: Status transitions (confirm/apply), field edits, and delete for a
// single Credit 관리 record.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

const ConfirmSchema = z.object({ status: z.literal("confirmed") }).strict();
const ApplySchema = z.object({
  status: z.literal("applied"),
  appliedInvoiceId: z.string().min(1),
  appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const RevertSchema = z.object({ revert: z.literal(true) }).strict();
const EditSchema = z.object({
  creditAmount: z.number().nonnegative().optional(),
  note: z.string().trim().optional(),
}).strict().refine((data) => data.creditAmount !== undefined || data.note !== undefined, {
  message: "creditAmount 또는 note 중 하나는 있어야 합니다.",
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await auth();
    const body: unknown = await request.json();
    const who = session?.user?.name ?? session?.user?.email ?? null;

    const existingResult = await getPrimaryPool().query(
      `SELECT source_invoice_id, sku, status::text AS status FROM shipcore.fc_credit_notes WHERE id = $1::bigint`,
      [id],
    );
    if (existingResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Credit 레코드를 찾을 수 없습니다." }, { status: 404 });
    }
    const existing = existingResult.rows[0];

    const confirmParsed = ConfirmSchema.safeParse(body);
    if (confirmParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;

      if (existing.status !== "pending") {
        return NextResponse.json({ success: false, error: "Pending 상태의 Credit만 확인 처리할 수 있습니다." }, { status: 400 });
      }

      await getPrimaryPool().query(
        `UPDATE shipcore.fc_credit_notes SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
        [id],
      );
      void logInvoiceAudit({
        invoiceId: existing.source_invoice_id,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "credit_note_status_change",
        before: { status: existing.status },
        after: { status: "confirmed", creditNoteId: id, sku: existing.sku },
      });
      return NextResponse.json({ success: true });
    }

    const applyParsed = ApplySchema.safeParse(body);
    if (applyParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;

      if (existing.status !== "confirmed") {
        return NextResponse.json({ success: false, error: "Confirmed 상태의 Credit만 적용할 수 있습니다." }, { status: 400 });
      }
      const invoiceResult = await getPrimaryPool().query(
        `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
        [applyParsed.data.appliedInvoiceId],
      );
      if (invoiceResult.rowCount === 0) {
        return NextResponse.json({ success: false, error: "적용할 Invoice를 찾을 수 없습니다." }, { status: 404 });
      }

      await getPrimaryPool().query(
        `UPDATE shipcore.fc_credit_notes
         SET status = 'applied', applied_invoice_id = $2::bigint, applied_date = $3::date, applied_at = NOW(), updated_at = NOW()
         WHERE id = $1::bigint`,
        [id, applyParsed.data.appliedInvoiceId, applyParsed.data.appliedDate],
      );
      void logInvoiceAudit({
        invoiceId: existing.source_invoice_id,
        userId: session?.user?.id ?? null,
        userName: session?.user?.name ?? null,
        userEmail: session?.user?.email ?? null,
        action: "credit_note_status_change",
        before: { status: existing.status },
        after: {
          status: "applied",
          creditNoteId: id,
          sku: existing.sku,
          appliedInvoiceNumber: invoiceResult.rows[0].invoice_number,
          appliedDate: applyParsed.data.appliedDate,
        },
      });
      return NextResponse.json({ success: true });
    }

    const revertParsed = RevertSchema.safeParse(body);
    if (revertParsed.success) {
      const denied = await guardPermission("invoice-price-control", "status");
      if (denied) return denied;

      if (existing.status === "applied") {
        await getPrimaryPool().query(
          `UPDATE shipcore.fc_credit_notes
           SET status = 'confirmed', applied_invoice_id = NULL, applied_date = NULL, applied_at = NULL, updated_at = NOW()
           WHERE id = $1::bigint`,
          [id],
        );
        void logInvoiceAudit({
          invoiceId: existing.source_invoice_id,
          userId: session?.user?.id ?? null,
          userName: who,
          userEmail: session?.user?.email ?? null,
          action: "credit_note_status_change",
          before: { status: existing.status },
          after: { status: "confirmed", reverted: true, creditNoteId: id, sku: existing.sku },
        });
        return NextResponse.json({ success: true });
      }

      if (existing.status === "confirmed") {
        await getPrimaryPool().query(
          `UPDATE shipcore.fc_credit_notes SET status = 'pending', confirmed_at = NULL, updated_at = NOW() WHERE id = $1::bigint`,
          [id],
        );
        void logInvoiceAudit({
          invoiceId: existing.source_invoice_id,
          userId: session?.user?.id ?? null,
          userName: who,
          userEmail: session?.user?.email ?? null,
          action: "credit_note_status_change",
          before: { status: existing.status },
          after: { status: "pending", reverted: true, creditNoteId: id, sku: existing.sku },
        });
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ success: false, error: "Pending 상태는 되돌릴 수 없습니다." }, { status: 400 });
    }

    const editParsed = EditSchema.safeParse(body);
    if (editParsed.success) {
      const denied = await guardPermission("invoice-price-control", "edit");
      if (denied) return denied;

      const sets: string[] = [];
      const values: unknown[] = [id];
      if (editParsed.data.creditAmount !== undefined) {
        values.push(editParsed.data.creditAmount);
        sets.push(`credit_amount = $${values.length}::numeric`);
      }
      if (editParsed.data.note !== undefined) {
        values.push(editParsed.data.note || null);
        sets.push(`note = $${values.length}`);
      }
      sets.push("updated_at = NOW()");

      await getPrimaryPool().query(
        `UPDATE shipcore.fc_credit_notes SET ${sets.join(", ")} WHERE id = $1::bigint`,
        values,
      );
      void logInvoiceAudit({
        invoiceId: existing.source_invoice_id,
        userId: session?.user?.id ?? null,
        userName: who,
        userEmail: session?.user?.email ?? null,
        action: "credit_note_status_change",
        after: { creditNoteId: id, sku: existing.sku, ...editParsed.data },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();

    const existingResult = await getPrimaryPool().query(
      `SELECT source_invoice_id, sku, status::text AS status FROM shipcore.fc_credit_notes WHERE id = $1::bigint`,
      [id],
    );
    if (existingResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Credit 레코드를 찾을 수 없습니다." }, { status: 404 });
    }
    const existing = existingResult.rows[0];

    await getPrimaryPool().query(`DELETE FROM shipcore.fc_credit_notes WHERE id = $1::bigint`, [id]);

    void logInvoiceAudit({
      invoiceId: existing.source_invoice_id,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "credit_note_status_change",
      before: { status: existing.status },
      after: { deleted: true, creditNoteId: id, sku: existing.sku },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
