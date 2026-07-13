// Code Guide: GET /api/production/vehicle-options
// No `make` param — returns distinct Make values from shipcore.sc_product_vehicle.
// `?make=X` — returns distinct Model values for that Make.
// Backs the Make/Model cascading selects in the Part SKU Generator.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const role = (session.user.role as string) ?? "user";
  const allowed =
    (await canDo(session.user.id, role, "part-sku-generator", "read")) ||
    (await canDo(session.user.id, role, "project-list", "read"));
  if (!allowed) {
    return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const make = searchParams.get("make")?.trim();

  const pool = getPrimaryPool();
  try {
    if (make) {
      const result = await pool.query<{ model: string }>(
        `SELECT DISTINCT model FROM shipcore.sc_product_vehicle
         WHERE make = $1 AND model IS NOT NULL
         ORDER BY model`,
        [make]
      );
      return NextResponse.json({ success: true, data: result.rows.map((r) => r.model) });
    }

    const result = await pool.query<{ make: string }>(
      `SELECT DISTINCT make FROM shipcore.sc_product_vehicle
       WHERE make IS NOT NULL
       ORDER BY make`
    );
    return NextResponse.json({ success: true, data: result.rows.map((r) => r.make) });
  } catch (error) {
    console.error("vehicle-options GET error:", error);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }
}
