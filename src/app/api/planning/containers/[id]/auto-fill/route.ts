// Code Guide: POST /api/planning/containers/[id]/auto-fill
// Bulk-upserts fc_container_items for a container from optimizer-calculated quantities.
// cbm_unit is looked up from fc_products. Returns item_id, qty, cbm_unit, total_cbm per SKU.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { syncRemainingAllocationForContainerItem } from "@/lib/planning/available-stock-allocation";

const BodySchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    qty: z.number().int().min(0),
  })).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const containerId = parseInt(id, 10);
  if (!Number.isFinite(containerId) || containerId <= 0) {
    return NextResponse.json({ success: false, error: "Invalid container id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  const { items } = parsed.data;
  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    const skus = items.map((i) => i.sku.toUpperCase());
    const cbmResult = await client.query<{ master_sku: string; cbm_per_unit: string }>(
      `SELECT master_sku, cbm_per_unit::float8 FROM shipcore.fc_products WHERE master_sku = ANY($1)`,
      [skus],
    );
    const cbmMap = new Map(cbmResult.rows.map((r) => [r.master_sku, parseFloat(r.cbm_per_unit)]));

    await client.query("BEGIN");

    const results: Array<{
      sku: string;
      item_id: number;
      qty: number;
      cbm_unit: number;
      total_cbm: number;
      allocated_qty: number;
    }> = [];

    for (const item of items) {
      const sku = item.sku.toUpperCase();
      const cbmUnit = cbmMap.get(sku) ?? 0;
      if (cbmUnit <= 0) continue;

      const row = await client.query<{ id: number; cbm_unit: string; total_cbm: string }>(
        `INSERT INTO shipcore.fc_container_items
           (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
         VALUES ($1, $2, $3::int, $4::float8, NOW(), NOW())
         ON CONFLICT (container_id, master_sku) DO UPDATE
           SET qty        = EXCLUDED.qty,
               updated_at = NOW()
         RETURNING id, cbm_unit::float8, total_cbm::float8`,
        [containerId, sku, item.qty, cbmUnit],
      );

      const allocatedQty = await syncRemainingAllocationForContainerItem(client, {
        containerId,
        masterSku: sku,
        targetQty: item.qty,
      });

      const r = row.rows[0];
      results.push({
        sku,
        item_id: r.id,
        qty: item.qty,
        cbm_unit: parseFloat(r.cbm_unit),
        total_cbm: parseFloat(r.total_cbm),
        allocated_qty: allocatedQty,
      });
    }

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    return NextResponse.json({ success: true, items: results });
  } catch (e) {
    await client.query("ROLLBACK");
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
