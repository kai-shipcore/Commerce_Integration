// Code Guide: Available Stock CRUD/import (GET/POST create+import/PATCH/DELETE-by-stockId)
// backs the /planning/available-stock page and delegates to AvailableStockService.
//
// The container-allocation logic interleaved in this same file (POST
// action="allocate", DELETE by allocationIds) is a DIFFERENT domain
// (container-planning, not yet refactored) that happens to share this route
// path and the "available-stock" permission's edit action for historical
// reasons. It is intentionally left exactly as it was — inline, raw SQL,
// hand-rolled responses — rather than partially refactored into a
// service that doesn't fully exist yet. See src/lib/available-stock/repository.ts.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { AvailableStockService } from "@/lib/available-stock/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

const StockSourceSchema = z.enum(["remaining", "mistake"]);

const CreateStockSchema = z.object({
  sourceType: StockSourceSchema,
  referenceNo: z.string().trim().min(1),
  plNo: z.string().trim().optional(),
  masterSku: z.string().trim().min(1),
  totalQty: z.number().int().positive(),
  cbm: z.number().positive(),
  note: z.string().trim().optional(),
});

const UpdateStockSchema = CreateStockSchema.extend({
  id: z.string().regex(/^\d+$/),
});

const AllocateSchema = z.object({
  action: z.literal("allocate"),
  containerId: z.string().regex(/^\d+$/),
  allocations: z.array(z.object({
    stockId: z.string().regex(/^\d+$/),
    qty: z.number().int().positive(),
  })).min(1),
});

const ImportStockSchema = z.object({
  action: z.literal("import"),
  rows: z.array(z.object({
    sourceType: StockSourceSchema,
    referenceNo: z.string().trim().min(1),
    plNo: z.string().trim().optional(),
    masterSku: z.string().trim().min(1),
    totalQty: z.number().int().positive(),
    cbm: z.number().positive().optional(),
    note: z.string().trim().optional(),
  })).min(1),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function currentWho() {
  const session = await auth();
  return { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null };
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("available-stock", "read");
  if (denied) return denied;
  try {
    const containerId = new URL(request.url).searchParams.get("containerId")?.trim() ?? "";
    const data = await AvailableStockService.listStock(containerId || null);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  // allocate action modifies existing records; import/create add new ones
  const actionCheck = (body as { action?: string } | null)?.action;
  const postAction = actionCheck === "allocate" ? "edit" : "create";
  const denied = await guardPermission("available-stock", postAction);
  if (denied) return denied;

  const importRequest = ImportStockSchema.safeParse(body);
  if (importRequest.success) {
    try {
      const data = await AvailableStockService.importStock(importRequest.data.rows, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  const allocation = AllocateSchema.safeParse(body);

  if (!allocation.success) {
    try {
      const validated = CreateStockSchema.parse(body);
      const data = await AvailableStockService.createStock(validated, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  // ── container-planning territory below: intentionally untouched ────────
  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const container = await client.query<{ status: string }>(
      `SELECT status::text FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`,
      [allocation.data.containerId]
    );
    if (container.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Container not found" }, { status: 404 });
    }
    if (container.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Available stock can be added only while the container is Draft." }, { status: 409 });
    }

    const qtyByStockId = new Map<string, number>();
    for (const requested of allocation.data.allocations) {
      qtyByStockId.set(requested.stockId, (qtyByStockId.get(requested.stockId) ?? 0) + requested.qty);
    }

    const stockIds = [...qtyByStockId.keys()];
    const stockResult = await client.query<{ id: string; master_sku: string; cbm: number; available_qty: number }>(
      `SELECT
         s.id::text,
         s.master_sku,
         s.cbm_unit::float8 AS cbm,
         (s.total_qty - COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0))::int AS available_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = ANY($1::bigint[])
       FOR UPDATE OF s`,
      [stockIds]
    );

    if (stockResult.rowCount !== stockIds.length) {
      throw new Error("One or more available stock records were not found.");
    }

    const itemQtyBySku = new Map<string, { qty: number; cbm: number }>();
    for (const stock of stockResult.rows) {
      const requestedQty = qtyByStockId.get(stock.id) ?? 0;
      if (requestedQty > stock.available_qty) {
        throw new Error(`Requested quantity exceeds available quantity for ${stock.master_sku}`);
      }
      const current = itemQtyBySku.get(stock.master_sku);
      itemQtyBySku.set(stock.master_sku, {
        qty: (current?.qty ?? 0) + requestedQty,
        cbm: stock.cbm,
      });
    }

    const allocationStockIds = stockIds;
    const allocationQtys = allocationStockIds.map((stockId) => qtyByStockId.get(stockId) ?? 0);
    await client.query(
      `INSERT INTO shipcore.fc_container_item_allocations (container_id, source_stock_id, qty)
       SELECT $1::bigint, stock_id, qty
       FROM unnest($2::bigint[], $3::int[]) AS allocation(stock_id, qty)
       ON CONFLICT (container_id, source_stock_id) DO UPDATE SET
         qty = shipcore.fc_container_item_allocations.qty + EXCLUDED.qty,
         updated_at = NOW()`,
      [allocation.data.containerId, allocationStockIds, allocationQtys]
    );

    const itemSkus = [...itemQtyBySku.keys()];
    const itemQtys = itemSkus.map((sku) => itemQtyBySku.get(sku)?.qty ?? 0);
    const itemCbms = itemSkus.map((sku) => itemQtyBySku.get(sku)?.cbm ?? 0);
    await client.query(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       SELECT $1::bigint, master_sku, qty, cbm, NOW(), NOW()
       FROM unnest($2::text[], $3::int[], $4::numeric[]) AS item(master_sku, qty, cbm)
       ON CONFLICT (container_id, master_sku) DO UPDATE SET
         qty = shipcore.fc_container_items.qty + EXCLUDED.qty,
         cbm_unit = EXCLUDED.cbm_unit,
         updated_at = NOW()`,
      [allocation.data.containerId, itemSkus, itemQtys, itemCbms]
    );

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Available stock allocation failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 400 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("available-stock", "edit");
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    const validated = UpdateStockSchema.parse(body);
    const data = await AvailableStockService.updateStock(validated.id, validated, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("available-stock", "delete");
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const stockIdInput = searchParams.get("stockId")?.trim() ?? "";
  if (stockIdInput) {
    const stockIds = [...new Set(stockIdInput.split(",").map((id) => id.trim()).filter(Boolean))];
    if (stockIds.length === 0 || stockIds.some((id) => !/^\d+$/.test(id))) {
      return apiError("Valid stockId is required", 400);
    }

    try {
      const data = await AvailableStockService.deleteStock(stockIds, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  // ── container-planning territory below: intentionally untouched ────────
  const allocationInput = searchParams.get("allocationIds")?.trim() || searchParams.get("allocationId")?.trim() || "";
  const allocationIds = [...new Set(allocationInput.split(",").map((id) => id.trim()).filter(Boolean))];
  if (allocationIds.length === 0 || allocationIds.some((id) => !/^\d+$/.test(id))) {
    return NextResponse.json({ success: false, error: "Valid allocationId or allocationIds is required" }, { status: 400 });
  }

  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const allocationResult = await client.query<{ id: string; container_id: string; master_sku: string; qty: number; status: string }>(
      `SELECT
         a.id::text,
         a.container_id::text,
         s.master_sku,
         a.qty::int,
         c.status::text
       FROM shipcore.fc_container_item_allocations a
       JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
       JOIN shipcore.fc_containers c ON c.id = a.container_id
       WHERE a.id = ANY($1::bigint[])
       FOR UPDATE OF a, c`,
      [allocationIds]
    );

    if (allocationResult.rowCount !== allocationIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Allocation not found" }, { status: 404 });
    }

    const containerIds = new Set(allocationResult.rows.map((row) => row.container_id));
    if (containerIds.size !== 1) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Selected allocations must belong to the same container." }, { status: 400 });
    }

    const containerId = allocationResult.rows[0].container_id;
    if (allocationResult.rows.some((row) => row.status !== "draft")) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Allocated stock can be removed only while the container is Draft." }, { status: 409 });
    }

    const removeQtyBySku = new Map<string, number>();
    for (const row of allocationResult.rows) {
      removeQtyBySku.set(row.master_sku, (removeQtyBySku.get(row.master_sku) ?? 0) + row.qty);
    }

    const skus = [...removeQtyBySku.keys()];
    const removeQtys = skus.map((sku) => removeQtyBySku.get(sku) ?? 0);
    const itemResult = await client.query<{ master_sku: string; qty: number }>(
      `SELECT master_sku, qty::int
       FROM shipcore.fc_container_items
       WHERE container_id = $1::bigint
         AND master_sku = ANY($2::text[])
       FOR UPDATE`,
      [containerId, skus]
    );
    const itemQtyBySku = new Map(itemResult.rows.map((row) => [row.master_sku, row.qty]));
    const inconsistentSku = skus.find((sku) => (itemQtyBySku.get(sku) ?? 0) < (removeQtyBySku.get(sku) ?? 0));
    if (inconsistentSku) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Container item quantity is inconsistent with allocated stock." }, { status: 409 });
    }

    await client.query(
      `DELETE FROM shipcore.fc_container_item_allocations
       WHERE id = ANY($1::bigint[])`,
      [allocationIds]
    );

    await client.query(
      `UPDATE shipcore.fc_container_items ci
       SET qty = ci.qty - removed.remove_qty,
           updated_at = NOW()
       FROM (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty > removed.remove_qty`,
      [containerId, skus, removeQtys]
    );

    await client.query(
      `DELETE FROM shipcore.fc_container_items ci
       USING (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty = removed.remove_qty`,
      [containerId, skus, removeQtys]
    );

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true, data: { containerId, deletedCount: allocationIds.length } });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Available stock allocation DELETE failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
