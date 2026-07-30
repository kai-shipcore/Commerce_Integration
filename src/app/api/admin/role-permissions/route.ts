// Code Guide: Manage role-level permission defaults.
// GET  → returns all roles' permission matrices (cache-first, TTL 10 min)
// PUT  → saves one role's full permission matrix to DB, then invalidates cache
// Controller layer only: delegates to PermissionAdminService. Data access
// lives in src/lib/users/permission-admin-repository.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { PermissionAdminService } from "@/lib/users/permission-admin-service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

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

export async function GET() {
  const denied = await requireUserPermission("read");
  if (denied) return denied;

  try {
    const data = await PermissionAdminService.getRolePermissionMatrix();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest) {
  const [denied, session] = await Promise.all([requireUserPermission("edit"), auth()]);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { role, permissions } = body as { role?: unknown; permissions?: unknown };

  try {
    await PermissionAdminService.updateRolePermissionMatrix(
      role,
      permissions,
      { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
      getIp(req.headers),
    );
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
