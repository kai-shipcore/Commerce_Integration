/**
 * Business logic for the Role Permissions and User Permission Exceptions
 * tabs: validation, cache-aside reads, and cache invalidation on write.
 * Shares its cache key/TTL convention with src/lib/permissions.ts (the
 * runtime read path used by canDo/guardPermission everywhere else) so a
 * write here can never leave that module serving a stale cached matrix.
 */

import { CacheManager } from "@/lib/redis";
import { ROLES_CACHE_KEY, PERMISSION_CACHE_TTL, userOverridesCacheKey } from "@/lib/permissions";
import { MANAGED_ROLES, PERM_SECTIONS, PERM_ACTIONS, type RolePermMatrix } from "@/lib/permissions-config";
import { logAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { PermissionAdminRepository, type OverrideRow } from "@/lib/users/permission-admin-repository";

const VALID_SECTIONS = new Set<string>(PERM_SECTIONS.map((s) => s.id));
const VALID_ACTIONS = new Set<string>(PERM_ACTIONS.map((a) => a.id));

function validateSectionAction(section: unknown, action: unknown): void {
  if (typeof section !== "string" || !VALID_SECTIONS.has(section)) throw new ValidationError("Invalid section");
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) throw new ValidationError("Invalid action");
}

export const PermissionAdminService = {
  async getRolePermissionMatrix(): Promise<Record<string, RolePermMatrix>> {
    try {
      const cached = await CacheManager.get<Record<string, RolePermMatrix>>(ROLES_CACHE_KEY);
      if (cached) return cached;

      const data = await PermissionAdminRepository.loadRolePermissionMatrix();
      void CacheManager.set(ROLES_CACHE_KEY, data, PERMISSION_CACHE_TTL);
      return data;
    } catch (error) {
      console.error("[role-permissions GET]", error);
      throw new Error("Failed to load permissions");
    }
  },

  async updateRolePermissionMatrix(
    role: unknown,
    permissions: unknown,
    who: { userId: string | null; userName: string | null; userEmail: string | null },
    ip: string | null,
  ): Promise<void> {
    if (typeof role !== "string" || !(MANAGED_ROLES as readonly string[]).includes(role)) {
      throw new ValidationError("Invalid role");
    }
    if (!permissions || typeof permissions !== "object") {
      throw new ValidationError("Invalid permissions");
    }

    try {
      await PermissionAdminRepository.replaceRolePermissions(role, permissions as RolePermMatrix);
      void CacheManager.delete(ROLES_CACHE_KEY);
    } catch (error) {
      console.error("[role-permissions PUT]", error);
      throw new Error("Failed to save permissions");
    }

    void logAudit({
      entityType: "role_permission",
      entityId: role,
      entityLabel: role,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "config_update",
      after: { role, permissions },
      ip,
    });
  },

  async getUserOverrides(userId: string): Promise<OverrideRow[]> {
    try {
      const cached = await CacheManager.get<OverrideRow[]>(userOverridesCacheKey(userId));
      if (cached) return cached;

      const data = await PermissionAdminRepository.getUserOverrides(userId);
      void CacheManager.set(userOverridesCacheKey(userId), data, PERMISSION_CACHE_TTL);
      return data;
    } catch (error) {
      console.error("[permission-overrides GET]", error);
      throw new Error("Failed to load overrides");
    }
  },

  async setUserOverride(
    userId: string,
    section: unknown,
    action: unknown,
    allowed: unknown,
    who: { userId: string | null; userName: string | null; userEmail: string | null },
    ip: string | null,
  ): Promise<void> {
    validateSectionAction(section, action);
    if (typeof allowed !== "boolean") throw new ValidationError("allowed must be boolean");

    try {
      await PermissionAdminRepository.upsertUserOverride(userId, section as string, action as string, allowed);
      void CacheManager.delete(userOverridesCacheKey(userId));
    } catch (error) {
      console.error("[permission-overrides POST]", error);
      throw new Error("Failed to save override");
    }

    const label = await PermissionAdminRepository.getUserLabel(userId);
    void logAudit({
      entityType: "user_permission",
      entityId: userId,
      entityLabel: label,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "permission_grant",
      after: { section, action, allowed },
      ip,
    });
  },

  async deleteUserOverride(
    userId: string,
    section: unknown,
    action: unknown,
    who: { userId: string | null; userName: string | null; userEmail: string | null },
    ip: string | null,
  ): Promise<void> {
    validateSectionAction(section, action);

    try {
      await PermissionAdminRepository.deleteUserOverride(userId, section as string, action as string);
      void CacheManager.delete(userOverridesCacheKey(userId));
    } catch (error) {
      console.error("[permission-overrides DELETE]", error);
      throw new Error("Failed to remove override");
    }

    const label = await PermissionAdminRepository.getUserLabel(userId);
    void logAudit({
      entityType: "user_permission",
      entityId: userId,
      entityLabel: label,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "permission_revoke",
      before: { section, action },
      ip,
    });
  },
};
