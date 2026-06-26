// Code Guide: Returns seat cover parts data for front/rear/third tables.
// GET /api/production/seat-cover-parts?tab=front|rear|third

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
    console.error("[seat-cover-parts]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
