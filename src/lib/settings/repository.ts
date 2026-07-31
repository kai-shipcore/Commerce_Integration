/**
 * Data access for the user's own settings: menu visibility, password change,
 * and profile edit. All reads/writes are scoped to fc_user via Prisma.
 */

import { prisma } from "@/lib/db/prisma";

export interface ProfileRow {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  createdAt: Date;
  passwordHash: string | null;
}

export const SettingsRepository = {
  async findMenuVisibility(userId: string): Promise<{ menuVisibility: unknown } | null> {
    return prisma.user.findUnique({ where: { id: userId }, select: { menuVisibility: true } });
  },

  async updateMenuVisibility(userId: string, visibleMenuIds: string[]): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { menuVisibility: visibleMenuIds } });
  },

  async findPasswordHash(userId: string): Promise<{ passwordHash: string | null } | null> {
    return prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  },

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },

  async findProfile(userId: string): Promise<ProfileRow | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true, role: true, createdAt: true, passwordHash: true },
    });
  },

  async findUserIdByEmail(email: string): Promise<{ id: string } | null> {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },

  async updateProfile(userId: string, data: { name: string; email: string }) {
    return prisma.user.update({
      where: { id: userId },
      data: { name: data.name, email: data.email },
      select: { id: true, name: true, email: true, image: true, role: true, createdAt: true },
    });
  },
};
