// Code Guide: PATCH /api/planning/sku/stock-mode — bulk-set stock mode for multiple SKUs.
// Updates both fc_stats and fc_stats_custom. Locked rows (transit_stock >= 1) are
// excluded client-side before this call; the API does not re-check transit_stock.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

const bodySchema = z.object({
  skus: z.array(z.string()).min(1).max(5000),
  stock_mode: z.enum(["onhand", "available"]),
});

export async function PATCH(req: Request) {
  const denied = await guardPermission("available-stock", "edit");
  if (denied) return denied;
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      console.error("[bulk stock-mode] validation error:", JSON.stringify(parsed.error.issues));
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { skus, stock_mode } = parsed.data;

    const primary = getPrimaryPool();
    await Promise.all([
      primary.query(
        `UPDATE shipcore.fc_stats        SET stock_mode = $1, updated_at = NOW() WHERE master_sku = ANY($2::text[])`,
        [stock_mode, skus],
      ),
      primary.query(
        `UPDATE shipcore.fc_stats_custom SET stock_mode = $1, updated_at = NOW() WHERE master_sku = ANY($2::text[])`,
        [stock_mode, skus],
      ),
    ]);

    return NextResponse.json({ success: true, updated: skus.length });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
