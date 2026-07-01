// Code Guide: PATCH and DELETE endpoints for a single seat cover parts row.
// PATCH  /api/production/seat-cover-parts/{id}?tab=front|rear|third
// DELETE /api/production/seat-cover-parts/{id}?tab=front|rear|third

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tab = (req.nextUrl.searchParams.get("tab") ?? "front") as Tab;

  if (!ALLOWED_TABS.includes(tab)) {
    return NextResponse.json({ success: false, error: "Invalid tab" }, { status: 400 });
  }

  const body = await req.json() as Record<string, unknown>;
  const pool = getPrimaryPool();

  // Build SET clause dynamically from columns present in body
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const col of ALL_COLUMNS) {
    if (col === "size") continue; // size is the unique key, don't update it
    if (col in body) {
      setClauses.push(`${col} = $${paramIndex}`);
      values.push(body[col] === "" ? null : body[col]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  try {
    await pool.query(
      `UPDATE ${TABLE[tab]} SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
      values
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[seat-cover-parts PATCH]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tab = (req.nextUrl.searchParams.get("tab") ?? "front") as Tab;

  if (!ALLOWED_TABS.includes(tab)) {
    return NextResponse.json({ success: false, error: "Invalid tab" }, { status: 400 });
  }

  try {
    const result = await getPrimaryPool().query(
      `DELETE FROM ${TABLE[tab]} WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[seat-cover-parts DELETE]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
