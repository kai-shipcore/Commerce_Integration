// Code Guide: GET + POST for seat cover parts (front/rear/third tables).
// GET  /api/production/seat-cover-parts?tab=front|rear|third
// POST /api/production/seat-cover-parts?tab=front|rear|third  — insert new row

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

const ALLOWED_TABS = ["front", "rear", "third"] as const;
type Tab = (typeof ALLOWED_TABS)[number];

const TABLE: Record<Tab, string> = {
  front: "shipcore.fc_seat_cover_parts_front",
  rear:  "shipcore.fc_seat_cover_parts_rear",
  third: "shipcore.fc_seat_cover_parts_third",
};

// All possible columns across all three tables (excluding id, created_at, updated_at)
const ALL_COLUMNS = [
  "size",
  "inventory",
  "fitting_photo",
  "confirmed",
  "blueprint",
  "manual",
  "ymm",
  "fitting_dp_detail",
  "added_date",
  "package",
  "headrest",
  "headrest_dp_detail",
  "headrest2",
  "top_body",
  "top_body_dp_detail",
  "top_body2",
  "bottom",
  "bottom_dp_detail",
  "bottom2",
  "middle_headrest",
  "middle_top_body",
  "middle_bottom",
  "console",
  "backrest_storage",
  "backrest_storage_dp_detail",
  "backrest_storage2",
  "armrest",
  "armrest_detail",
  "armrest2",
  "subpart",
  "subpart_dp_detail",
  "subpart2",
  "note",
] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const tab = (req.nextUrl.searchParams.get("tab") ?? "front") as Tab;
  if (!ALLOWED_TABS.includes(tab)) {
    return NextResponse.json({ success: false, error: "Invalid tab" }, { status: 400 });
  }

  try {
    const pool = getPrimaryPool();
    const result = await pool.query(`SELECT * FROM ${TABLE[tab]} ORDER BY size`);
    return NextResponse.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[seat-cover-parts GET]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const tab = (req.nextUrl.searchParams.get("tab") ?? "front") as Tab;
  if (!ALLOWED_TABS.includes(tab)) {
    return NextResponse.json({ success: false, error: "Invalid tab" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  if (!body["size"] || String(body["size"]).trim() === "") {
    return NextResponse.json({ success: false, error: "size is required" }, { status: 400 });
  }

  const pool = getPrimaryPool();
  const cols: string[] = [];
  const values: unknown[] = [];

  for (const col of ALL_COLUMNS) {
    if (col in body) {
      cols.push(col);
      values.push(body[col] === "" ? null : body[col]);
    }
  }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

  try {
    await pool.query(
      `INSERT INTO ${TABLE[tab]} (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[seat-cover-parts POST]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
