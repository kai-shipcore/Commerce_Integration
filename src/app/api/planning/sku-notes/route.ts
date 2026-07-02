// Code Guide: GET/PUT shared Master SKU notes for the demand planning dashboard.
// Notes are global per SKU, not per-user preferences, so every user sees the same memo.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const result = await getPrimaryPool().query<{ master_sku: string; note: string }>(
      `SELECT master_sku, note
       FROM shipcore.fc_planning_sku_notes
       WHERE NULLIF(BTRIM(note), '') IS NOT NULL
       ORDER BY master_sku`,
    );

    const notes = Object.fromEntries(result.rows.map((row) => [row.master_sku, row.note]));
    return NextResponse.json({ success: true, data: notes });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json() as { sku?: unknown; note?: unknown };
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!sku) {
      return NextResponse.json({ success: false, error: "Invalid sku" }, { status: 400 });
    }
    if (note.length > 5000) {
      return NextResponse.json({ success: false, error: "Note is too long" }, { status: 400 });
    }

    const db = getPrimaryPool();
    if (!note) {
      await db.query(
        `DELETE FROM shipcore.fc_planning_sku_notes WHERE master_sku = $1`,
        [sku],
      );
      return NextResponse.json({ success: true, data: { sku, note: "" } });
    }

    await db.query(
      `INSERT INTO shipcore.fc_planning_sku_notes (master_sku, note, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (master_sku) DO UPDATE
         SET note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [sku, note, session?.user?.id ?? null],
    );

    return NextResponse.json({ success: true, data: { sku, note } });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
