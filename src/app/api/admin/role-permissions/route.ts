// Code Guide: Manage role-level permission defaults.
// GET  → returns all roles' permission matrices (DB rows merged over hardcoded defaults)
// PUT  → saves one role's full permission matrix to DB

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import {
  MANAGED_ROLES,
  PERM_SECTIONS,
  PERM_ACTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  type ManagedRole,
  type RolePermMatrix,
  type PermSection,
  type PermAction,
} from "@/lib/permissions-config";

type DbRow = { role: string; section: string; action: string; allowed: boolean };

export async function GET() {
  const session = await auth();
  if (!isAdminLikeRole(session?.user?.role as string)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  try {
    const result = await getPrimaryPool().query<DbRow>(
      `SELECT role, section, action, allowed
       FROM shipcore.role_permissions
       ORDER BY role, section, action`
    );

    const byRole = new Map<string, DbRow[]>();
    for (const row of result.rows) {
      if (!byRole.has(row.role)) byRole.set(row.role, []);
      byRole.get(row.role)!.push(row);
    }

    const data: Record<string, RolePermMatrix> = {};
    for (const role of MANAGED_ROLES) {
      const base = DEFAULT_ROLE_PERMISSIONS[role];
      const rows = byRole.get(role) ?? [];
      data[role] = blendRolePermissions(base, rows);
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[role-permissions GET]", err);
    return NextResponse.json({ success: false, error: "Failed to load permissions" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!isAdminLikeRole(session?.user?.role as string)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

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
    await client.query(
      `DELETE FROM shipcore.role_permissions WHERE role = $1`,
      [role]
    );

    const insertRows: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const sec of PERM_SECTIONS) {
      const secId = sec.id as PermSection;
      for (const act of PERM_ACTIONS) {
        const actId = act.id as PermAction;
        const allowed = perms[secId]?.[actId] ?? false;
        insertRows.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        values.push(role, secId, actId, Boolean(allowed));
      }
    }

    if (insertRows.length > 0) {
      await client.query(
        `INSERT INTO shipcore.role_permissions (role, section, action, allowed) VALUES ${insertRows.join(",")}`,
        values
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[role-permissions PUT]", err);
    return NextResponse.json({ success: false, error: "Failed to save permissions" }, { status: 500 });
  } finally {
    client.release();
  }
}
