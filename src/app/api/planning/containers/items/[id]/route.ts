// Code Guide: PATCH /api/planning/containers/items/[id]
// Updates qty for a single fc_container_items row and keeps remaining-stock
// allocations synchronized.
//
// DELETE /api/planning/containers/items/[id]
// Removes the item and any remaining-stock allocations attached to it.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import {
  deleteRemainingAllocationsForContainerItem,
  syncRemainingAllocationForContainerItem,
} from "@/lib/planning/available-stock-allocation";
import { guardPermission } from "@/lib/permissions";
import { z } from "zod";

const BodySchema = z.object({
  qty: z.number().int().min(0),
  sku_memo: z.string().optional(),
});

type ItemRow = {
  id: number;
  container_id: number;
  master_sku: string;
  cbm_unit: string;
  total_cbm: string;
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

function parseItemId(id: string) {
  const itemId = parseInt(id, 10);
  return Number.isNaN(itemId) ? null : itemId;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("container-planning", "delete");
  if (denied) return denied;
  const { id } = await params;
  const itemId = parseItemId(id);
  if (itemId == null) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");

    const itemResult = await client.query<ItemRow>(
      `SELECT id, container_id::int, master_sku, cbm_unit::float8, total_cbm::float8
       FROM shipcore.fc_container_items
       WHERE id = $1
       FOR UPDATE`,
      [itemId],
    );

    if (itemResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const item = itemResult.rows[0];
    await deleteRemainingAllocationsForContainerItem(client, {
      containerId: item.container_id,
      masterSku: item.master_sku,
    });

    await client.query(`DELETE FROM shipcore.fc_container_items WHERE id = $1`, [itemId]);

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Container item DELETE failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("container-planning", "edit");
  if (denied) return denied;
  const { id } = await params;
  const itemId = parseItemId(id);
  if (itemId == null) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "qty must be a non-negative integer" }, { status: 400 });
  }

  const { qty, sku_memo } = parsed.data;
  const client = await getPrimaryPool().connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query<ItemRow>(
      `SELECT id, container_id::int, master_sku, cbm_unit::float8, total_cbm::float8
       FROM shipcore.fc_container_items
       WHERE id = $1
       FOR UPDATE`,
      [itemId],
    );

    if (existingResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const existing = existingResult.rows[0];
    const result = await client.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `UPDATE shipcore.fc_container_items
       SET qty = $1,
           sku_memo = $3,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [qty, itemId, sku_memo ?? null],
    );

    const allocatedQty = await syncRemainingAllocationForContainerItem(client, {
      containerId: existing.container_id,
      masterSku: existing.master_sku,
      targetQty: qty,
    });

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    return NextResponse.json({
      success: true,
      qty,
      allocated_qty: allocatedQty,
      cbm_unit: parseFloat(result.rows[0].cbm_unit),
      total_cbm: parseFloat(result.rows[0].total_cbm),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Container item PATCH failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
