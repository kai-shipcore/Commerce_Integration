// Code Guide: Detail read/update/delete API for a single invoice, used by the
// Invoice Review right-hand panel.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

const InvoiceStatusSchema = z.enum([
  "received",
  "price_review",
  "discrepancy_found",
  "factory_confirmation",
  "approved",
  "signed",
  "sent_to_factory",
]);

const InvoiceDetailsSchema = z.object({
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  containerId: z.string().trim().optional(),
  containerNumber: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).strict();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function getRequestIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function rowToItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sku: row.sku as string,
    qty: Number(row.qty),
    invoiceUnitPrice: Number(row.invoice_unit_price),
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    expectedEffectiveDate: serializeDate(row.expected_effective_date),
    diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
    result: row.result as string,
    creditStatus: row.credit_status as string | null,
    creditAmount: row.credit_amount == null ? null : Number(row.credit_amount),
    factoryConfirmRequestedAt: row.factory_confirm_requested_at
      ? new Date(row.factory_confirm_requested_at as string).toISOString()
      : null,
    factoryConfirmConfirmedAt: row.factory_confirm_confirmed_at
      ? new Date(row.factory_confirm_confirmed_at as string).toISOString()
      : null,
  };
}

function rowToAppliedCredit(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sourceInvoiceId: row.source_invoice_id == null ? null : String(row.source_invoice_id),
    sourceInvoiceNumber: row.source_invoice_number as string | null,
    containerNumber: row.container_number as string | null,
    sku: row.sku as string,
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    invoiceUnitPrice: row.invoice_unit_price == null ? null : Number(row.invoice_unit_price),
    qty: Number(row.qty),
    creditAmount: Number(row.credit_amount),
    appliedDate: serializeDate(row.applied_date),
    note: row.note as string | null,
  };
}

async function loadInvoiceDetail(id: string) {
  const pool = getPrimaryPool();
  const [headerResult, itemsResult, appliedCreditsResult] = await Promise.all([
    pool.query(
      `SELECT
         i.id::text AS id,
         i.invoice_number,
         i.factory_id::text AS factory_id,
         f.factory_name,
         i.container_id::text AS container_id,
         i.container_number,
         i.invoice_date::text AS invoice_date,
         i.status::text AS status,
         i.attachment_file_id::text AS attachment_file_id,
         i.signed_attachment_file_id::text AS signed_attachment_file_id,
         i.signed_by,
         i.signed_at,
         i.last_compared_at,
         i.note
       FROM shipcore.fc_invoices i
       JOIN shipcore.fc_factories f ON f.id = i.factory_id
       WHERE i.id = $1::bigint`,
      [id],
    ),
    pool.query(
      `SELECT * FROM shipcore.fc_invoice_items WHERE invoice_id = $1::bigint ORDER BY id ASC`,
      [id],
    ),
    pool.query(
      `SELECT
         cn.id::text AS id,
         cn.source_invoice_id::text AS source_invoice_id,
         source.invoice_number AS source_invoice_number,
         cn.container_number,
         cn.sku,
         cn.expected_unit_price,
         cn.invoice_unit_price,
         cn.qty,
         cn.credit_amount,
         cn.applied_date::text AS applied_date,
         cn.note
       FROM shipcore.fc_credit_notes cn
       LEFT JOIN shipcore.fc_invoices source ON source.id = cn.source_invoice_id
       WHERE cn.applied_invoice_id = $1::bigint
         AND cn.status = 'applied'
       ORDER BY cn.applied_date DESC NULLS LAST, cn.id DESC`,
      [id],
    ),
  ]);

  if (headerResult.rowCount === 0) return null;
  const header = headerResult.rows[0];

  return {
    id: header.id as string,
    invoiceNumber: header.invoice_number as string,
    factoryId: header.factory_id as string,
    factoryName: header.factory_name as string,
    containerId: header.container_id as string | null,
    containerNumber: header.container_number as string | null,
    invoiceDate: serializeDate(header.invoice_date),
    status: header.status as string,
    attachmentFileId: header.attachment_file_id as string | null,
    signedAttachmentFileId: header.signed_attachment_file_id as string | null,
    signedBy: header.signed_by as string | null,
    signedAt: header.signed_at ? new Date(header.signed_at as string).toISOString() : null,
    lastComparedAt: header.last_compared_at ? new Date(header.last_compared_at as string).toISOString() : null,
    note: header.note as string | null,
    items: itemsResult.rows.map(rowToItem),
    appliedCredits: appliedCreditsResult.rows.map(rowToAppliedCredit),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { id } = await params;
    const detail = await loadInvoiceDetail(id);
    if (!detail) return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const { id } = await params;
    const session = await auth();
    const ip = getRequestIp(request);
    const body: unknown = await request.json();

    const existingResult = await getPrimaryPool().query(
      `SELECT
         status::text AS status,
         invoice_number,
         invoice_date::text AS invoice_date,
         container_id::text AS container_id,
         container_number,
         note
       FROM shipcore.fc_invoices
       WHERE id = $1::bigint`,
      [id],
    );
    if (existingResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }
    const existing = existingResult.rows[0];

    const statusOnly = z.object({ status: InvoiceStatusSchema }).strict().safeParse(body);
    if (statusOnly.success) {
      const isSigning = statusOnly.data.status === "signed";
      const result = await getPrimaryPool().query(
        `UPDATE shipcore.fc_invoices
         SET status = $2::shipcore.fc_invoice_status,
             signed_by = CASE WHEN $3::boolean THEN $4 ELSE signed_by END,
             signed_at = CASE WHEN $3::boolean THEN NOW() ELSE signed_at END,
             updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id`,
        [id, statusOnly.data.status, isSigning, session?.user?.name ?? session?.user?.email ?? null],
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
      }

      if (existing.status !== statusOnly.data.status) {
        void logInvoiceAudit({
          invoiceId: id,
          invoiceNumber: existing.invoice_number,
          userId: session?.user?.id ?? null,
          userName: session?.user?.name ?? null,
          userEmail: session?.user?.email ?? null,
          action: "status_change",
          before: { status: existing.status },
          after: { status: statusOnly.data.status },
          ip,
        });
      }

      return NextResponse.json({ success: true, data: { id } });
    }

    const details = InvoiceDetailsSchema.parse(body);
    const result = await getPrimaryPool().query(
      `UPDATE shipcore.fc_invoices
       SET invoice_number = $2,
           invoice_date = $3::date,
           container_id = $4::bigint,
           container_number = $5,
           note = $6,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, details.invoiceNumber, details.invoiceDate, details.containerId || null, details.containerNumber || null, details.note || null],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: details.invoiceNumber,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "details_update",
      before: {
        invoiceNumber: existing.invoice_number,
        invoiceDate: existing.invoice_date,
        containerId: existing.container_id,
        containerNumber: existing.container_number,
        note: existing.note,
      },
      after: details,
      ip,
    });

    return NextResponse.json({ success: true, data: { id } });
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
      `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (existingResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    await getPrimaryPool().query(`DELETE FROM shipcore.fc_invoices WHERE id = $1::bigint`, [id]);

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: existingResult.rows[0].invoice_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      ip: getRequestIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
