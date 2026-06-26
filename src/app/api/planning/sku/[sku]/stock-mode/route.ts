// Code Guide: PATCH /api/planning/sku/[sku]/stock-mode — toggle per-SKU stock display mode.
// Updates both fc_stats and fc_stats_custom. Value is preserved on inventory sync.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

const bodySchema = z.object({
  stock_mode: z.enum(["onhand", "available"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  const denied = await guardPermission("available-stock", "edit");
  if (denied) return denied;
  try {
    const { sku } = await params;
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
    }
    const { stock_mode } = parsed.data;

    const primary = getPrimaryPool();
    await Promise.all([
      primary.query(
        `UPDATE shipcore.fc_stats        SET stock_mode = $1, updated_at = NOW() WHERE master_sku = $2`,
        [stock_mode, sku],
      ),
      primary.query(
        `UPDATE shipcore.fc_stats_custom SET stock_mode = $1, updated_at = NOW() WHERE master_sku = $2`,
        [stock_mode, sku],
      ),
    ]);

    return NextResponse.json({ success: true, stock_mode });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
