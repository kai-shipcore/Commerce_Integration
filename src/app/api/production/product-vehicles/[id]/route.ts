// Code Guide: PATCH /api/production/product-vehicles/[id] — update a vehicle row

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

const ALLOWED_COLUMNS = [
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const pool = getPrimaryPool();

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const col of ALLOWED_COLUMNS) {
    if (col in body) {
      values.push(body[col] === "" ? null : body[col]);
      setClauses.push(`${col} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(Number(id));

  try {
    await pool.query(
      `UPDATE shipcore.sc_product_vehicle SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
      values
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[product-vehicles PATCH]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
