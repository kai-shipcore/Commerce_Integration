// Code Guide: GET/PUT /api/forecast/config
// Manages global V1 forecast parameters stored in fc_user_preferences with user_id='global'.
// GET  — returns current seasonal factors and window weights (defaults if not yet set).
// PUT  — admin-only; upserts one or both config values.
// Controller layer only: delegates storage + admin gate to ForecastConfigService.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import { ForecastConfigService } from "@/lib/forecast-config/service";

function errorMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const data = await ForecastConfigService.getConfig();
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

    const body = await request.json() as { seasonal_factors?: unknown; window_weights?: unknown };
    await ForecastConfigService.updateConfig((session.user as { role?: string }).role, body);

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: errorMsg(e) }, { status: 500 });
  }
}
