/**
 * Business logic for account lifecycle: registration and the forgot/reset
 * password flow. requestPasswordReset always resolves successfully (even for
 * an unknown email or an OAuth-only account) to avoid leaking which emails
 * have accounts — the response shape just varies by case.
 */

import {
  createPasswordResetToken,
  getPasswordResetExpiry,
  getPasswordResetIdentifier,
  hashPasswordResetToken,
} from "@/lib/auth/password-reset";
import { hashPassword } from "@/lib/auth/password";
import { sendPasswordResetEmail } from "@/lib/email";
import { basePath, withBasePath } from "@/lib/api-path";
import { getDefaultVisibleMenuIds } from "@/components/layout/navigation-config";
import { ConflictError, ValidationError } from "@/lib/errors";
import { AuthAccountRepository } from "@/lib/auth/repository";

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, a password reset link has been generated.";

export interface ForgotPasswordResult {
  success: true;
  message: string;
  accountType?: "oauth";
  oauthProvider?: string | null;
  resetUrl?: string;
  emailDelivered?: boolean;
  expiresAt?: string;
}

export interface RegisteredUser {
  id: string;
  name: string | null;
  email: string;
}

export const AuthAccountService = {
  async requestPasswordReset(email: string): Promise<ForgotPasswordResult> {
    const user = await AuthAccountRepository.findUserForPasswordReset(email);

    if (!user) {
      return { success: true, message: GENERIC_SUCCESS_MESSAGE };
    }

    if (!user.passwordHash) {
      const oauthProvider = user.accounts[0]?.provider ?? null;
      return { success: true, message: GENERIC_SUCCESS_MESSAGE, accountType: "oauth", oauthProvider };
    }

    const rawToken = createPasswordResetToken();
    const hashedToken = hashPasswordResetToken(rawToken);
    const identifier = getPasswordResetIdentifier(user.email);
    const expires = getPasswordResetExpiry();
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";
    const resetPath = withBasePath(`/auth/reset-password?token=${encodeURIComponent(rawToken)}`);
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const resetUrl = normalizedBaseUrl.endsWith(basePath)
      ? `${normalizedBaseUrl}${resetPath.slice(basePath.length)}`
      : `${normalizedBaseUrl}${resetPath}`;

    await AuthAccountRepository.replaceVerificationToken(identifier, hashedToken, expires);

    const delivery = await sendPasswordResetEmail({
      email: user.email,
      resetUrl,
      expiresAt: expires,
    });

    return {
      success: true,
      message: GENERIC_SUCCESS_MESSAGE,
      resetUrl: delivery.fallbackUrl,
      emailDelivered: delivery.delivered,
      expiresAt: expires.toISOString(),
    };
  },

  async register(data: { name: string; email: string; password: string }): Promise<RegisteredUser> {
    const existingUser = await AuthAccountRepository.findUserIdByEmail(data.email);
    if (existingUser) {
      throw new ConflictError("An account with this email already exists");
    }

    return AuthAccountRepository.createUser({
      name: data.name,
      email: data.email,
      passwordHash: hashPassword(data.password),
      menuVisibility: getDefaultVisibleMenuIds("user"),
    });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const hashedToken = hashPasswordResetToken(token);
    const verificationToken = await AuthAccountRepository.findVerificationTokenByHashedToken(hashedToken);

    if (!verificationToken || verificationToken.expires < new Date()) {
      if (verificationToken) {
        await AuthAccountRepository.deleteVerificationTokenByHashedToken(hashedToken);
      }
      throw new ValidationError("This reset link is invalid or has expired");
    }

    const email = verificationToken.identifier.replace(/^password-reset:/, "");
    await AuthAccountRepository.completePasswordReset(email, hashPassword(password), verificationToken.identifier);
  },
};
