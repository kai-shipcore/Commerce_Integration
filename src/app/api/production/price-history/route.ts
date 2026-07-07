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

function parseExcelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const rawYear = Number(match[3]);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
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

    const factoryId = searchParams.get("factoryId")?.trim() ?? "";
    const sku = searchParams.get("sku")?.trim() ?? "";
    const asOfDate = searchParams.get("asOfDate")?.trim() ?? "";
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

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const currentClause = currentOnly ? "WHERE ranked.current_rank = 1" : "";

    const result = await getPrimaryPool().query(
      `WITH base AS (
         SELECT
           h.*,
           f.factory_name,
           sf.original_name AS source_file_name,
           LAG(h.unit_price) OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date, h.id) AS previous_price,
           ROW_NUMBER() OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date DESC, h.id DESC) AS current_rank
         FROM shipcore.fc_sku_price_history h
         JOIN shipcore.fc_factories f ON f.id = h.factory_id
         LEFT JOIN shipcore.fc_price_list_files sf ON sf.id = h.source_file_id
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
       ON CONFLICT (factory_id, sku, effective_date) DO UPDATE SET
         unit_price = EXCLUDED.unit_price,
         currency = EXCLUDED.currency,
         reason = EXCLUDED.reason,
         updated_at = NOW()
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
    const fallbackReason = String(formData.get("reason") ?? "").trim();
    const fallbackCurrency = String(formData.get("currency") ?? "USD").trim().toUpperCase() || "USD";

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
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
      let imported = 0;

      for (const [index, row] of rows.entries()) {
        const rowNo = index + 2;
        const sku = String(pickValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
        const effectiveDate = parseExcelDate(pickValue(row, ["effective_date", "effective date", "date", "price date"]));
        const rawPrice = pickValue(row, ["unit_price", "unit price", "price", "cost"]);
        const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));
        const factoryId = String(pickValue(row, ["factory_id", "factory id"]) ?? fallbackFactoryId).trim();
        const currency = String(pickValue(row, ["currency"]) ?? fallbackCurrency).trim().toUpperCase() || "USD";
        const reason = String(pickValue(row, ["reason", "note", "memo"]) ?? fallbackReason).trim();

        if (!sku || !effectiveDate || !Number.isFinite(unitPrice) || unitPrice < 0 || !factoryId) {
          errors.push(`Row ${rowNo}: sku, effective_date, unit_price, factory_id are required`);
          continue;
        }

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
        imported += 1;
      }

      await client.query("COMMIT");
      return NextResponse.json({ success: true, data: { sourceFileId, imported, errors } });
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
