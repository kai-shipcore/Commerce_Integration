/**
 * Business logic for the user's own settings: menu visibility (read for any
 * signed-in user, write restricted to admin-like roles — an existing
 * asymmetry, not a bug), password change (requires re-entering the current
 * password), and profile edit (email must stay unique).
 */

import { verifyPassword, hashPassword } from "@/lib/auth/password";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
  sanitizeVisibleMenuIds,
} from "@/components/layout/navigation-config";
import { getEffectivePermissions } from "@/lib/permissions";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { SettingsRepository } from "@/lib/settings/repository";

export class IncorrectPasswordError extends Error {}

export interface MenuVisibilityResult {
  role: string;
  visibleMenuIds: string[];
  defaults: string[];
  permissions: Record<string, Record<string, boolean>>;
}

export const SettingsService = {
  async getMenuVisibility(userId: string, role: string): Promise<MenuVisibilityResult> {
    const user = await SettingsRepository.findMenuVisibility(userId);
    const permissions = await getEffectivePermissions(userId, role);
    const visibleMenuIds = mergeVisibleMenuIdsWithPermissions(user?.menuVisibility, role, permissions);

    return {
      role,
      visibleMenuIds,
      defaults: getDefaultVisibleMenuIds(role),
      permissions,
    };
  },

  async updateMenuVisibility(userId: string, role: string, rawVisibleMenuIds: string[]): Promise<{ visibleMenuIds: string[] }> {
    if (!isAdminLikeRole(role)) {
      throw new ForbiddenError("Forbidden");
    }

    const visibleMenuIds = sanitizeVisibleMenuIds(rawVisibleMenuIds, role);
    await SettingsRepository.updateMenuVisibility(userId, visibleMenuIds);
    return { visibleMenuIds };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await SettingsRepository.findPasswordHash(userId);
    if (!user?.passwordHash) {
      throw new ValidationError("Password change is not available for this account type");
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new IncorrectPasswordError("Current password is incorrect");
    }

    await SettingsRepository.updatePassword(userId, hashPassword(newPassword));
  },

  async getProfile(userId: string) {
    const user = await SettingsRepository.findProfile(userId);
    if (!user) return null;
    return { ...user, hasPassword: !!user.passwordHash, passwordHash: undefined };
  },

  async updateProfile(userId: string, data: { name: string; email: string }) {
    const existingUser = await SettingsRepository.findUserIdByEmail(data.email);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictError("That email is already in use");
    }

    return SettingsRepository.updateProfile(userId, data);
  },
};
