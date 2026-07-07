// Code Guide: POST /api/planning/transit-records/import — bulk-create transit records from Excel upload.
// Caller pre-selects source/dest warehouses; rows only carry masterSku, qty, notes.
// After insert, syncs fc_stats.transit_stock for all affected SKUs.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { syncTransitStock } from "@/lib/planning/transit-stock-sync";

const importSchema = z.object({
  sourceWarehouseCode: z.string().min(1),
  destWarehouseCode: z.string().min(1),
  rows: z.array(z.object({
    masterSku: z.string().min(1),
    qty: z.number().int().min(1),
    notes: z.string().optional(),
  })).min(1).max(2000),
}).refine((d) => d.sourceWarehouseCode !== d.destWarehouseCode, {
  message: "Source and destination warehouses must be different",
});

export async function POST(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { sourceWarehouseCode, destWarehouseCode, rows } = parsed.data;
    const primary = getPrimaryPool();
    await primary.query(
      `INSERT INTO shipcore.fc_transit_records
         (source_warehouse_code, dest_warehouse_code, master_sku, qty, status, notes)
       SELECT $1, $2, UNNEST($3::text[]), UNNEST($4::int[]), 'in_transit', UNNEST($5::text[])`,
      [
        sourceWarehouseCode,
        destWarehouseCode,
        rows.map((r) => r.masterSku),
        rows.map((r) => r.qty),
        rows.map((r) => r.notes ?? ""),
      ],
    );
    const skus = [...new Set(rows.map((r) => r.masterSku))];
    await syncTransitStock(skus);
    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
