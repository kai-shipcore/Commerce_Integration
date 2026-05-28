// Code Guide: PATCH /api/planning/containers/items/[id]
// Updates qty (and recomputes total_cbm = qty * cbm_unit) for a single
// fc_container_items row. Used by inline editing on the planning dashboard.
//
// DELETE /api/planning/containers/items/[id]
// Removes the row entirely. Called when the user sets qty to 0.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { z } from "zod";

const BodySchema = z.object({
  qty: z.number().int().min(0),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const itemId = parseInt(id);
  if (isNaN(itemId)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const primary = getPrimaryPool();
    const result = await primary.query(
      `DELETE FROM shipcore.fc_container_items WHERE id = $1`,
      [itemId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Container item DELETE failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const itemId = parseInt(id);
  if (isNaN(itemId)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "qty must be a non-negative integer" }, { status: 400 });
  }

  const { qty } = parsed.data;

  try {
    const primary = getPrimaryPool();
    // total_cbm is a generated column — omit it from SET; DB recomputes it on qty change.
    const result = await primary.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `UPDATE shipcore.fc_container_items
       SET qty        = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [qty, itemId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    await invalidatePlanningDashboardCache();
    return NextResponse.json({
      success:   true,
      qty,
      cbm_unit:  parseFloat(result.rows[0].cbm_unit),
      total_cbm: parseFloat(result.rows[0].total_cbm),
    });
  } catch (error) {
    console.error("Container item PATCH failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
