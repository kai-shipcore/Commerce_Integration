// Code Guide: Per-user permission overrides (exceptions to role defaults).
// GET    → list all overrides for the user (cache-first, TTL 10 min)
// POST   → add or update a single override, then invalidates user cache
// DELETE → remove a specific override, then invalidates user cache
// Controller layer only: delegates to PermissionAdminService. Data access
// lives in src/lib/users/permission-admin-repository.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { PermissionAdminService } from "@/lib/users/permission-admin-service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

type Params = { params: Promise<{ userId: string }> };

async function requireUserPermission(action: "read" | "edit") {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canDo(
    session.user.id,
    (session.user.role as string) ?? "user",
    "user-permissions",
    action,
  );

  return allowed
    ? null
    : NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const denied = await requireUserPermission("read");
  if (denied) return denied;

  try {
    const data = await PermissionAdminService.getUserOverrides(userId);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const [denied, session] = await Promise.all([requireUserPermission("edit"), auth()]);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { section, action, allowed } = body as Record<string, unknown>;

  try {
    await PermissionAdminService.setUserOverride(
      userId,
      section,
      action,
      allowed,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { userId } = await params;
  const [denied, session] = await Promise.all([requireUserPermission("edit"), auth()]);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { section, action } = body as Record<string, unknown>;

  try {
    await PermissionAdminService.deleteUserOverride(
      userId,
      section,
      action,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
