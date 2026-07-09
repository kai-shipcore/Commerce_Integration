// Code Guide: List + create API for Invoice Review. List returns both the filtered
// invoice rows for the left pane and the status-bucket counts for the filter pills
// in a single round trip.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { logInvoiceAudit } from "@/lib/invoice-audit";

const STATUS_BUCKETS: Record<string, string[]> = {
  pending_review: ["received", "price_review", "discrepancy_found"],
  hold: ["factory_confirmation"],
  reviewed: ["approved", "signed", "sent_to_factory"],
};

const InvoiceCreateSchema = z.object({
  factoryId: z.string().min(1),
  containerId: z.string().trim().optional(),
  containerNumber: z.string().trim().optional(),
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const factoryId = searchParams.get("factoryId")?.trim() ?? "";
    const bucketsParam = searchParams.get("buckets")?.trim() ?? "";
    const buckets = bucketsParam ? bucketsParam.split(",").filter(Boolean) : [];
    const statuses = buckets.flatMap((bucket) => STATUS_BUCKETS[bucket] ?? []);

    const filters: string[] = [];
    const params: unknown[] = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(i.invoice_number ILIKE $${params.length} OR f.factory_name ILIKE $${params.length} OR i.container_number ILIKE $${params.length})`);
    }
    if (factoryId) {
      params.push(factoryId);
      filters.push(`i.factory_id = $${params.length}::bigint`);
    }
    if (statuses.length > 0) {
      params.push(statuses);
      filters.push(`i.status::text = ANY($${params.length}::text[])`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const pool = getPrimaryPool();
    const [listResult, countsResult] = await Promise.all([
      pool.query(
        `SELECT
           i.id::text AS id,
           i.invoice_number,
           i.invoice_date::text AS invoice_date,
           i.status::text AS status,
           f.factory_name,
           i.container_number,
           COALESCE(err.error_count, 0)::int AS error_count,
           COALESCE(totals.invoice_price_total, 0) AS invoice_price_total
         FROM shipcore.fc_invoices i
         JOIN shipcore.fc_factories f ON f.id = i.factory_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS error_count
           FROM shipcore.fc_invoice_items ii
           WHERE ii.invoice_id = i.id AND ii.result IN ('price_error', 'overcharged')
         ) err ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(ii.qty * ii.invoice_unit_price) AS invoice_price_total
           FROM shipcore.fc_invoice_items ii
           WHERE ii.invoice_id = i.id
         ) totals ON TRUE
         ${where}
         ORDER BY i.invoice_date DESC, i.id DESC
         LIMIT 500`,
        params,
      ),
      pool.query(
        `SELECT status::text AS status, COUNT(*)::int AS count
         FROM shipcore.fc_invoices
         GROUP BY status`,
      ),
    ]);

    const rawCounts = new Map<string, number>(countsResult.rows.map((row) => [row.status, row.count]));
    const bucketCounts: Record<string, number> = { all: 0 };
    for (const [bucket, bucketStatuses] of Object.entries(STATUS_BUCKETS)) {
      bucketCounts[bucket] = bucketStatuses.reduce((sum, status) => sum + (rawCounts.get(status) ?? 0), 0);
    }
    bucketCounts.all = [...rawCounts.values()].reduce((sum, count) => sum + count, 0);

    return NextResponse.json({
      success: true,
      data: {
        invoices: listResult.rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoice_number,
          invoiceDate: serializeDate(row.invoice_date),
          status: row.status,
          factoryName: row.factory_name as string,
          containerNumber: row.container_number as string | null,
          errorCount: row.error_count as number,
          invoicePriceTotal: Number(row.invoice_price_total),
        })),
        bucketCounts,
      },
    });
  } catch (error) {
    console.error("Failed to load invoices", error);
    return NextResponse.json({ success: false, error: "Invoice 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json();
    const parsed = InvoiceCreateSchema.parse(body);

    const result = await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_invoices
         (invoice_number, factory_id, container_id, container_number, invoice_date, status, note, created_by, created_at, updated_at)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5::date, 'price_review', $6, $7, NOW(), NOW())
       RETURNING id::text AS id`,
      [
        parsed.invoiceNumber,
        parsed.factoryId,
        parsed.containerId || null,
        parsed.containerNumber || null,
        parsed.invoiceDate,
        parsed.note || null,
        session?.user?.id ?? null,
      ],
    );

    const id = result.rows[0].id as string;
    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: parsed.invoiceNumber,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: parsed,
    });

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    if (error instanceof Error && /unique/i.test(error.message)) {
      return NextResponse.json({ success: false, error: "이미 존재하는 Invoice 번호입니다." }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
