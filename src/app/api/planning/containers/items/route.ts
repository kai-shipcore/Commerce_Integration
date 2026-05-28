// Code Guide: POST /api/planning/containers/items
// Creates a new fc_container_items row for a SKU that doesn't yet have one
// in a given container. Used by inline editing on the planning dashboard.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { z } from "zod";

const BodySchema = z.object({
  container_id: z.number().int().positive(),
  master_sku:   z.string().min(1),
  qty:          z.number().int().min(0),
  cbm_unit:     z.number().min(0).default(0),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  const { container_id, master_sku, qty, cbm_unit: rawCbmUnit } = parsed.data;

  try {
    const primary = getPrimaryPool();

    // If cbm_unit wasn't supplied (0 default), fall back to fc_products.cbm_per_unit.
    let cbm_unit = rawCbmUnit;
    if (cbm_unit <= 0) {
      const prod = await primary.query<{ cbm_per_unit: string }>(
        `SELECT cbm_per_unit::float8 FROM shipcore.fc_products WHERE master_sku = $1 LIMIT 1`,
        [master_sku.toUpperCase()],
      );
      cbm_unit = prod.rows[0] ? parseFloat(prod.rows[0].cbm_per_unit) : 0;
    }
    if (cbm_unit <= 0) {
      return NextResponse.json(
        { success: false, error: "No CBM per unit on file for this SKU. Set it in SKU Master first." },
        { status: 400 },
      );
    }

    // total_cbm is a generated column — omit it from INSERT/UPDATE; DB computes it.
    const result = await primary.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       VALUES ($1, $2, $3::int, $4::float8, NOW(), NOW())
       ON CONFLICT (container_id, master_sku) DO UPDATE
         SET qty        = EXCLUDED.qty,
             updated_at = NOW()
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [container_id, master_sku.toUpperCase(), qty, cbm_unit],
    );

    const row = result.rows[0];
    await invalidatePlanningDashboardCache();
    return NextResponse.json({
      success:   true,
      item_id:   row.id,
      qty,
      cbm_unit:  parseFloat(row.cbm_unit),
      total_cbm: parseFloat(row.total_cbm),
    });
  } catch (error) {
    console.error("Container item POST failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
