/**
 * Pure data access for the two permission-admin tables:
 *   - shipcore.fc_role_permissions          (per-role permission matrix)
 *   - shipcore.fc_user_permission_overrides (per-user exceptions to the role matrix)
 *
 * Both are read at runtime by src/lib/permissions.ts (canDo/getEffectivePermissions)
 * — this repository owns the write side plus the admin-screen read side.
 * Cache invalidation and business validation live in
 * src/lib/users/permission-admin-service.ts.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";
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

type RoleRow = { role: string; section: string; action: string; allowed: boolean };
export type OverrideRow = { section: string; action: string; allowed: boolean };

export const PermissionAdminRepository = {
  async loadRolePermissionMatrix(): Promise<Record<string, RolePermMatrix>> {
    const result = await getPrimaryPool().query<RoleRow>(
      `SELECT role, section, action, allowed
       FROM shipcore.fc_role_permissions
       ORDER BY role, section, action`,
    );

    const byRole = new Map<string, RoleRow[]>();
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
  },

  async replaceRolePermissions(role: string, permissions: RolePermMatrix): Promise<void> {
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
          const allowed = permissions[sec.id as PermSection]?.[act.id as PermAction] ?? false;
          insertRows.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          values.push(role, sec.id, act.id, Boolean(allowed));
        }
      }

      if (insertRows.length > 0) {
        await client.query(
          `INSERT INTO shipcore.fc_role_permissions (role, section, action, allowed) VALUES ${insertRows.join(",")}`,
          values,
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getUserOverrides(userId: string): Promise<OverrideRow[]> {
    const result = await getPrimaryPool().query<OverrideRow>(
      `SELECT section, action, allowed
       FROM shipcore.fc_user_permission_overrides
       WHERE user_id = $1
       ORDER BY section, action`,
      [userId],
    );
    return result.rows;
  },

  async getUserLabel(userId: string): Promise<string> {
    try {
      const row = await getPrimaryPool().query<{ name: string | null; email: string | null }>(
        `SELECT name, email FROM shipcore."User" WHERE id = $1 LIMIT 1`,
        [userId],
      );
      const u = row.rows[0];
      return u?.email ?? u?.name ?? userId;
    } catch {
      return userId;
    }
  },

  async upsertUserOverride(userId: string, section: string, action: string, allowed: boolean): Promise<void> {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_user_permission_overrides (user_id, section, action, allowed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, section, action) DO UPDATE SET allowed = EXCLUDED.allowed`,
      [userId, section, action, allowed],
    );
  },

  async deleteUserOverride(userId: string, section: string, action: string): Promise<void> {
    await getPrimaryPool().query(
      `DELETE FROM shipcore.fc_user_permission_overrides
       WHERE user_id = $1 AND section = $2 AND action = $3`,
      [userId, section, action],
    );
  },
};
