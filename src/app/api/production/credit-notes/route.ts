// Code Guide: List + manual-create API for the Credit 관리 tab. Formalizes credit
// tracking that previously only lived as inline flags on fc_invoice_items.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

const CreditNoteCreateSchema = z.object({
  sourceInvoiceId: z.string().min(1),
  sku: z.string().trim().min(1),
  expectedUnitPrice: z.number().nonnegative().nullable().optional(),
  invoiceUnitPrice: z.number().nonnegative(),
  qty: z.number().int().positive(),
  creditAmount: z.number().nonnegative().optional(),
  note: z.string().trim().optional(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function rowToCreditNote(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    factoryId: String(row.factory_id),
    factoryName: row.factory_name as string,
    containerNumber: row.container_number as string | null,
    sourceInvoiceId: String(row.source_invoice_id),
    sourceInvoiceNumber: row.source_invoice_number as string,
    sourceInvoiceItemId: row.source_invoice_item_id == null ? null : String(row.source_invoice_item_id),
    sku: row.sku as string,
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    invoiceUnitPrice: Number(row.invoice_unit_price),
    qty: Number(row.qty),
    creditAmount: Number(row.credit_amount),
    status: row.status as string,
    appliedInvoiceId: row.applied_invoice_id == null ? null : String(row.applied_invoice_id),
    appliedInvoiceNumber: row.applied_invoice_number as string | null,
    appliedDate: serializeDate(row.applied_date),
    note: row.note as string | null,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string).toISOString() : null,
    appliedAt: row.applied_at ? new Date(row.applied_at as string).toISOString() : null,
    createdBy: row.created_by as string | null,
  };
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const factoryId = searchParams.get("factoryId")?.trim() ?? "";
    const search = searchParams.get("search")?.trim() ?? "";
    const statusParam = searchParams.get("status")?.trim() ?? "";
    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : [];

    const filters: string[] = [];
    const params: unknown[] = [];

    if (factoryId) {
      params.push(factoryId);
      filters.push(`cn.factory_id = $${params.length}::bigint`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(cn.sku ILIKE $${params.length} OR src.invoice_number ILIKE $${params.length} OR cn.container_number ILIKE $${params.length})`);
    }
    if (statuses.length > 0) {
      params.push(statuses);
      filters.push(`cn.status::text = ANY($${params.length}::text[])`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const pool = getPrimaryPool();
    const [listResult, summaryResult] = await Promise.all([
      pool.query(
        `SELECT
           cn.*,
           f.factory_name,
           src.invoice_number AS source_invoice_number,
           applied.invoice_number AS applied_invoice_number
         FROM shipcore.fc_credit_notes cn
         JOIN shipcore.fc_factories f ON f.id = cn.factory_id
         JOIN shipcore.fc_invoices src ON src.id = cn.source_invoice_id
         LEFT JOIN shipcore.fc_invoices applied ON applied.id = cn.applied_invoice_id
         ${where}
         ORDER BY cn.requested_at DESC, cn.id DESC
         LIMIT 1000`,
        params,
      ),
      pool.query(
        `SELECT status::text AS status, COUNT(*)::int AS count, COALESCE(SUM(credit_amount), 0) AS amount
         FROM shipcore.fc_credit_notes
         GROUP BY status`,
      ),
    ]);

    const summary = { pending: { count: 0, amount: 0 }, confirmed: { count: 0, amount: 0 }, applied: { count: 0, amount: 0 } };
    for (const row of summaryResult.rows) {
      const key = row.status as keyof typeof summary;
      if (summary[key]) summary[key] = { count: Number(row.count), amount: Number(row.amount) };
    }

    return NextResponse.json({
      success: true,
      data: {
        creditNotes: listResult.rows.map(rowToCreditNote),
        summary,
      },
    });
  } catch (error) {
    console.error("Failed to load credit notes", error);
    return NextResponse.json({ success: false, error: "Credit 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json();
    const parsed = CreditNoteCreateSchema.parse(body);

    const invoiceResult = await getPrimaryPool().query(
      `SELECT factory_id, container_id, container_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [parsed.sourceInvoiceId],
    );
    if (invoiceResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "원본 Invoice를 찾을 수 없습니다." }, { status: 404 });
    }
    const invoice = invoiceResult.rows[0];

    const creditAmount = parsed.creditAmount ?? (
      parsed.expectedUnitPrice != null
        ? Number((parsed.qty * (parsed.invoiceUnitPrice - parsed.expectedUnitPrice)).toFixed(4))
        : null
    );
    if (creditAmount == null) {
      return NextResponse.json({ success: false, error: "Expected Price가 없으면 Credit Amount를 직접 입력해야 합니다." }, { status: 400 });
    }

    const result = await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_credit_notes
         (factory_id, container_id, container_number, source_invoice_id, sku,
          expected_unit_price, invoice_unit_price, qty, credit_amount, note, created_by, requested_at)
       VALUES ($1::bigint, $2::bigint, $3, $4::bigint, UPPER($5), $6::numeric, $7::numeric, $8::int, $9::numeric, $10, $11, NOW())
       RETURNING id::text AS id`,
      [
        invoice.factory_id,
        invoice.container_id,
        invoice.container_number,
        parsed.sourceInvoiceId,
        parsed.sku,
        parsed.expectedUnitPrice ?? null,
        parsed.invoiceUnitPrice,
        parsed.qty,
        creditAmount,
        parsed.note || null,
        session?.user?.id ?? null,
      ],
    );

    const id = result.rows[0].id as string;
    void logInvoiceAudit({
      invoiceId: parsed.sourceInvoiceId,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "credit_note_create",
      after: { creditNoteId: id, sku: parsed.sku, creditAmount, source: "manual" },
    });

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
