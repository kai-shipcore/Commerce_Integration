// Code Guide: Per-user permission overrides (exceptions to role defaults).
// GET    → list all overrides for the user (cache-first, TTL 10 min)
// POST   → add or update a single override, then invalidates user cache
// DELETE → remove a specific override, then invalidates user cache

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { CacheManager } from "@/lib/redis";
import { PERM_SECTIONS, PERM_ACTIONS } from "@/lib/permissions-config";

type Params = { params: Promise<{ userId: string }> };

const VALID_SECTIONS = new Set<string>(PERM_SECTIONS.map((s) => s.id));
const VALID_ACTIONS  = new Set<string>(PERM_ACTIONS.map((a) => a.id));
const CACHE_TTL = 600; // 10 minutes

function cacheKey(userId: string) {
  return `perm:user:${userId}`;
}

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
    type Override = { section: string; action: string; allowed: boolean };

    const cached = await CacheManager.get<Override[]>(cacheKey(userId));
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const result = await getPrimaryPool().query(
      `SELECT section, action, allowed
       FROM shipcore.fc_user_permission_overrides
       WHERE user_id = $1
       ORDER BY section, action`,
      [userId]
    );
    const data = result.rows as Override[];
    void CacheManager.set(cacheKey(userId), data, CACHE_TTL);
    return NextResponse.json({ success: true, data });
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
      `INSERT INTO shipcore.fc_user_permission_overrides (user_id, section, action, allowed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, section, action) DO UPDATE SET allowed = EXCLUDED.allowed`,
      [userId, section, action, allowed]
    );
    void CacheManager.delete(cacheKey(userId));
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
      `DELETE FROM shipcore.fc_user_permission_overrides
       WHERE user_id = $1 AND section = $2 AND action = $3`,
      [userId, section, action]
    );
    void CacheManager.delete(cacheKey(userId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[permission-overrides DELETE]", err);
    return NextResponse.json({ success: false, error: "Failed to remove override" }, { status: 500 });
  }
}
