// Code Guide: PATCH /api/planning/sku/[sku]/transit-stock — manually set transit_stock for a SKU.
// Updates both fc_stats and fc_stats_custom. Value is preserved on inventory sync.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";

const bodySchema = z.object({
  transit_stock: z.number().int().min(0),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const { sku } = await params;
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
    }
    const { transit_stock } = parsed.data;

    const primary = getPrimaryPool();
    await Promise.all([
      primary.query(
        `UPDATE shipcore.fc_stats        SET transit_stock = $1, updated_at = NOW() WHERE master_sku = $2`,
        [transit_stock, sku],
      ),
      primary.query(
        `UPDATE shipcore.fc_stats_custom SET transit_stock = $1, updated_at = NOW() WHERE master_sku = $2`,
        [transit_stock, sku],
      ),
    ]);

    return NextResponse.json({ success: true, transit_stock });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
