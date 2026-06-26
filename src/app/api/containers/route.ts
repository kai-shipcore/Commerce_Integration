// Code Guide: Read API for fc_containers. Used by Warehouse Management to show inbound containers per destination warehouse.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { auth } from "@/lib/auth";
import { isPOApproverRole } from "@/components/layout/navigation-config";
import { logContainerAudit } from "@/lib/container-audit";
import { canDo, guardPermission } from "@/lib/permissions";
import { z } from "zod";

const ContainerStatusSchema = z.enum(["draft", "final-list-sent", "packing-list-received", "complete"]);

const ContainerSaveSchema = z.object({
  number: z.string().trim().min(1),
  eta: z.string().trim().min(1),
  status: ContainerStatusSchema.optional(),
  cbmCapacity: z.number().positive().default(80),
  factory: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  note: z.string().trim().optional(),
  estLoading: z.string().trim().optional(),
  etdNgb: z.string().trim().optional(),
  etaLaxLgb: z.string().trim().optional(),
  items: z.array(z.object({
    sku: z.string().trim().min(1),
    qty: z.number().int().positive(),
    cbm: z.number().positive(),
    skuMemo: z.string().optional(),
    allocations: z.array(z.unknown()).optional(),
  })).default([]),
});

const ContainerDetailsSchema = z.object({
  number: z.string().trim().min(1),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cbmCapacity: z.number().positive(),
  factory: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  note: z.string().trim().optional(),
  estLoading: z.string().trim().optional(),
  etdNgb: z.string().trim().optional(),
  etaLaxLgb: z.string().trim().optional(),
}).strict();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toDbStatus(status: z.infer<typeof ContainerStatusSchema>) {
  if (status === "final-list-sent") return "shipped";
  if (status === "packing-list-received") return "packing_received";
  if (status === "complete") return "complete";
  return "draft";
}

function fromDbStatus(s: string): z.infer<typeof ContainerStatusSchema> {
  if (s === "shipped") return "final-list-sent";
  if (s === "packing_received") return "packing-list-received";
  if (s === "complete") return "complete";
  return "draft";
}

function getRequestIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const warehouseCode = searchParams.get("warehouseCode")?.trim() ?? "";
    const warehouseName = searchParams.get("warehouseName")?.trim() ?? "";
    const city = searchParams.get("city")?.trim() ?? "";
    const includeReceived = searchParams.get("includeReceived") === "true";
    const includeDetails = searchParams.get("includeDetails") === "true";
    const timelineView = searchParams.get("view") === "timeline";
    const product = searchParams.get("product")?.trim().toLowerCase() ?? "";
    const categoryCode = product === "fm" ? "FM" : product === "cc" ? "CC" : product === "sc" ? "SC" : null;

    const filters: string[] = [];
    const params: unknown[] = [];
    const categoryParamIndex = categoryCode
      ? (() => {
          params.push(categoryCode);
          return params.length;
        })()
      : null;

    if (!includeReceived) {
      filters.push("c.status <> 'received'");
    }

    const destinationTerms = [warehouseCode, warehouseName, city].filter(Boolean);
    if (destinationTerms.length > 0) {
      const destinationFilters = destinationTerms.map((term) => {
        params.push(`%${term}%`);
        return `COALESCE(c.dest_warehouse, '') ILIKE $${params.length}`;
      });
      filters.push(`(${destinationFilters.join(" OR ")})`);
    }

    if (categoryParamIndex) {
      filters.push(`(
        NOT EXISTS (
          SELECT 1
          FROM shipcore.fc_container_items ci_any
          WHERE ci_any.container_id = c.id
        )
        OR EXISTS (
          SELECT 1
          FROM shipcore.fc_container_items ci_filter
          JOIN shipcore.fc_products p_filter ON p_filter.master_sku = ci_filter.master_sku
          WHERE ci_filter.container_id = c.id
            AND p_filter.category_code = $${categoryParamIndex}
        )
      )`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const itemCategoryJoin = categoryParamIndex
      ? `JOIN shipcore.fc_products p_item ON p_item.master_sku = fc_container_items.master_sku
         AND p_item.category_code = $${categoryParamIndex}`
      : "";

    const result = await getPrimaryPool().query(
      `SELECT
         c.id::text AS id,
         c.container_number,
         c.eta_date,
         c.actual_arrival_date,
         c.status::text AS status,
         c.cbm_capacity::text AS cbm_capacity,
         c.factory_name,
         c.origin,
         c.dest_warehouse,
         c.note,
         c.est_loading_date,
         c.etd_ngb_date,
         c.eta_lax_lgb_date,
         COALESCE(item_summary.item_count, 0)::int AS item_count,
         COALESCE(item_summary.total_qty, 0)::int AS total_qty,
         COALESCE(item_summary.total_cbm, 0)::text AS total_cbm,
         COALESCE(item_summary.items, '[]'::json) AS items
       FROM shipcore.fc_containers c
       LEFT JOIN (
         SELECT
           fc_container_items.container_id,
           COUNT(*)::int AS item_count,
           COALESCE(SUM(fc_container_items.qty), 0)::int AS total_qty,
           COALESCE(SUM(fc_container_items.total_cbm), 0)::numeric AS total_cbm,
           json_agg(
             json_build_object(
               'id', fc_container_items.id::text,
               'sku', fc_container_items.master_sku,
               'qty', fc_container_items.qty,
               'cbm', COALESCE(
                 fc_container_items.cbm_unit,
                 CASE WHEN fc_container_items.qty > 0 THEN fc_container_items.total_cbm / fc_container_items.qty ELSE 0 END,
                 0
               ),
               'sku_memo', fc_container_items.sku_memo,
               'remaining_stock_qty', COALESCE((
                 SELECT SUM(s.total_qty)::int
                 FROM shipcore.fc_available_stock s
                 WHERE s.master_sku = fc_container_items.master_sku
                   AND s.source_type = 'remaining'
               ), 0),
               ${timelineView ? `'categoryCode', p_item.category_code` : `'allocations', COALESCE((
                 SELECT json_agg(
                   json_build_object(
                     'id', allocation.id::text,
                     'stockId', stock.id::text,
                     'sourceType', stock.source_type,
                     'referenceNo', stock.reference_no,
                     'qty', allocation.qty,
                     'cbm', stock.cbm_unit
                   )
                   ORDER BY allocation.id
                 )
                 FROM shipcore.fc_container_item_allocations allocation
                 JOIN shipcore.fc_available_stock stock ON stock.id = allocation.source_stock_id
                 WHERE allocation.container_id = fc_container_items.container_id
                   AND stock.master_sku = fc_container_items.master_sku
               ), '[]'::json)`}
             )
             ORDER BY fc_container_items.id
           ) AS items
         FROM shipcore.fc_container_items
         ${itemCategoryJoin || "LEFT JOIN shipcore.fc_products p_item ON p_item.master_sku = fc_container_items.master_sku"}
         GROUP BY fc_container_items.container_id
       ) item_summary ON item_summary.container_id = c.id
       ${where}
       ORDER BY c.eta_date NULLS LAST, c.id DESC`,
      params
    );

    const data = result.rows.map((row) => ({
      id: row.id as string,
      containerNumber: row.container_number as string,
      etaDate: serializeDate(row.eta_date),
      actualArrivalDate: serializeDate(row.actual_arrival_date),
      estLoadingDate: serializeDate(row.est_loading_date),
      etdNgbDate: serializeDate(row.etd_ngb_date),
      etaLaxLgbDate: serializeDate(row.eta_lax_lgb_date),
      status: row.status as string,
      cbmCapacity: Number(row.cbm_capacity ?? 0),
      factoryName: row.factory_name as string | null,
      origin: row.origin as string | null,
      destWarehouse: row.dest_warehouse as string | null,
      note: row.note as string | null,
      itemCount: Number(row.item_count ?? 0),
      totalQty: Number(row.total_qty ?? 0),
      totalCbm: Number(row.total_cbm ?? 0),
      ...(includeDetails
        ? {
            items: ((row.items ?? []) as Array<{
              id?: string;
              sku?: string;
              qty?: number;
              cbm?: string | number;
              sku_memo?: string | null;
              remaining_stock_qty?: number | null;
              categoryCode?: string | null;
              allocations?: Array<{
                id: string;
                stockId: string;
                sourceType: "remaining" | "mistake";
                referenceNo: string;
                qty: number;
                cbm: string | number;
              }>;
            }>).map((item) => ({
              id: item.id ?? "",
              sku: item.sku ?? "",
              qty: Number(item.qty ?? 0),
              cbm: Number(item.cbm ?? 0),
              skuMemo: item.sku_memo ?? null,
              remainingStockQty: Number(item.remaining_stock_qty ?? 0),
              ...(timelineView ? { categoryCode: item.categoryCode ?? null } : {}),
              ...(!timelineView
                ? {
                    allocations: (item.allocations ?? []).map((allocation) => ({
                      ...allocation,
                      qty: Number(allocation.qty ?? 0),
                      cbm: Number(allocation.cbm ?? 0),
                    })),
                  }
                : {}),
            })),
          }
        : {}),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching containers:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const client = await getPrimaryPool().connect();
  const session = await auth();

  try {
    if (session?.user?.id) {
      const allowed = await canDo(session.user.id, (session.user.role as string) ?? "user", "container-planning", "create");
      if (!allowed) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }
    const body: unknown = await request.json();
    const validated = ContainerSaveSchema.parse(body);
    const createStatus = validated.status ?? "draft";
    const distinctSkus = [...new Set(validated.items.map((item) => item.sku.trim().toUpperCase()))];

    await client.query("BEGIN");

    const skuResult = await client.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [distinctSkus]
    );
    const existingSkus = new Set(skuResult.rows.map((row) => row.master_sku));
    const missingSkus = distinctSkus.filter((sku) => !existingSkus.has(sku));

    if (missingSkus.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: `SKU does not exist in fc_products: ${missingSkus.join(", ")}` },
        { status: 400 }
      );
    }

    const containerResult = await client.query<{ id: string }>(
      `INSERT INTO shipcore.fc_containers
         (container_number, eta_date, status, cbm_capacity, factory_name, origin, dest_warehouse, note, est_loading_date, etd_ngb_date, eta_lax_lgb_date, created_at, updated_at)
       VALUES ($1, $2::date, $3::shipcore.fc_container_status, $4::numeric, $5, $6, $7, $8, $9::date, $10::date, $11::date, NOW(), NOW())
       RETURNING id::text`,
      [
        validated.number.trim(),
        validated.eta,
        toDbStatus(createStatus),
        validated.cbmCapacity,
        validated.factory?.trim() || null,
        validated.origin?.trim() || null,
        validated.destination?.trim() || null,
        validated.note?.trim() || null,
        validated.estLoading?.trim() || null,
        validated.etdNgb?.trim() || null,
        validated.etaLaxLgb?.trim() || null,
      ]
    );
    const containerId = containerResult.rows[0].id;

    for (const item of validated.items) {
      await client.query(
        `INSERT INTO shipcore.fc_container_items
           (container_id, master_sku, qty, cbm_unit, sku_memo, created_at, updated_at)
         VALUES ($1::bigint, $2, $3::int, $4::numeric(14,6), $5, NOW(), NOW())`,
        [containerId, item.sku.trim().toUpperCase(), item.qty, item.cbm, item.skuMemo || null]
      );
    }

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    void logContainerAudit({
      containerId: containerId,
      containerNumber: validated.number.trim(),
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: {
        status: createStatus,
        eta: validated.eta,
        factory: validated.factory ?? null,
        destWarehouse: validated.destination ?? null,
        skuCount: validated.items.length,
        totalQty: validated.items.reduce((s, i) => s + i.qty, 0),
      },
      ip: getRequestIp(request),
    });

    return NextResponse.json({ success: true, data: { id: containerId } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    if ((error as { code?: string; constraint?: string }).constraint === "fc_containers_number_uk") {
      return NextResponse.json(
        { success: false, error: "Container number already exists." },
        { status: 409 }
      );
    }

    console.error("Error creating container:", error);
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
  const session = await auth();
  const ip = getRequestIp(request);

  try {
    if (session?.user?.id) {
      const allowed = await canDo(session.user.id, (session.user.role as string) ?? "user", "container-planning", "edit");
      if (!allowed) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Container id is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid container id" },
        { status: 400 }
      );
    }

    const body: unknown = await request.json();
    const detailsOnly = searchParams.get("detailsOnly") === "true";
    const existingRow = await client.query<{
      status: string;
      container_number: string;
      eta: string | null;
      cbm_capacity: number;
      factory_name: string | null;
      dest_warehouse: string | null;
      note: string | null;
      est_loading: string | null;
      etd_ngb: string | null;
      eta_lax_lgb: string | null;
    }>(
      `SELECT status::text AS status,
              container_number,
              eta_date::text AS eta,
              cbm_capacity,
              factory_name,
              dest_warehouse,
              note,
              est_loading_date::text AS est_loading,
              etd_ngb_date::text AS etd_ngb,
              eta_lax_lgb_date::text AS eta_lax_lgb
       FROM shipcore.fc_containers WHERE id = $1::bigint`,
      [id],
    );

    if (existingRow.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "Container not found" },
        { status: 404 }
      );
    }

    const existing = existingRow.rows[0]!;

    const statusOnly = z.object({ status: ContainerStatusSchema }).strict().safeParse(body);

    if (statusOnly.success) {
      const result = await client.query(
        `UPDATE shipcore.fc_containers
         SET status = $2::shipcore.fc_container_status,
             updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id`,
        [id, toDbStatus(statusOnly.data.status)]
      );

      if (result.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: "Container not found" },
          { status: 404 }
        );
      }

      await invalidatePlanningDashboardCache();

      const oldStatus = fromDbStatus(existing.status);
      if (oldStatus !== statusOnly.data.status) {
        void logContainerAudit({
          containerId: id,
          containerNumber: existing.container_number,
          userId: session?.user?.id ?? null,
          userName: session?.user?.name ?? null,
          userEmail: session?.user?.email ?? null,
          action: "status_change",
          before: { status: oldStatus },
          after: { status: statusOnly.data.status },
          ip,
        });
      }

      return NextResponse.json({ success: true, data: { id } });
    }

    if (existing.status === "complete") {
      return NextResponse.json(
        { success: false, error: "Stock-in completed containers cannot be modified." },
        { status: 403 }
      );
    }

    if (detailsOnly) {
      const details = ContainerDetailsSchema.parse(body);
      const result = await client.query(
        `UPDATE shipcore.fc_containers
         SET container_number = $2,
             eta_date = $3::date,
             cbm_capacity = $4::numeric,
             factory_name = $5,
             dest_warehouse = $6,
             note = $7,
             est_loading_date = $8::date,
             etd_ngb_date = $9::date,
             eta_lax_lgb_date = $10::date,
             updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id`,
        [
          id,
          details.number,
          details.eta,
          details.cbmCapacity,
          details.factory || null,
          details.destination || null,
          details.note || null,
          details.estLoading?.trim() || null,
          details.etdNgb?.trim() || null,
          details.etaLaxLgb?.trim() || null,
        ]
      );

      if (result.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: "Container not found" },
          { status: 404 }
        );
      }

      await invalidatePlanningDashboardCache();

      const beforeSnap = {
        status: fromDbStatus(existing.status), eta: existing.eta,
        factory: existing.factory_name, destWarehouse: existing.dest_warehouse,
        cbmCapacity: existing.cbm_capacity, note: existing.note,
        estLoading: existing.est_loading, etdNgb: existing.etd_ngb, etaLaxLgb: existing.eta_lax_lgb,
      };
      const afterSnap = {
        status: fromDbStatus(existing.status), eta: details.eta,
        factory: details.factory ?? null, destWarehouse: details.destination ?? null,
        cbmCapacity: details.cbmCapacity, note: details.note ?? null,
        estLoading: details.estLoading ?? null, etdNgb: details.etdNgb ?? null, etaLaxLgb: details.etaLaxLgb ?? null,
      };

      // Determine which sub-action to log
      const statusChanged = beforeSnap.status !== afterSnap.status;
      if (statusChanged) {
        void logContainerAudit({
          containerId: id, containerNumber: existing.container_number,
          userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
          action: "status_change",
          before: { status: beforeSnap.status }, after: { status: afterSnap.status },
          ip,
        });
      }
      const etaChanged = beforeSnap.eta !== afterSnap.eta;
      if (etaChanged) {
        void logContainerAudit({
          containerId: id, containerNumber: details.number,
          userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
          action: "eta_change",
          before: { eta: beforeSnap.eta }, after: { eta: afterSnap.eta },
          ip,
        });
      }
      const otherFields = ["factory", "destWarehouse", "cbmCapacity", "note", "estLoading", "etdNgb", "etaLaxLgb"] as const;
      const otherChanged = otherFields.some((k) => String(beforeSnap[k] ?? "") !== String(afterSnap[k] ?? ""));
      if (otherChanged) {
        void logContainerAudit({
          containerId: id, containerNumber: details.number,
          userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
          action: "details_update",
          before: beforeSnap as Record<string, unknown>,
          after: afterSnap as Record<string, unknown>,
          ip,
        });
      }

      return NextResponse.json({ success: true, data: { id, updated: "details" } });
    }

    const etaOnly = z.object({ eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().safeParse(body);

    if (etaOnly.success) {
      const result = await client.query(
        `UPDATE shipcore.fc_containers
         SET eta_date = $2::date,
             updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id`,
        [id, etaOnly.data.eta]
      );

      if (result.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: "Container not found" },
          { status: 404 }
        );
      }

      await invalidatePlanningDashboardCache();

      if (existing.eta !== etaOnly.data.eta) {
        void logContainerAudit({
          containerId: id, containerNumber: existing.container_number,
          userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
          action: "eta_change",
          before: { eta: existing.eta }, after: { eta: etaOnly.data.eta },
          ip,
        });
      }

      return NextResponse.json({ success: true, data: { id } });
    }

    const validated = ContainerSaveSchema.parse(body);
    const distinctSkus = [...new Set(validated.items.map((item) => item.sku.trim().toUpperCase()))];

    await client.query("BEGIN");

    const existingForUpdate = await client.query<{ id: string; sku_count: number; total_qty: number }>(
      `SELECT c.id,
              COUNT(i.id)::int AS sku_count,
              COALESCE(SUM(i.qty), 0)::int AS total_qty
       FROM shipcore.fc_containers c
       LEFT JOIN shipcore.fc_container_items i ON i.container_id = c.id
       WHERE c.id = $1::bigint
       FOR UPDATE OF c`,
      [id],
    );

    if (existingForUpdate.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Container not found" },
        { status: 404 }
      );
    }

    const itemsBefore = { skuCount: existingForUpdate.rows[0]!.sku_count, totalQty: existingForUpdate.rows[0]!.total_qty };

    const skuResult = await client.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [distinctSkus]
    );
    const existingSkus = new Set(skuResult.rows.map((row) => row.master_sku));
    const missingSkus = distinctSkus.filter((sku) => !existingSkus.has(sku));

    if (missingSkus.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: `SKU does not exist in fc_products: ${missingSkus.join(", ")}` },
        { status: 400 }
      );
    }

    await client.query(
      `UPDATE shipcore.fc_containers
       SET container_number = $2,
           eta_date = $3::date,
           cbm_capacity = $4::numeric,
           factory_name = $5,
           origin = $6,
           dest_warehouse = $7,
           note = $8,
           est_loading_date = $9::date,
           etd_ngb_date = $10::date,
           eta_lax_lgb_date = $11::date,
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [
        id,
        validated.number.trim(),
        validated.eta,
        validated.cbmCapacity,
        validated.factory?.trim() || null,
        validated.origin?.trim() || null,
        validated.destination?.trim() || null,
        validated.note?.trim() || null,
        validated.estLoading?.trim() || null,
        validated.etdNgb?.trim() || null,
        validated.etaLaxLgb?.trim() || null,
      ]
    );

    if (validated.items.length > 0) {
      await client.query(`DELETE FROM shipcore.fc_container_items WHERE container_id = $1::bigint`, [id]);

      for (const item of validated.items) {
        await client.query(
          `INSERT INTO shipcore.fc_container_items
             (container_id, master_sku, qty, cbm_unit, sku_memo, created_at, updated_at)
           VALUES ($1::bigint, $2, $3::int, $4::numeric(14,6), $5, NOW(), NOW())`,
          [id, item.sku.trim().toUpperCase(), item.qty, item.cbm, item.skuMemo || null]
        );
      }
    }

    await client.query(`DELETE FROM shipcore.fc_container_po_links WHERE container_id = $1::bigint`, [id]);

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    // Log details change
    const detailsBefore = {
      status: fromDbStatus(existing.status), eta: existing.eta,
      factory: existing.factory_name, destWarehouse: existing.dest_warehouse,
      cbmCapacity: existing.cbm_capacity, note: existing.note,
      estLoading: existing.est_loading, etdNgb: existing.etd_ngb, etaLaxLgb: existing.eta_lax_lgb,
    };
    const detailsAfter = {
      status: fromDbStatus(existing.status), eta: validated.eta,
      factory: validated.factory ?? null, destWarehouse: validated.destination ?? null,
      cbmCapacity: validated.cbmCapacity, note: validated.note ?? null,
      estLoading: validated.estLoading ?? null, etdNgb: validated.etdNgb ?? null, etaLaxLgb: validated.etaLaxLgb ?? null,
    };
    if (detailsBefore.status !== detailsAfter.status) {
      void logContainerAudit({
        containerId: id, containerNumber: validated.number.trim(),
        userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
        action: "status_change",
        before: { status: detailsBefore.status }, after: { status: detailsAfter.status },
        ip,
      });
    }
    if (detailsBefore.eta !== detailsAfter.eta) {
      void logContainerAudit({
        containerId: id, containerNumber: validated.number.trim(),
        userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
        action: "eta_change",
        before: { eta: detailsBefore.eta }, after: { eta: detailsAfter.eta },
        ip,
      });
    }
    // Log items change
    if (validated.items.length > 0) {
      const itemsAfter = {
        skuCount: validated.items.length,
        totalQty: validated.items.reduce((s, i) => s + i.qty, 0),
      };
      if (itemsBefore.skuCount !== itemsAfter.skuCount || itemsBefore.totalQty !== itemsAfter.totalQty) {
        void logContainerAudit({
          containerId: id, containerNumber: validated.number.trim(),
          userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null,
          action: "items_update",
          before: itemsBefore as Record<string, unknown>,
          after: itemsAfter as Record<string, unknown>,
          ip,
        });
      }
    }

    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error updating container:", error);
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
    const denied = await guardPermission("container-planning", "delete");
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Container id is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid container id" },
        { status: 400 }
      );
    }

    const session = await auth();
    const ip = getRequestIp(request);

    await client.query("BEGIN");

    const existing = await client.query<{
      id: string; status: string; container_number: string; eta: string | null;
    }>(
      `SELECT id, status::text AS status, container_number,
              eta_date::text AS eta
       FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`,
      [id],
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Container not found" },
        { status: 404 }
      );
    }

    if (existing.rows[0]?.status === "complete") {
      if (!session?.user || !isPOApproverRole(session.user.role)) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "Only Planner or Admin can delete Stock-in completed containers." },
          { status: 403 }
        );
      }
    }

    const deletedContainer = existing.rows[0]!;

    await client.query(`DELETE FROM shipcore.fc_container_item_allocations WHERE container_id = $1::bigint`, [id]);
    await client.query(`DELETE FROM shipcore.fc_container_items WHERE container_id = $1::bigint`, [id]);
    await client.query(`DELETE FROM shipcore.fc_container_po_links WHERE container_id = $1::bigint`, [id]);

    const deleted = await client.query(
      `DELETE FROM shipcore.fc_containers WHERE id = $1::bigint RETURNING id`,
      [id]
    );

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    void logContainerAudit({
      containerId: id,
      containerNumber: deletedContainer.container_number,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: {
        status: fromDbStatus(deletedContainer.status),
        eta: deletedContainer.eta,
        containerNumber: deletedContainer.container_number,
      },
      ip,
    });

    return NextResponse.json({
      success: true,
      data: { id: String(deleted.rows[0]?.id ?? id) },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting container:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
