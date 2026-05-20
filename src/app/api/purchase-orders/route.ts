// Code Guide: Read API for factory planning purchase orders.
// Uses DATABASE_URL via the primary PostgreSQL pool and reads shipcore.fc_purchase_orders
// plus shipcore.fc_purchase_order_items.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { z } from "zod";

const PurchaseOrderCreateSchema = z.object({
  number: z.string().trim().min(1),
  date: z.string().trim().min(1),
  eta: z.string().trim().min(1),
  factory: z.string().trim().min(1),
  destination: z.string().trim().optional(),
  manager: z.string().trim().optional(),
  note: z.string().trim().optional(),
  status: z.enum(["draft", "pending", "approved", "sent"]).default("draft"),
  items: z.array(z.object({
    sku: z.string().trim().min(1),
    moq: z.number().int().positive().default(5),
    qty: z.number().int().positive(),
    cbm: z.number().nonnegative().default(0),
    unitPrice: z.number().nonnegative().nullable().optional(),
  })).min(1),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";

    const params: unknown[] = [];
    const filters: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(
        COALESCE(po.po_number, '') ILIKE $${params.length}
        OR COALESCE(po.factory_name, '') ILIKE $${params.length}
        OR COALESCE(po.dest_warehouse, '') ILIKE $${params.length}
        OR COALESCE(po.manager, '') ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM shipcore.fc_purchase_order_items search_item
          WHERE search_item.po_id = po.id
            AND search_item.master_sku ILIKE $${params.length}
        )
      )`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await getPrimaryPool().query(
      `SELECT
         po.id::text AS id,
         po.po_number,
         po.po_date,
         po.eta_date,
         po.factory_id::text AS factory_id,
         COALESCE(factory.factory_name, po.factory_name) AS factory_name,
         po.origin,
         po.dest_warehouse,
         po.manager,
         po.note,
         po.status::text AS status,
         po.sent_at,
         COALESCE(item_summary.item_count, 0)::int AS item_count,
         COALESCE(item_summary.total_qty, 0)::int AS total_qty,
         COALESCE(item_summary.total_cbm, 0)::text AS total_cbm,
         COALESCE(item_summary.items, '[]'::json) AS items
       FROM shipcore.fc_purchase_orders po
       LEFT JOIN shipcore.fc_factories factory ON factory.id = po.factory_id
       LEFT JOIN (
         SELECT
           po_id,
           COUNT(*)::int AS item_count,
           COALESCE(SUM(order_qty), 0)::int AS total_qty,
           COALESCE(SUM(total_cbm), 0)::numeric AS total_cbm,
           json_agg(
             json_build_object(
               'id', id::text,
               'sku', master_sku,
               'moq', moq,
               'qty', order_qty,
               'cbm', COALESCE(cbm_unit, CASE WHEN order_qty > 0 THEN total_cbm / order_qty ELSE 0 END, 0),
               'totalCbm', COALESCE(total_cbm, 0),
               'unitPrice', unit_price
             )
             ORDER BY id
           ) AS items
         FROM shipcore.fc_purchase_order_items
         GROUP BY po_id
       ) item_summary ON item_summary.po_id = po.id
       ${where}
       ORDER BY po.po_date DESC, po.id DESC`,
      params
    );

    const data = result.rows.map((row) => ({
      id: row.id as string,
      number: row.po_number as string,
      date: serializeDate(row.po_date),
      eta: serializeDate(row.eta_date),
      factoryId: row.factory_id as string | null,
      factory: row.factory_name as string | null,
      origin: row.origin as string | null,
      destination: row.dest_warehouse as string | null,
      manager: row.manager as string | null,
      note: row.note as string | null,
      status: row.status as string,
      sentAt: serializeDate(row.sent_at),
      itemCount: Number(row.item_count ?? 0),
      totalQty: Number(row.total_qty ?? 0),
      totalCbm: Number(row.total_cbm ?? 0),
      items: ((row.items ?? []) as Array<{
        id?: string;
        sku?: string;
        moq?: number;
        qty?: number;
        cbm?: string | number;
        totalCbm?: string | number;
        unitPrice?: string | number | null;
      }>).map((item) => ({
        id: item.id ?? "",
        sku: item.sku ?? "",
        moq: Number(item.moq ?? 0),
        qty: Number(item.qty ?? 0),
        cbm: Number(item.cbm ?? 0),
        totalCbm: Number(item.totalCbm ?? 0),
        unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
      })),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const client = await getPrimaryPool().connect();

  try {
    const body = await request.json();
    const validated = PurchaseOrderCreateSchema.parse(body);
    const factoryName = validated.factory.trim();

    await client.query("BEGIN");

    const factoryResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_factories (factory_name)
       VALUES ($1)
       ON CONFLICT (factory_name) DO UPDATE SET
         is_active = true,
         updated_at = now()
       RETURNING id::text`,
      [factoryName]
    );
    const factoryId = factoryResult.rows[0].id;

    const poResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_purchase_orders
         (po_number, po_date, eta_date, factory_id, factory_name, dest_warehouse, manager, note, status)
       VALUES ($1, $2::date, $3::date, $4::bigint, $5, $6, $7, $8, $9::shipcore.fc_po_status)
       RETURNING id::text`,
      [
        validated.number.trim(),
        validated.date,
        validated.eta,
        factoryId,
        factoryName,
        validated.destination?.trim() || null,
        validated.manager?.trim() || null,
        validated.note?.trim() || null,
        validated.status,
      ]
    );
    const poId = poResult.rows[0].id;

    const distinctSkus = [...new Set(validated.items.map((item) => item.sku.trim()))];
    const existingSkuResult = await client.query<{ master_sku: string }>(
      `SELECT master_sku
       FROM shipcore.fc_products
       WHERE master_sku = ANY($1::text[])`,
      [distinctSkus]
    );
    const existingSkus = new Set(existingSkuResult.rows.map((row) => row.master_sku));
    const missingSkus = distinctSkus.filter((sku) => !existingSkus.has(sku));

    if (missingSkus.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: `SKU does not exist in fc_products: ${missingSkus.join(", ")}` },
        { status: 400 }
      );
    }

    for (const item of validated.items) {
      await client.query(
        `INSERT INTO shipcore.fc_purchase_order_items
           (po_id, master_sku, moq, order_qty, cbm_unit, unit_price)
         VALUES ($1::bigint, $2, $3, $4, $5, $6)`,
        [
          poId,
          item.sku.trim(),
          item.moq,
          item.qty,
          item.cbm || null,
          item.unitPrice ?? null,
        ]
      );
    }

    await client.query("COMMIT");

    return NextResponse.json(
      { success: true, data: { id: poId, factoryId } },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating purchase order:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
