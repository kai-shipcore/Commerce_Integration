// Code Guide: Per-user permission overrides (exceptions to role defaults).
// GET    → list all overrides for the user
// POST   → add or update a single override
// DELETE → remove a specific override (body: { section, action })

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { PERM_SECTIONS, PERM_ACTIONS } from "@/lib/permissions-config";

type Params = { params: Promise<{ userId: string }> };

const VALID_SECTIONS = new Set<string>(PERM_SECTIONS.map((s) => s.id));
const VALID_ACTIONS  = new Set<string>(PERM_ACTIONS.map((a) => a.id));

function validateSectionAction(section: unknown, action: unknown): string | null {
  if (typeof section !== "string" || !VALID_SECTIONS.has(section)) return "Invalid section";
  if (typeof action  !== "string" || !VALID_ACTIONS.has(action))   return "Invalid action";
  return null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const session = await auth();
  if (!isAdminLikeRole(session?.user?.role as string)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  try {
    const result = await getPrimaryPool().query(
      `SELECT section, action, allowed
       FROM shipcore.user_permission_overrides
       WHERE user_id = $1
       ORDER BY section, action`,
      [userId]
    );
    return NextResponse.json({
      success: true,
      data: result.rows as { section: string; action: string; allowed: boolean }[],
    });
  } catch (err) {
    console.error("[permission-overrides GET]", err);
    return NextResponse.json({ success: false, error: "Failed to load overrides" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const session = await auth();
  if (!isAdminLikeRole(session?.user?.role as string)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { section, action, allowed } = body as Record<string, unknown>;

  const validErr = validateSectionAction(section, action);
  if (validErr) return NextResponse.json({ success: false, error: validErr }, { status: 400 });
  if (typeof allowed !== "boolean") {
    return NextResponse.json({ success: false, error: "allowed must be boolean" }, { status: 400 });
  }

  try {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.user_permission_overrides (user_id, section, action, allowed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, section, action) DO UPDATE SET allowed = EXCLUDED.allowed`,
      [userId, section, action, allowed]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[permission-overrides POST]", err);
    return NextResponse.json({ success: false, error: "Failed to save override" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const session = await auth();
  if (!isAdminLikeRole(session?.user?.role as string)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { section, action } = body as Record<string, unknown>;

  const validErr = validateSectionAction(section, action);
  if (validErr) return NextResponse.json({ success: false, error: validErr }, { status: 400 });

  try {
    await getPrimaryPool().query(
      `DELETE FROM shipcore.user_permission_overrides
       WHERE user_id = $1 AND section = $2 AND action = $3`,
      [userId, section, action]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[permission-overrides DELETE]", err);
    return NextResponse.json({ success: false, error: "Failed to remove override" }, { status: 500 });
  }
}
