import { createHash, randomBytes } from "crypto";

const PASSWORD_RESET_PREFIX = "password-reset:";
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;

export function getPasswordResetIdentifier(email: string): string {
  return `${PASSWORD_RESET_PREFIX}${email.trim().toLowerCase()}`;
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getPasswordResetExpiry(): Date {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MS);
}
