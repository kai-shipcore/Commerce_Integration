// Code Guide: CRUD and Excel import API for SKU price history used by Invoice & Price Control.

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

const PriceBodySchema = z.object({
  factoryId: z.string().min(1),
  sku: z.string().trim().min(1),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unitPrice: z.number().nonnegative(),
  currency: z.string().trim().min(3).max(3).default("USD"),
  reason: z.string().trim().optional(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function rowToPrice(row: Record<string, unknown>) {
  const unitPrice = Number(row.unit_price ?? 0);
  const previousPrice = row.previous_price == null ? null : Number(row.previous_price);
  const changeAmount = previousPrice == null ? null : unitPrice - previousPrice;
  const changeRate = previousPrice == null || previousPrice === 0 ? null : (changeAmount! / previousPrice) * 100;

  return {
    id: String(row.id),
    factoryId: String(row.factory_id),
    factoryName: row.factory_name as string,
    sku: row.sku as string,
    effectiveDate: serializeDate(row.effective_date),
    unitPrice,
    currency: row.currency as string,
    reason: row.reason as string | null,
    sourceFileId: row.source_file_id == null ? null : String(row.source_file_id),
    sourceFileName: row.source_file_name as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    previousPrice,
    changeAmount,
    changeRate,
    invoiceReferenceCount: Number(row.invoice_reference_count ?? 0),
    invoiceReferenceInvoiceCount: Number(row.invoice_reference_invoice_count ?? 0),
  };
}

function rowToSourceFile(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    originalName: row.original_name as string,
    mimeType: row.mime_type as string | null,
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedBy: row.uploaded_by_display as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rowCount: Number(row.row_count ?? 0),
    factoryCount: Number(row.factory_count ?? 0),
    skuCount: Number(row.sku_count ?? 0),
    factoryIds: row.factory_ids ? String(row.factory_ids).split(",").filter(Boolean) : [],
    factoryNames: row.factory_names as string | null,
    firstEffectiveDate: serializeDate(row.first_effective_date),
    lastEffectiveDate: serializeDate(row.last_effective_date),
  };
}

function pickValue(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
    const found = entries.find(([key]) => key.toLowerCase().replace(/[\s_-]/g, "") === normalized);
    if (found) return found[1];
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode")?.trim() ?? "";
    if (mode === "factories") {
      const activeOnly = searchParams.get("active") !== "false";
      const result = await getPrimaryPool().query(
        `SELECT
           id::text,
           factory_code,
           factory_name
         FROM shipcore.fc_factories
         WHERE ($1::boolean = false OR is_active = true)
         ORDER BY factory_name ASC`,
        [activeOnly],
      );
      return NextResponse.json({
        success: true,
        data: result.rows.map((row) => ({
          id: row.id as string,
          factoryCode: row.factory_code as string | null,
          factoryName: row.factory_name as string,
        })),
      });
    }
    if (mode === "files") {
      const factoryIdForFiles = searchParams.get("factoryId")?.trim() ?? "";
      const fileFilters: string[] = [];
      const fileParams: unknown[] = [];
      if (factoryIdForFiles) {
        fileParams.push(factoryIdForFiles);
        fileFilters.push(`EXISTS (
          SELECT 1
          FROM shipcore.fc_sku_price_history h_filter
          WHERE h_filter.source_file_id = f.id
            AND h_filter.factory_id = $${fileParams.length}::bigint
        )`);
      }
      const fileWhere = fileFilters.length ? `WHERE ${fileFilters.join(" AND ")}` : "";
      const result = await getPrimaryPool().query(
        `SELECT
           f.id,
           f.original_name,
           f.mime_type,
           f.size_bytes,
           COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
           f.created_at,
           COUNT(h.id)::int AS row_count,
           COUNT(DISTINCT h.factory_id)::int AS factory_count,
           COUNT(DISTINCT h.sku)::int AS sku_count,
           STRING_AGG(DISTINCT h.factory_id::text, ',' ORDER BY h.factory_id::text) AS factory_ids,
           STRING_AGG(DISTINCT ff.factory_name, ', ' ORDER BY ff.factory_name) AS factory_names,
           MIN(h.effective_date)::text AS first_effective_date,
           MAX(h.effective_date)::text AS last_effective_date
         FROM shipcore.fc_price_list_files f
         LEFT JOIN shipcore.fc_sku_price_history h ON h.source_file_id = f.id
         LEFT JOIN shipcore.fc_factories ff ON ff.id = h.factory_id
         LEFT JOIN shipcore.fc_user u ON u.id = f.uploaded_by
         ${fileWhere}
         GROUP BY f.id, u.name, u.email
         ORDER BY f.created_at DESC
         LIMIT 100`,
        fileParams,
      );
      return NextResponse.json({ success: true, data: result.rows.map(rowToSourceFile) });
    }

    const factoryId = searchParams.get("factoryId")?.trim() ?? "";
    const sku = searchParams.get("sku")?.trim() ?? "";
    const asOfDate = searchParams.get("asOfDate")?.trim() ?? "";
    const sourceFileId = searchParams.get("sourceFileId")?.trim() ?? "";
    const currentOnly = searchParams.get("currentOnly") === "true";

    const filters: string[] = [];
    const params: unknown[] = [];

    if (factoryId) {
      params.push(factoryId);
      filters.push(`h.factory_id = $${params.length}::bigint`);
    }
    if (sku) {
      params.push(`%${sku}%`);
      filters.push(`h.sku ILIKE $${params.length}`);
    }
    if (asOfDate) {
      params.push(asOfDate);
      filters.push(`h.effective_date <= $${params.length}::date`);
    }
    if (sourceFileId) {
      params.push(sourceFileId);
      filters.push(`h.source_file_id = $${params.length}::bigint`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const currentClause = currentOnly ? "WHERE ranked.current_rank = 1" : "";

    const result = await getPrimaryPool().query(
      `WITH base AS (
         SELECT
           h.*,
           f.factory_name,
           sf.original_name AS source_file_name,
           COALESCE(invoice_refs.item_count, 0)::int AS invoice_reference_count,
           COALESCE(invoice_refs.invoice_count, 0)::int AS invoice_reference_invoice_count,
           LAG(h.unit_price) OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date, h.id) AS previous_price,
           ROW_NUMBER() OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date DESC, h.id DESC) AS current_rank
         FROM shipcore.fc_sku_price_history h
         JOIN shipcore.fc_factories f ON f.id = h.factory_id
         LEFT JOIN shipcore.fc_price_list_files sf ON sf.id = h.source_file_id
         LEFT JOIN LATERAL (
           SELECT
             COUNT(ii.id)::int AS item_count,
             COUNT(DISTINCT ii.invoice_id)::int AS invoice_count
           FROM shipcore.fc_invoice_items ii
           JOIN shipcore.fc_invoices inv ON inv.id = ii.invoice_id
           WHERE inv.factory_id = h.factory_id
             AND ii.sku = h.sku
             AND ii.expected_effective_date = h.effective_date
         ) invoice_refs ON TRUE
         ${where}
       )
       SELECT * FROM base ranked
       ${currentClause}
       ORDER BY ranked.sku ASC, ranked.effective_date DESC, ranked.id DESC
       LIMIT 1000`,
      params,
    );

    return NextResponse.json({ success: true, data: result.rows.map(rowToPrice) });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json();
    const parsed = PriceBodySchema.parse(body);

    const result = await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_sku_price_history
         (factory_id, sku, effective_date, unit_price, currency, reason, created_by, created_at, updated_at)
       VALUES ($1::bigint, UPPER($2), $3::date, $4::numeric, UPPER($5), $6, $7, NOW(), NOW())
       ON CONFLICT (factory_id, sku, effective_date) DO NOTHING
       RETURNING id`,
      [
        parsed.factoryId,
        parsed.sku,
        parsed.effectiveDate,
        parsed.unitPrice,
        parsed.currency,
        parsed.reason || null,
        session?.user?.id ?? null,
      ],
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "같은 공장, SKU, 적용일의 가격 이력이 이미 있습니다. 기존 row를 선택해서 수정하거나 적용일을 다르게 입력하세요." },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, data: { id: String(result.rows[0].id) } }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    const parsed = PriceBodySchema.parse(body);

    const result = await getPrimaryPool().query(
      `UPDATE shipcore.fc_sku_price_history
       SET factory_id = $2::bigint,
           sku = UPPER($3),
           effective_date = $4::date,
           unit_price = $5::numeric,
           currency = UPPER($6),
           reason = $7,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, parsed.factoryId, parsed.sku, parsed.effectiveDate, parsed.unitPrice, parsed.currency, parsed.reason || null],
    );

    if (result.rowCount === 0) return NextResponse.json({ success: false, error: "Price history not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const sourceFileId = searchParams.get("sourceFileId")?.trim();
    if (sourceFileId) {
      const client = await getPrimaryPool().connect();
      try {
        await client.query("BEGIN");
        const deletedRows = await client.query(
          `DELETE FROM shipcore.fc_sku_price_history WHERE source_file_id = $1::bigint`,
          [sourceFileId],
        );
        const deletedFile = await client.query(
          `DELETE FROM shipcore.fc_price_list_files WHERE id = $1::bigint`,
          [sourceFileId],
        );
        await client.query("COMMIT");
        if (deletedFile.rowCount === 0) return NextResponse.json({ success: false, error: "Source file not found" }, { status: 404 });
        return NextResponse.json({ success: true, data: { deletedRows: deletedRows.rowCount ?? 0 } });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const ids = searchParams.get("ids")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    if (ids.length > 0) {
      const result = await getPrimaryPool().query(
        `DELETE FROM shipcore.fc_sku_price_history WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      return NextResponse.json({ success: true, data: { deletedRows: result.rowCount ?? 0 } });
    }

    const id = searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });

    const result = await getPrimaryPool().query(
      `DELETE FROM shipcore.fc_sku_price_history WHERE id = $1::bigint`,
      [id],
    );
    if (result.rowCount === 0) return NextResponse.json({ success: false, error: "Price history not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const session = await auth();
    const formData = await request.formData();
    const file = formData.get("file");
    const fallbackFactoryId = String(formData.get("factoryId") ?? "").trim();
    const fallbackEffectiveDate = String(formData.get("effectiveDate") ?? "").trim();
    const fallbackReason = String(formData.get("reason") ?? "").trim();
    const currency = "USD";

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fallbackEffectiveDate)) {
      return NextResponse.json({ success: false, error: "effectiveDate is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const client = await getPrimaryPool().connect();
    try {
      await client.query("BEGIN");
      const fileResult = await client.query(
        `INSERT INTO shipcore.fc_price_list_files
           (original_name, mime_type, size_bytes, file_data, uploaded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [file.name, file.type || null, buffer.byteLength, buffer, session?.user?.id ?? null],
      );
      const sourceFileId = String(fileResult.rows[0].id);

      const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      if (!isExcel) {
        await client.query("COMMIT");
        return NextResponse.json({ success: true, data: { sourceFileId, imported: 0, errors: [] } });
      }

      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const errors: string[] = [];
      let created = 0;
      let updated = 0;

      for (const [index, row] of rows.entries()) {
        const rowNo = index + 2;
        const sku = String(pickValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
        const effectiveDate = fallbackEffectiveDate;
        const rawPrice = pickValue(row, ["unit_price", "unit price", "price", "cost"]);
        const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));
        const factoryId = fallbackFactoryId;
        const reason = String(pickValue(row, ["reason", "note", "memo"]) ?? fallbackReason).trim();

        if (!sku || !effectiveDate || !Number.isFinite(unitPrice) || unitPrice < 0 || !factoryId) {
          errors.push(`Row ${rowNo}: sku, selected effective date, unit_price, selected factory are required`);
          continue;
        }

        const existing = await client.query(
          `SELECT id
           FROM shipcore.fc_sku_price_history
           WHERE factory_id = $1::bigint
             AND sku = $2
             AND effective_date = $3::date
           LIMIT 1`,
          [factoryId, sku, effectiveDate],
        );
        await client.query(
          `INSERT INTO shipcore.fc_sku_price_history
             (factory_id, sku, effective_date, unit_price, currency, reason, source_file_id, created_by, created_at, updated_at)
           VALUES ($1::bigint, $2, $3::date, $4::numeric, $5, $6, $7::bigint, $8, NOW(), NOW())
           ON CONFLICT (factory_id, sku, effective_date) DO UPDATE SET
             unit_price = EXCLUDED.unit_price,
             currency = EXCLUDED.currency,
             reason = COALESCE(NULLIF(EXCLUDED.reason, ''), shipcore.fc_sku_price_history.reason),
             source_file_id = EXCLUDED.source_file_id,
             updated_at = NOW()`,
          [factoryId, sku, effectiveDate, unitPrice, currency, reason || null, sourceFileId, session?.user?.id ?? null],
        );
        if ((existing.rowCount ?? 0) > 0) updated += 1;
        else created += 1;
      }

      await client.query("COMMIT");
      return NextResponse.json({ success: true, data: { sourceFileId, imported: created + updated, created, updated, skipped: errors.length, errors } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
