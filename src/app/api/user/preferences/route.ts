// Code Guide: GET/PUT /api/user/preferences
// Persists per-user UI settings (column visibility, colors, etc.) to the DB
// so settings survive across browsers and devices.
// GET  — returns all preference entries for the current user as { key: value } map
// PUT  — upserts one or more entries; body: { preferences: Record<string, unknown> }
// Controller layer only: delegates shaping/validation to UserPreferencesService.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { UserPreferencesService } from "@/lib/user-preferences/service";

function errorMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const data = await UserPreferencesService.getPreferences(session.user.id);
    return NextResponse.json({ success: true, data });
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

    const body = await request.json() as { preferences?: unknown };
    await UserPreferencesService.savePreferences(session.user.id, body.preferences);

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: errorMsg(e) }, { status: 500 });
  }
}
