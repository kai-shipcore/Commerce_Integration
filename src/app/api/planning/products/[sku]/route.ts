// Code Guide: PATCH /api/planning/products/[sku] — update cbm_per_unit for a SKU in fc_products.
// Used by the planning dashboard inline CBM editor.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const { sku } = await params;
    const body = await req.json() as { cbm_per_unit?: unknown };
    const cbm = parseFloat(String(body.cbm_per_unit ?? ""));

    if (!sku || isNaN(cbm) || cbm < 0) {
      return NextResponse.json({ success: false, error: "Invalid sku or cbm_per_unit" }, { status: 400 });
    }

    const primary = getPrimaryPool();
    const client = await primary.connect();
    let containerItems: Array<{
      item_id: number;
      container_name: string;
      cbm_unit: number;
      total_cbm: number;
    }> = [];

    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE shipcore.fc_products SET cbm_per_unit = $2::numeric, updated_at = NOW() WHERE master_sku = $1`,
        [sku, cbm],
      );
      const result = await client.query<{
        item_id: number;
        container_name: string;
        cbm_unit: number;
        total_cbm: number;
      }>(
        `UPDATE shipcore.fc_container_items ci
         SET cbm_unit   = $2::numeric,
             updated_at = NOW()
         FROM shipcore.fc_containers c
         WHERE ci.container_id = c.id
           AND ci.master_sku = $1
         RETURNING
           ci.id::int              AS item_id,
           c.container_number      AS container_name,
           ci.cbm_unit::float8     AS cbm_unit,
           ci.total_cbm::float8    AS total_cbm`,
        [sku, cbm],
      );
      containerItems = result.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true, cbm_per_unit: cbm, container_items: containerItems });
  } catch (error) {
    console.error("PATCH /api/planning/products/[sku] failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
