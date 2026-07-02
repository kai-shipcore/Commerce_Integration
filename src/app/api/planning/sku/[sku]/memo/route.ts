// Code Guide: PATCH /api/planning/sku/[sku]/memo — save a per-SKU memo note.
// Upserts into fc_products. Memo is displayed in the Master SKU popup on the demand planning grid.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

const bodySchema = z.object({
  memo: z.string().max(5000),
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
    const { memo } = parsed.data;

    const primary = getPrimaryPool();
    await primary.query(
      `INSERT INTO shipcore.fc_products (master_sku, memo)
       VALUES ($1, $2)
       ON CONFLICT (master_sku) DO UPDATE SET memo = $2, updated_at = NOW()`,
      [sku, memo || null],
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
