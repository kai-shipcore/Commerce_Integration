/**
 * Data access for account lifecycle: registration, forgot/reset password.
 * All writes go through Prisma against fc_user / verificationtoken / Session.
 */

import { prisma } from "@/lib/db/prisma";

export interface PasswordResetLookupUser {
  email: string;
  passwordHash: string | null;
  accounts: { provider: string }[];
}

export const AuthAccountRepository = {
  async findUserForPasswordReset(email: string): Promise<PasswordResetLookupUser | null> {
    return prisma.user.findUnique({
      where: { email },
      select: {
        email: true,
        passwordHash: true,
        accounts: { select: { provider: true } },
      },
    });
  },

  async replaceVerificationToken(identifier: string, hashedToken: string, expires: Date): Promise<void> {
    await prisma.verificationToken.deleteMany({ where: { identifier } });
    await prisma.verificationToken.create({
      data: { identifier, token: hashedToken, expires },
    });
  },

  async findUserIdByEmail(email: string): Promise<{ id: string } | null> {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },

  async createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    menuVisibility: string[];
  }): Promise<{ id: string; name: string | null; email: string }> {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        role: "user",
        menuVisibility: data.menuVisibility,
      },
      select: { id: true, name: true, email: true },
    });
  },

  async findVerificationTokenByHashedToken(hashedToken: string) {
    return prisma.verificationToken.findUnique({ where: { token: hashedToken } });
  },

  async deleteVerificationTokenByHashedToken(hashedToken: string): Promise<void> {
    await prisma.verificationToken.delete({ where: { token: hashedToken } });
  },

  async completePasswordReset(email: string, passwordHash: string, identifier: string): Promise<void> {
    await prisma.$transaction([
      prisma.user.update({ where: { email }, data: { passwordHash } }),
      prisma.verificationToken.deleteMany({ where: { identifier } }),
      prisma.session.deleteMany({ where: { user: { email } } }),
    ]);
  },
};
