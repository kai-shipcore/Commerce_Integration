import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  findUserForPasswordReset: vi.fn(),
  replaceVerificationToken: vi.fn(),
  findUserIdByEmail: vi.fn(),
  createUser: vi.fn(),
  findVerificationTokenByHashedToken: vi.fn(),
  deleteVerificationTokenByHashedToken: vi.fn(),
  completePasswordReset: vi.fn(),
};

const sendPasswordResetEmailMock = vi.fn();

vi.mock("@/lib/auth/repository", () => ({ AuthAccountRepository: repositoryMock }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: sendPasswordResetEmailMock }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: (p: string) => `hashed:${p}` }));
vi.mock("@/components/layout/navigation-config", () => ({ getDefaultVisibleMenuIds: () => ["home"] }));

const { AuthAccountService } = await import("@/lib/auth/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthAccountService.requestPasswordReset", () => {
  it("returns the generic success message for an unknown email without creating a token", async () => {
    repositoryMock.findUserForPasswordReset.mockResolvedValue(null);
    const result = await AuthAccountService.requestPasswordReset("nobody@example.com");
    expect(result).toEqual({ success: true, message: expect.any(String) });
    expect(repositoryMock.replaceVerificationToken).not.toHaveBeenCalled();
  });

  it("reports the oauth provider for an account with no password", async () => {
    repositoryMock.findUserForPasswordReset.mockResolvedValue({
      email: "a@example.com", passwordHash: null, accounts: [{ provider: "google" }],
    });
    const result = await AuthAccountService.requestPasswordReset("a@example.com");
    expect(result.accountType).toBe("oauth");
    expect(result.oauthProvider).toBe("google");
  });

  it("creates a reset token and sends an email for a password-based account", async () => {
    repositoryMock.findUserForPasswordReset.mockResolvedValue({
      email: "a@example.com", passwordHash: "hash", accounts: [],
    });
    sendPasswordResetEmailMock.mockResolvedValue({ delivered: true, fallbackUrl: "http://x/reset" });

    const result = await AuthAccountService.requestPasswordReset("a@example.com");

    expect(repositoryMock.replaceVerificationToken).toHaveBeenCalled();
    expect(result.emailDelivered).toBe(true);
    expect(result.resetUrl).toBe("http://x/reset");
  });
});

describe("AuthAccountService.register", () => {
  it("throws ConflictError when the email is already registered", async () => {
    repositoryMock.findUserIdByEmail.mockResolvedValue({ id: "existing" });
    await expect(
      AuthAccountService.register({ name: "A", email: "a@example.com", password: "password1" }),
    ).rejects.toThrow(ConflictError);
    expect(repositoryMock.createUser).not.toHaveBeenCalled();
  });

  it("creates the user with a hashed password and default menu visibility", async () => {
    repositoryMock.findUserIdByEmail.mockResolvedValue(null);
    repositoryMock.createUser.mockResolvedValue({ id: "1", name: "A", email: "a@example.com" });

    await AuthAccountService.register({ name: "A", email: "a@example.com", password: "password1" });

    expect(repositoryMock.createUser).toHaveBeenCalledWith({
      name: "A", email: "a@example.com", passwordHash: "hashed:password1", menuVisibility: ["home"],
    });
  });
});

describe("AuthAccountService.resetPassword", () => {
  it("throws ValidationError when the token doesn't exist", async () => {
    repositoryMock.findVerificationTokenByHashedToken.mockResolvedValue(null);
    await expect(AuthAccountService.resetPassword("token", "newpassword1")).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError and deletes the token when it's expired", async () => {
    repositoryMock.findVerificationTokenByHashedToken.mockResolvedValue({
      identifier: "password-reset:a@example.com", token: "hashed", expires: new Date(Date.now() - 1000),
    });
    await expect(AuthAccountService.resetPassword("token", "newpassword1")).rejects.toThrow(ValidationError);
    expect(repositoryMock.deleteVerificationTokenByHashedToken).toHaveBeenCalled();
  });

  it("completes the reset for a valid token", async () => {
    repositoryMock.findVerificationTokenByHashedToken.mockResolvedValue({
      identifier: "password-reset:a@example.com", token: "hashed", expires: new Date(Date.now() + 100000),
    });

    await AuthAccountService.resetPassword("token", "newpassword1");

    expect(repositoryMock.completePasswordReset).toHaveBeenCalledWith(
      "a@example.com", "hashed:newpassword1", "password-reset:a@example.com",
    );
  });
});
