// Code Guide: Read API for factory planning purchase orders.
// Uses DATABASE_URL via the primary PostgreSQL pool and reads shipcore.fc_purchase_orders
// plus shipcore.fc_purchase_order_items.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { auth } from "@/lib/auth";
import { isAdminLikeRole, isPOApproverRole } from "@/components/layout/navigation-config";
import { z } from "zod";

const WorkflowActionSchema = z.object({
  action: z.enum(["request_review", "approve", "reject", "send_to_factory"]),
});

type WorkflowAction = z.infer<typeof WorkflowActionSchema>["action"];

const WORKFLOW_TRANSITIONS: Record<WorkflowAction, { from: string[]; to: string; adminOnly: boolean }> = {
  request_review:  { from: ["draft"],             to: "pending",  adminOnly: false },
  approve:         { from: ["draft","pending"],    to: "approved", adminOnly: true  },
  reject:          { from: ["pending","approved"], to: "draft",    adminOnly: true  },
  send_to_factory: { from: ["approved"],           to: "sent",     adminOnly: true  },
};

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

async function ensureCreatedByColumn() {
  await getPrimaryPool().query(`
    ALTER TABLE shipcore.fc_purchase_orders
    ADD COLUMN IF NOT EXISTS created_by text
  `);
}

async function ensureFactoryCodeSequence() {
  const pool = getPrimaryPool();

  await pool.query("CREATE SEQUENCE IF NOT EXISTS shipcore.fc_factory_code_seq START 1");
  await pool.query(`
    WITH code_state AS (
      SELECT COALESCE((
          SELECT MAX((regexp_match(factory_code, '^FC-([0-9]+)$'))[1]::bigint)
          FROM shipcore.fc_factories
          WHERE factory_code ~ '^FC-[0-9]+$'
        ), 0) AS max_code
    )
    SELECT setval(
      'shipcore.fc_factory_code_seq',
      GREATEST(code_state.max_code, shipcore.fc_factory_code_seq.last_value, 1),
      code_state.max_code > 0 OR shipcore.fc_factory_code_seq.is_called
    )
    FROM code_state, shipcore.fc_factory_code_seq
  `);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get("nextNumber") === "true") {
      const pool = getPrimaryPool();
      const result = await pool.query<{ next_seq: string }>(`
        SELECT COALESCE(
          MAX(
            CASE
              WHEN po_number ~ '^PO-[0-9]{4}-[0-9]+$'
              THEN (regexp_match(po_number, '^PO-[0-9]{4}-([0-9]+)$'))[1]::bigint
            END
          ), 0
        ) + 1 AS next_seq
        FROM shipcore.fc_purchase_orders
      `);
      const seq = Number(result.rows[0].next_seq);
      const year = new Date().getFullYear();
      const nextNumber = `PO-${year}-${String(seq).padStart(3, "0")}`;
      return NextResponse.json({ success: true, data: { nextNumber } });
    }

    await ensureCreatedByColumn();

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
         po.created_by,
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
      createdBy: (row.created_by as string | null) ?? null,
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
  const session = await auth();
  const client = await getPrimaryPool().connect();

  try {
    const body = await request.json();
    const validated = PurchaseOrderCreateSchema.parse(body);
    const factoryName = validated.factory.trim();

    await client.query("BEGIN");
    await ensureFactoryCodeSequence();
    await ensureCreatedByColumn();

    const factoryResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_factories (factory_code, factory_name)
       VALUES ('FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0'), $1)
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(shipcore.fc_factories.factory_code, EXCLUDED.factory_code),
         is_active = true,
         updated_at = now()
       RETURNING id::text`,
      [factoryName]
    );
    const factoryId = factoryResult.rows[0].id;

    const poResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_purchase_orders
         (po_number, po_date, eta_date, factory_id, factory_name, dest_warehouse, manager, note, status, created_by)
       VALUES ($1, $2::date, $3::date, $4::bigint, $5, $6, $7, $8, $9::shipcore.fc_po_status, $10)
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
        session?.user?.id ?? null,
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
        `UPDATE shipcore.fc_products
         SET moq = $2::int,
             order_multiple = $2::int,
             cbm_per_unit = COALESCE(NULLIF($3::numeric(14,6), 0), cbm_per_unit),
             updated_at = NOW()
         WHERE master_sku = $1`,
        [item.sku.trim(), item.moq, item.cbm]
      );

      await client.query(
        `INSERT INTO shipcore.fc_purchase_order_items
           (po_id, master_sku, moq, order_qty, cbm_unit, unit_price)
         VALUES ($1::bigint, $2, $3, $4, $5::numeric(14,6), $6)`,
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

export async function PATCH(request: NextRequest) {
  const client = await getPrimaryPool().connect();

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Purchase order id is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid purchase order id" },
        { status: 400 }
      );
    }

    // ── Workflow-only status transition ──────────────────────────────────
    if (searchParams.get("workflow") === "true") {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      const body = await request.json();
      const { action } = WorkflowActionSchema.parse(body);
      const rule = WORKFLOW_TRANSITIONS[action];

      if (rule.adminOnly && !isPOApproverRole(session.user.role)) {
        return NextResponse.json(
          { success: false, error: "This action requires manager (planner) or admin privileges." },
          { status: 403 }
        );
      }

      const existing = await client.query<{ status: string }>(
        `SELECT status::text FROM shipcore.fc_purchase_orders WHERE id = $1::bigint`,
        [id]
      );
      if (existing.rowCount === 0) {
        return NextResponse.json({ success: false, error: "Purchase order not found" }, { status: 404 });
      }

      const currentStatus = existing.rows[0].status;
      if (!rule.from.includes(currentStatus)) {
        return NextResponse.json(
          { success: false, error: `Cannot perform this action from status: ${currentStatus}` },
          { status: 409 }
        );
      }

      await client.query(
        `UPDATE shipcore.fc_purchase_orders
            SET status = $1::shipcore.fc_po_status,
                sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
                updated_at = now()
          WHERE id = $2::bigint`,
        [rule.to, id]
      );

      return NextResponse.json({ success: true, data: { id, status: rule.to } });
    }
    // ────────────────────────────────────────────────────────────────────

    const body = await request.json();
    const validated = PurchaseOrderCreateSchema.parse(body);

    if (validated.status === "sent") {
      return NextResponse.json(
        { success: false, error: "Sent purchase orders cannot be edited" },
        { status: 400 }
      );
    }

    const factoryName = validated.factory.trim();

    await client.query("BEGIN");
    await ensureFactoryCodeSequence();

    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id::text, status::text
       FROM shipcore.fc_purchase_orders
       WHERE id = $1::bigint
       FOR UPDATE`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Purchase order not found" },
        { status: 404 }
      );
    }

    if (existing.rows[0].status === "sent") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Sent purchase orders cannot be edited" },
        { status: 409 }
      );
    }

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

    const factoryResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_factories (factory_code, factory_name)
       VALUES ('FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0'), $1)
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(shipcore.fc_factories.factory_code, EXCLUDED.factory_code),
         is_active = true,
         updated_at = now()
       RETURNING id::text`,
      [factoryName]
    );
    const factoryId = factoryResult.rows[0].id;

    await client.query(
      `UPDATE shipcore.fc_purchase_orders
       SET po_number = $2,
           po_date = $3::date,
           eta_date = $4::date,
           factory_id = $5::bigint,
           factory_name = $6,
           dest_warehouse = $7,
           manager = $8,
           note = $9,
           status = $10::shipcore.fc_po_status
       WHERE id = $1::bigint`,
      [
        id,
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

    await client.query(
      `DELETE FROM shipcore.fc_purchase_order_items
       WHERE po_id = $1::bigint`,
      [id]
    );

    for (const item of validated.items) {
      await client.query(
        `UPDATE shipcore.fc_products
         SET moq = $2::int,
             order_multiple = $2::int,
             cbm_per_unit = COALESCE(NULLIF($3::numeric(14,6), 0), cbm_per_unit),
             updated_at = NOW()
         WHERE master_sku = $1`,
        [item.sku.trim(), item.moq, item.cbm]
      );

      await client.query(
        `INSERT INTO shipcore.fc_purchase_order_items
           (po_id, master_sku, moq, order_qty, cbm_unit, unit_price)
         VALUES ($1::bigint, $2, $3, $4, $5::numeric(14,6), $6)`,
        [
          id,
          item.sku.trim(),
          item.moq,
          item.qty,
          item.cbm || null,
          item.unitPrice ?? null,
        ]
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      data: { id, factoryId },
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error updating purchase order:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const client = await getPrimaryPool().connect();

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Purchase order id is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid purchase order id" },
        { status: 400 }
      );
    }

    await client.query("BEGIN");

    const existing = await client.query<{ id: string; po_number: string }>(
      `SELECT id::text, po_number
       FROM shipcore.fc_purchase_orders
       WHERE id = $1::bigint
       FOR UPDATE`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Purchase order not found" },
        { status: 404 }
      );
    }

    await client.query(
      `DELETE FROM shipcore.fc_container_po_links
       WHERE po_id = $1::bigint`,
      [id]
    );

    await client.query(
      `DELETE FROM shipcore.fc_purchase_order_items
       WHERE po_id = $1::bigint`,
      [id]
    );

    await client.query(
      `DELETE FROM shipcore.fc_purchase_orders
       WHERE id = $1::bigint`,
      [id]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      data: {
        id: existing.rows[0].id,
        number: existing.rows[0].po_number,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting purchase order:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
