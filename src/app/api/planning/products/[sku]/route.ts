// Code Guide: PATCH /api/planning/products/[sku] — update cbm_per_unit for a SKU in fc_products.
// Used by the planning dashboard inline CBM editor.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

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
    await primary.query(
      `INSERT INTO shipcore.fc_products (master_sku, cbm_per_unit, updated_at)
       VALUES ($1, $2::numeric, NOW())
       ON CONFLICT (master_sku) DO UPDATE SET cbm_per_unit = EXCLUDED.cbm_per_unit, updated_at = NOW()`,
      [sku, cbm],
    );

    return NextResponse.json({ success: true, cbm_per_unit: cbm });
  } catch (error) {
    console.error("PATCH /api/planning/products/[sku] failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
