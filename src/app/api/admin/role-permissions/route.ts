// Code Guide: Manage role-level permission defaults.
// GET  → returns all roles' permission matrices (cache-first, TTL 10 min)
// PUT  → saves one role's full permission matrix to DB, then invalidates cache

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { CacheManager } from "@/lib/redis";
import { canDo } from "@/lib/permissions";
import {
  MANAGED_ROLES,
  PERM_SECTIONS,
  PERM_ACTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  type RolePermMatrix,
  type PermSection,
  type PermAction,
} from "@/lib/permissions-config";

const CACHE_KEY = "perm:roles:all:v2";
const CACHE_TTL = 600; // 10 minutes

type DbRow = { role: string; section: string; action: string; allowed: boolean };

async function requireUserPermission(action: "read" | "edit") {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canDo(
    session.user.id,
    (session.user.role as string) ?? "user",
    "user-permissions",
    action
  );

  return allowed
    ? null
    : NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
}

async function loadFromDb(): Promise<Record<string, RolePermMatrix>> {
  const result = await getPrimaryPool().query<DbRow>(
    `SELECT role, section, action, allowed
     FROM shipcore.fc_role_permissions
     ORDER BY role, section, action`
  );

  const byRole = new Map<string, DbRow[]>();
  for (const row of result.rows) {
    const rows = byRole.get(row.role) ?? [];
    rows.push(row);
    byRole.set(row.role, rows);
  }

  const data: Record<string, RolePermMatrix> = {};
  for (const role of MANAGED_ROLES) {
    data[role] = blendRolePermissions(DEFAULT_ROLE_PERMISSIONS[role], byRole.get(role) ?? []);
  }
  return data;
}

export async function GET() {
  const denied = await requireUserPermission("read");
  if (denied) return denied;

  try {
    const cached = await CacheManager.get<Record<string, RolePermMatrix>>(CACHE_KEY);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const data = await loadFromDb();
    void CacheManager.set(CACHE_KEY, data, CACHE_TTL);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[role-permissions GET]", err);
    return NextResponse.json({ success: false, error: "Failed to load permissions" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireUserPermission("edit");
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const { role, permissions } = body as { role?: unknown; permissions?: unknown };

  if (typeof role !== "string" || !(MANAGED_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ success: false, error: "Invalid role" }, { status: 400 });
  }
  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ success: false, error: "Invalid permissions" }, { status: 400 });
  }

  const perms = permissions as RolePermMatrix;
  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM shipcore.fc_role_permissions WHERE role = $1`, [role]);

    const insertRows: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const sec of PERM_SECTIONS) {
      for (const act of PERM_ACTIONS) {
        const allowed = perms[sec.id as PermSection]?.[act.id as PermAction] ?? false;
        insertRows.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        values.push(role, sec.id, act.id, Boolean(allowed));
      }
    }

    if (insertRows.length > 0) {
      await client.query(
        `INSERT INTO shipcore.fc_role_permissions (role, section, action, allowed) VALUES ${insertRows.join(",")}`,
        values
      );
    }

    await client.query("COMMIT");
    void CacheManager.delete(CACHE_KEY);
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[role-permissions PUT]", err);
    return NextResponse.json({ success: false, error: "Failed to save permissions" }, { status: 500 });
  } finally {
    client.release();
  }
}
