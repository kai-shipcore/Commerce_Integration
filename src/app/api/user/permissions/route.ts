// Code Guide: GET /api/user/permissions
// Returns the current user's full effective permission matrix (role defaults merged with DB overrides).
// Uses 2 DB queries (role matrix + user overrides), both cache-first via Redis.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { CacheManager } from "@/lib/redis";
import {
  PERM_SECTIONS,
  PERM_ACTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  MANAGED_ROLES,
  type ManagedRole,
  type PermSection,
  type PermAction,
} from "@/lib/permissions-config";

const ROLES_CACHE_KEY = "perm:roles:all";
const OVERRIDE_TTL = 600;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = (session.user.role as string) ?? "user";

  const permissions: Record<string, Record<string, boolean>> = {};

  // dev role has all permissions — no DB needed
  if (role === "dev") {
    for (const sec of PERM_SECTIONS) {
      permissions[sec.id] = {};
      for (const act of PERM_ACTIONS) {
        permissions[sec.id][act.id] = true;
      }
    }
    return NextResponse.json({ success: true, data: permissions });
  }

  const managedRole: ManagedRole = (MANAGED_ROLES as readonly string[]).includes(role)
    ? (role as ManagedRole)
    : "user";

  // Fetch role matrix — cache-first (1 DB query on miss)
  const allRoles = await CacheManager.get<Record<string, ReturnType<typeof blendRolePermissions>>>(ROLES_CACHE_KEY);
  let matrix = allRoles?.[managedRole];
  if (!matrix) {
    const result = await getPrimaryPool().query<{ section: string; action: string; allowed: boolean }>(
      `SELECT section, action, allowed FROM shipcore.fc_role_permissions WHERE role = $1`,
      [managedRole]
    );
    matrix = blendRolePermissions(DEFAULT_ROLE_PERMISSIONS[managedRole], result.rows);
  }

  // Fetch user overrides — cache-first (1 DB query on miss)
  const overrideKey = `perm:user:${userId}`;
  let overrides = await CacheManager.get<Array<{ section: string; action: string; allowed: boolean }>>(overrideKey);
  if (!overrides) {
    const result = await getPrimaryPool().query<{ section: string; action: string; allowed: boolean }>(
      `SELECT section, action, allowed FROM shipcore.fc_user_permission_overrides WHERE user_id = $1`,
      [userId]
    );
    overrides = result.rows;
    void CacheManager.set(overrideKey, overrides, OVERRIDE_TTL);
  }

  for (const sec of PERM_SECTIONS) {
    permissions[sec.id] = {};
    for (const act of PERM_ACTIONS) {
      const override = overrides.find((o) => o.section === sec.id && o.action === act.id);
      permissions[sec.id][act.id] = override !== undefined
        ? override.allowed
        : (matrix[sec.id as PermSection]?.[act.id as PermAction] ?? false);
    }
  }

  return NextResponse.json({ success: true, data: permissions });
}
