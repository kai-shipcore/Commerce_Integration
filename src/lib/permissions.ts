// Server-side permission check utility.
// canDo() — core check, uses two parallel Redis lookups (cache-first, ~2ms on hit).
// guardPermission() — convenience wrapper that calls auth() internally.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { CacheManager } from "@/lib/redis";
import { getPrimaryPool } from "@/lib/db/primary-db";
import {
  MANAGED_ROLES,
  PERM_ACTIONS,
  PERM_SECTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  type ManagedRole,
  type PermSection,
  type PermAction,
  type RolePermMatrix,
} from "@/lib/permissions-config";

const ROLES_CACHE_KEY = "perm:roles:all";
const OVERRIDE_TTL = 600;

async function getRoleMatrix(role: ManagedRole): Promise<RolePermMatrix> {
  const allRoles = await CacheManager.get<Record<string, RolePermMatrix>>(ROLES_CACHE_KEY);
  if (allRoles?.[role]) return allRoles[role];

  const result = await getPrimaryPool().query(
    `SELECT section, action, allowed FROM shipcore.fc_role_permissions WHERE role = $1`,
    [role]
  );
  return blendRolePermissions(DEFAULT_ROLE_PERMISSIONS[role], result.rows);
}

async function getUserOverrides(userId: string) {
  const key = `perm:user:${userId}`;
  const cached = await CacheManager.get<Array<{ section: string; action: string; allowed: boolean }>>(key);
  if (cached) return cached;

  const result = await getPrimaryPool().query(
    `SELECT section, action, allowed FROM shipcore.fc_user_permission_overrides WHERE user_id = $1`,
    [userId]
  );
  void CacheManager.set(key, result.rows, OVERRIDE_TTL);
  return result.rows as Array<{ section: string; action: string; allowed: boolean }>;
}

export async function getEffectivePermissions(
  userId: string,
  role: string
): Promise<RolePermMatrix> {
  if (role === "dev") {
    const permissions = {} as RolePermMatrix;
    for (const sec of PERM_SECTIONS) {
      permissions[sec.id] = {} as RolePermMatrix[PermSection];
      for (const act of PERM_ACTIONS) {
        permissions[sec.id][act.id] = true;
      }
    }
    return permissions;
  }

  const managedRole: ManagedRole = (MANAGED_ROLES as readonly string[]).includes(role)
    ? (role as ManagedRole)
    : "user";

  const [matrix, overrides] = await Promise.all([
    getRoleMatrix(managedRole),
    getUserOverrides(userId),
  ]);

  const effective = JSON.parse(JSON.stringify(matrix)) as RolePermMatrix;
  for (const override of overrides) {
    const section = override.section as PermSection;
    const action = override.action as PermAction;
    if (effective[section] && action in effective[section]) {
      effective[section][action] = override.allowed;
    }
  }

  return effective;
}

// Core check: resolves role matrix + user overrides in parallel (both cache-first).
// On Redis hit: ~2ms (2 network calls). DB only on cache miss (once per 10 min).
// dev role always returns true.
export async function canDo(
  userId: string,
  role: string,
  section: PermSection,
  action: PermAction
): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId, role);
  return permissions[section]?.[action] ?? false;
}

// For routes that don't already have a session loaded.
// Returns 401/403 NextResponse if denied, null if allowed.
export async function guardPermission(
  section: PermSection,
  action: PermAction
): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canDo(
    session.user.id,
    (session.user.role as string) ?? "user",
    section,
    action
  );

  if (!allowed) {
    return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
  }

  return null;
}
