// Code Guide: PATCH /api/planning/sku/[sku]/memo — save a per-SKU memo note.
// Upserts into fc_products. Memo is displayed in the Master SKU popup on the demand planning grid.
// Controller layer only: delegates the upsert + cache invalidation to SkuMemoService.

import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { SkuMemoService } from "@/lib/sku-memo/service";

const bodySchema = z.object({
  memo: z.string().max(5000),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;
  try {
    const { sku } = await params;
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
    }

    await SkuMemoService.saveMemo(sku, parsed.data.memo);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
