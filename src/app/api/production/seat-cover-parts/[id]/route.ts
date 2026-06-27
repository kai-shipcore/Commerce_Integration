// Code Guide: PATCH endpoint for updating a single seat cover parts row.
// PATCH /api/production/seat-cover-parts/{id}?tab=front|rear|third

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
  "headrest_qty",
  "headrest2",
  "headrest2_dp_detail",
  "headrest2_qty",
  "top_body",
  "top_body_dp_detail",
  "top_body_qty",
  "top_body2",
  "top_body2_dp_detail",
  "top_body2_qty",
  "bottom",
  "bottom_dp_detail",
  "bottom_qty",
  "bottom2",
  "bottom2_dp_detail",
  "bottom2_qty",
  "middle_headrest",
  "middle_headrest_detail",
  "middle_headrest_qty",
  "middle_top_body",
  "middle_top_body_detail",
  "middle_top_body_qty",
  "middle_bottom",
  "middle_bottom_detail",
  "middle_bottom_qty",
  "console",
  "console_dp_detail",
  "console_qty",
  "backrest_storage",
  "backrest_storage_dp_detail",
  "backrest_storage_qty",
  "backrest_storage2",
  "backrest_storage2_dp_detail",
  "backrest_storage2_qty",
  "armrest",
  "armrest_detail",
  "armrest_qty",
  "armrest2",
  "armrest2_detail",
  "armrest2_qty",
  "subpart",
  "subpart_dp_detail",
  "subpart_qty",
  "subpart2",
  "subpart2_dp_detail",
  "subpart2_qty",
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
