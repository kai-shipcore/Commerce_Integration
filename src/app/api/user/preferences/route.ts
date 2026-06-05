// Code Guide: GET/PUT /api/user/preferences
// Persists per-user UI settings (column visibility, colors, etc.) to the DB
// so settings survive across browsers and devices.
// GET  — returns all preference entries for the current user as { key: value } map
// PUT  — upserts one or more entries; body: { preferences: Record<string, unknown> }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

function errorMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const db = getPrimaryPool();
    const result = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM shipcore.fc_user_preferences WHERE user_id = $1`,
      [session.user.id],
    );

    const preferences: Record<string, unknown> = {};
    for (const row of result.rows) {
      preferences[row.key] = row.value;
    }

    return NextResponse.json({ success: true, data: preferences });
  } catch (e) {
    return NextResponse.json({ success: false, error: errorMsg(e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as { preferences: Record<string, unknown> };
    if (!body.preferences || typeof body.preferences !== "object") {
      return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
    }

    const db = getPrimaryPool();
    const entries = Object.entries(body.preferences);
    if (entries.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Batch upsert all keys in a single query
    const placeholders = entries.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}::jsonb, now())`).join(", ");
    const params: unknown[] = [session.user.id];
    for (const [key, value] of entries) {
      params.push(key, JSON.stringify(value));
    }

    await db.query(
      `INSERT INTO shipcore.fc_user_preferences (user_id, key, value, updated_at)
       VALUES ${placeholders}
       ON CONFLICT (user_id, key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = now()`,
      params,
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: errorMsg(e) }, { status: 500 });
  }
}
