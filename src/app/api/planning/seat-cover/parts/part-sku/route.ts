import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const SEAT_COVER_COLORS = new Set([
  "BKRD", "BKWH", "BE", "BK", "GR", "DG", "BR", "DB", "WR", "PK", "RD", "WH", "OR",
]);

function stripColorSuffix(size: string): string {
  const parts = size.split("-");
  if (parts.length > 1 && SEAT_COVER_COLORS.has(parts[parts.length - 1])) {
    return parts.slice(0, -1).join("-");
  }
  return size;
}

const TABLE_MAP: Record<string, string> = {
  F: "shipcore.fc_seat_cover_parts_front",
  B: "shipcore.fc_seat_cover_parts_rear",
  R: "shipcore.fc_seat_cover_parts_rear",
  E: "shipcore.fc_seat_cover_parts_third",
};

const ALLOWED_COLUMNS = new Set([
  "headrest", "headrest2",
  "top_body", "top_body2",
  "bottom", "bottom2",
  "middle_headrest", "middle_top_body", "middle_bottom",
  "armrest", "armrest2",
  "console",
  "backrest_storage", "backrest_storage2",
  "subpart", "subpart2",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const size = searchParams.get("size");
  const column = searchParams.get("column");

  if (!size || !column || !ALLOWED_COLUMNS.has(column)) {
    return NextResponse.json({ success: false, error: "Invalid params" }, { status: 400 });
  }

  const table = TABLE_MAP[size[0].toUpperCase()];
  if (!table) {
    return NextResponse.json({ success: false, error: "Invalid size prefix" }, { status: 400 });
  }

  try {
    const lookupSize = stripColorSuffix(size);
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "${column}" FROM ${table} WHERE size = $1 LIMIT 1`,
      lookupSize
    );
    const partNumber = rows[0]?.[column] ?? null;
    return NextResponse.json({ success: true, partNumber: partNumber ? String(partNumber) : null });
  } catch (err) {
    console.error("[part-sku] error", err);
    return NextResponse.json({ success: false, error: "Lookup failed" }, { status: 500 });
  }
}
