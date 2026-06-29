// Code Guide: GET + POST /api/production/product-vehicles
// GET  — returns all rows from shipcore.sc_product_vehicle
// POST — inserts a new vehicle row

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

const ALLOWED_COLUMNS = [
  "f_number",
  "vehicle_type",
  "year_generation",
  "make",
  "model",
  "model_2",
  "submodel_1_label", "submodel_1",
  "submodel_2_label", "submodel_2",
  "submodel_3_label", "submodel_3",
  "submodel_4_label", "submodel_4",
  "submodel_5_label", "submodel_5",
  "submodel_6_label", "submodel_6",
] as const;

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const pool = getPrimaryPool();
  try {
    const result = await pool.query(`
      SELECT
        id, f_number, vehicle_type, year_generation,
        make, model, model_2,
        submodel_1_label, submodel_1,
        submodel_2_label, submodel_2,
        submodel_3_label, submodel_3,
        submodel_4_label, submodel_4,
        submodel_5_label, submodel_5,
        submodel_6_label, submodel_6,
        updated_at
      FROM shipcore.sc_product_vehicle
      ORDER BY make, model, f_number
    `);
    return NextResponse.json({ success: true, data: result.rows, total: result.rowCount });
  } catch (error) {
    console.error("product-vehicles GET error:", error);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as Record<string, unknown>;
  if (!body["f_number"] || String(body["f_number"]).trim() === "") {
    return NextResponse.json({ success: false, error: "f_number is required" }, { status: 400 });
  }
  if (!body["make"] || String(body["make"]).trim() === "") {
    return NextResponse.json({ success: false, error: "make is required" }, { status: 400 });
  }
  if (!body["model"] || String(body["model"]).trim() === "") {
    return NextResponse.json({ success: false, error: "model is required" }, { status: 400 });
  }

  const pool = getPrimaryPool();
  const cols: string[] = [];
  const values: unknown[] = [];

  for (const col of ALLOWED_COLUMNS) {
    if (col in body) {
      cols.push(col);
      values.push(body[col] === "" ? null : body[col]);
    }
  }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

  try {
    await pool.query(
      `INSERT INTO shipcore.sc_product_vehicle (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[product-vehicles POST]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
