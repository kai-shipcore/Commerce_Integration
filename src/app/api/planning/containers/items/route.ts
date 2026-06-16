// Code Guide: POST /api/planning/containers/items
// Creates or replaces one fc_container_items row for a SKU in a container.
// If remaining available stock exists for that SKU, the matching allocation
// rows are synchronized in the same transaction.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { syncRemainingAllocationForContainerItem } from "@/lib/planning/available-stock-allocation";
import { z } from "zod";

const BodySchema = z.object({
  container_id: z.number().int().positive(),
  master_sku: z.string().min(1),
  qty: z.number().int().min(0),
  cbm_unit: z.number().min(0).default(0),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { container_id, master_sku, qty, cbm_unit: rawCbmUnit } = parsed.data;
  const normalizedSku = master_sku.toUpperCase();
  const client = await getPrimaryPool().connect();

  try {
    await client.query("BEGIN");

    let cbmUnit = rawCbmUnit;
    if (cbmUnit <= 0) {
      const prod = await client.query<{ cbm_per_unit: string }>(
        `SELECT cbm_per_unit::float8 FROM shipcore.fc_products WHERE master_sku = $1 LIMIT 1`,
        [normalizedSku],
      );
      cbmUnit = prod.rows[0] ? parseFloat(prod.rows[0].cbm_per_unit) : 0;
    }

    if (cbmUnit <= 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "No CBM per unit on file for this SKU. Set it in SKU Master first." },
        { status: 400 },
      );
    }

    const result = await client.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       VALUES ($1, $2, $3::int, $4::numeric(14,6), NOW(), NOW())
       ON CONFLICT (container_id, master_sku) DO UPDATE
         SET qty = EXCLUDED.qty,
             cbm_unit = EXCLUDED.cbm_unit,
             updated_at = NOW()
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [container_id, normalizedSku, qty, cbmUnit],
    );

    const allocatedQty = await syncRemainingAllocationForContainerItem(client, {
      containerId: container_id,
      masterSku: normalizedSku,
      targetQty: qty,
    });

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      item_id: row.id,
      qty,
      allocated_qty: allocatedQty,
      cbm_unit: parseFloat(row.cbm_unit),
      total_cbm: parseFloat(row.total_cbm),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Container item POST failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
