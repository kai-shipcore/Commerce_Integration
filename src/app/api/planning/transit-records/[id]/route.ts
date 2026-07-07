// Code Guide: PATCH + DELETE /api/planning/transit-records/[id] — update status/qty/notes or delete.
// After each mutation, syncs fc_stats.transit_stock for the affected SKU.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { syncTransitStock } from "@/lib/planning/transit-stock-sync";

const patchSchema = z.object({
  status: z.enum(["in_transit", "arrived", "cancelled"]).optional(),
  qty: z.number().int().min(1).optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("transit-stock", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (parsed.data.status !== undefined)  { values.push(parsed.data.status);  updates.push(`status = $${values.length}`); }
    if (parsed.data.qty !== undefined)     { values.push(parsed.data.qty);     updates.push(`qty = $${values.length}`); }
    if (parsed.data.notes !== undefined)   { values.push(parsed.data.notes);   updates.push(`notes = $${values.length}`); }
    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
    }
    values.push(id);
    const primary = getPrimaryPool();
    const result = await primary.query(
      `UPDATE shipcore.fc_transit_records
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING master_sku AS "masterSku"`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    await syncTransitStock([result.rows[0].masterSku as string]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("transit-stock", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const primary = getPrimaryPool();
    const result = await primary.query(
      `DELETE FROM shipcore.fc_transit_records WHERE id = $1 RETURNING master_sku AS "masterSku"`,
      [id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    await syncTransitStock([result.rows[0].masterSku as string]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
