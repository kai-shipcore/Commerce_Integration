// Code Guide: GET/PUT /api/forecast/config
// Manages global V1 forecast parameters stored in fc_user_preferences with user_id='global'.
// GET  — returns current seasonal factors and window weights (defaults if not yet set).
// PUT  — admin-only; upserts one or both config values.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

const GLOBAL_USER_ID = "global";

const SEASONAL_FACTORS_KEY = "planning-dashboard-seasonal-factors";
const WINDOW_WEIGHTS_KEY   = "planning-dashboard-sales-window-weights";

const DEFAULT_SEASONAL_FACTORS = {
  jan: 0.75, feb: 0.80, mar: 0.90, apr: 0.95,
  may: 1.00, jun: 1.00, jul: 1.00, aug: 1.00, sep: 1.00,
  oct: 1.10, nov: 1.25, dec: 1.30,
};

const DEFAULT_WINDOW_WEIGHTS = [
  { days: 90, weight: 0.10, order_type: "sales" },
  { days: 60, weight: 0.15, order_type: "sales" },
  { days: 30, weight: 0.30, order_type: "sales" },
  { days: 15, weight: 0.20, order_type: "sales" },
  { days:  7, weight: 0.15, order_type: "sales" },
  { days: 30, weight: 0.10, order_type: "preorder" },
];

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
      [GLOBAL_USER_ID],
    );

    const map: Record<string, unknown> = {};
    for (const row of result.rows) map[row.key] = row.value;

    return NextResponse.json({
      success: true,
      data: {
        seasonal_factors: map[SEASONAL_FACTORS_KEY] ?? DEFAULT_SEASONAL_FACTORS,
        window_weights:   map[WINDOW_WEIGHTS_KEY]   ?? DEFAULT_WINDOW_WEIGHTS,
      },
    });
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
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as { seasonal_factors?: unknown; window_weights?: unknown };
    const entries: [string, unknown][] = [];
    if (body.seasonal_factors !== undefined) entries.push([SEASONAL_FACTORS_KEY, body.seasonal_factors]);
    if (body.window_weights   !== undefined) entries.push([WINDOW_WEIGHTS_KEY,   body.window_weights]);
    if (entries.length === 0) return NextResponse.json({ success: true });

    const db = getPrimaryPool();
    const placeholders = entries.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}::jsonb, now())`).join(", ");
    const params: unknown[] = [GLOBAL_USER_ID];
    for (const [key, value] of entries) params.push(key, JSON.stringify(value));

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
