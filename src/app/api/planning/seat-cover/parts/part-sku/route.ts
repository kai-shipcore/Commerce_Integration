import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const ALLOWED_COLUMNS = new Set([
  "front_headrest_1", "front_headrest_2",
  "front_top_body_part_1", "front_top_body_part_2",
  "front_bottom_part_1", "front_bottom_part_2",
  "front_middle_headrest", "front_middle_top_body_part", "front_middle_bottom_part",
  "front_armrest_1", "front_armrest_2",
  "rear_headrest_1", "rear_headrest_2",
  "rear_top_body_part_1", "rear_top_body_part_2",
  "rear_bottom_part_1", "rear_bottom_part_2",
  "rear_middle_headrest", "rear_middle_top_body_part", "rear_middle_bottom_part",
  "rear_console",
  "rear_backrest_storage_1", "rear_backrest_storage_2",
  "rear_armrest_1", "rear_armrest_2",
  "rear_subpart_1", "rear_subpart_2",
  "third_row_headrest_1", "third_row_headrest_2",
  "third_row_top_body_part_1", "third_row_top_body_part_2",
  "third_row_bottom_part_1", "third_row_bottom_part_2",
  "third_row_middle_headrest", "third_row_middle_top_body_part", "third_row_middle_bottom_part",
  "third_row_console",
  "third_row_backrest_storage_1", "third_row_backrest_storage_2",
  "third_row_armrest_1", "third_row_armrest_2",
  "third_row_subpart_1", "third_row_subpart_2",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fNumber = searchParams.get("f_number");
  const column = searchParams.get("column");

  if (!fNumber || !column || !ALLOWED_COLUMNS.has(column)) {
    return NextResponse.json({ success: false, error: "Invalid params" }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "${column}" FROM shipcore.fc_seat_covers_indv_part_skus WHERE f_number = $1 LIMIT 1`,
      fNumber
    );
    const partNumber = rows[0]?.[column] ?? null;
    return NextResponse.json({ success: true, partNumber: partNumber ? String(partNumber) : null });
  } catch (err) {
    console.error("[part-sku] error", err);
    return NextResponse.json({ success: false, error: "Lookup failed" }, { status: 500 });
  }
}
