// Code Guide: GET + POST /api/planning/transit-records — list and create transit stock records.
// After creation, syncs fc_stats.transit_stock for the affected SKU.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { syncTransitStock } from "@/lib/planning/transit-stock-sync";

const createSchema = z.object({
  sourceWarehouseCode: z.string().min(1),
  destWarehouseCode: z.string().min(1),
  masterSku: z.string().min(1),
  qty: z.number().int().min(1),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const primary = getPrimaryPool();
    const result = await primary.query(
      `SELECT id::text, source_warehouse_code AS "sourceWarehouseCode", dest_warehouse_code AS "destWarehouseCode",
              master_sku AS "masterSku", qty, status, notes,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM shipcore.fc_transit_records
       ${statusFilter ? "WHERE status = $1" : ""}
       ORDER BY created_at DESC`,
      statusFilter ? [statusFilter] : [],
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardPermission("transit-stock", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { sourceWarehouseCode, destWarehouseCode, masterSku, qty, notes } = parsed.data;
    const primary = getPrimaryPool();
    const result = await primary.query(
      `INSERT INTO shipcore.fc_transit_records
         (source_warehouse_code, dest_warehouse_code, master_sku, qty, status, notes)
       VALUES ($1, $2, $3, $4, 'in_transit', $5)
       RETURNING id::text, source_warehouse_code AS "sourceWarehouseCode", dest_warehouse_code AS "destWarehouseCode",
                 master_sku AS "masterSku", qty, status, notes,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [sourceWarehouseCode, destWarehouseCode, masterSku, qty, notes ?? null],
    );
    await syncTransitStock([masterSku]);
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
