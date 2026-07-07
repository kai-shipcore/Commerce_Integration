// Code Guide: GET /api/planning/warehouses — list active warehouses for transit record dropdowns.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

export async function GET() {
  const denied = await guardPermission("transit-stock", "read");
  if (denied) return denied;
  try {
    const primary = getPrimaryPool();
    const result = await primary.query(
      `SELECT warehouse_code AS "warehouseCode", warehouse_name AS "warehouseName", warehouse_type AS "warehouseType"
       FROM shipcore.fc_warehouses
       WHERE is_active = true
       ORDER BY warehouse_name ASC`,
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
