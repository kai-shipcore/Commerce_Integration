import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  findMenuVisibility: vi.fn(),
  updateMenuVisibility: vi.fn(),
  findPasswordHash: vi.fn(),
  updatePassword: vi.fn(),
  findProfile: vi.fn(),
  findUserIdByEmail: vi.fn(),
  updateProfile: vi.fn(),
};

const verifyPasswordMock = vi.fn();
const hashPasswordMock = vi.fn((p: string) => `hashed:${p}`);
const getEffectivePermissionsMock = vi.fn();
const isAdminLikeRoleMock = vi.fn();
const sanitizeVisibleMenuIdsMock = vi.fn();
const mergeVisibleMenuIdsWithPermissionsMock = vi.fn();
const getDefaultVisibleMenuIdsMock = vi.fn();

vi.mock("@/lib/settings/repository", () => ({ SettingsRepository: repositoryMock }));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: verifyPasswordMock, hashPassword: hashPasswordMock }));
vi.mock("@/lib/permissions", () => ({ getEffectivePermissions: getEffectivePermissionsMock }));
vi.mock("@/components/layout/navigation-config", () => ({
  isAdminLikeRole: isAdminLikeRoleMock,
  sanitizeVisibleMenuIds: sanitizeVisibleMenuIdsMock,
  mergeVisibleMenuIdsWithPermissions: mergeVisibleMenuIdsWithPermissionsMock,
  getDefaultVisibleMenuIds: getDefaultVisibleMenuIdsMock,
}));

const { SettingsService, IncorrectPasswordError } = await import("@/lib/settings/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsService.getMenuVisibility", () => {
  it("merges the user's saved menu with permissions and returns role defaults", async () => {
    repositoryMock.findMenuVisibility.mockResolvedValue({ menuVisibility: ["a"] });
    getEffectivePermissionsMock.mockResolvedValue({ x: { read: true } });
    mergeVisibleMenuIdsWithPermissionsMock.mockReturnValue(["a", "b"]);
    getDefaultVisibleMenuIdsMock.mockReturnValue(["a"]);

    const result = await SettingsService.getMenuVisibility("u1", "user");

    expect(mergeVisibleMenuIdsWithPermissionsMock).toHaveBeenCalledWith(["a"], "user", { x: { read: true } });
    expect(result).toEqual({ role: "user", visibleMenuIds: ["a", "b"], defaults: ["a"], permissions: { x: { read: true } } });
  });
});

describe("SettingsService.updateMenuVisibility", () => {
  it("throws ForbiddenError for a non-admin-like role", async () => {
    isAdminLikeRoleMock.mockReturnValue(false);
    await expect(SettingsService.updateMenuVisibility("u1", "user", ["a"])).rejects.toThrow(ForbiddenError);
    expect(repositoryMock.updateMenuVisibility).not.toHaveBeenCalled();
  });

  it("sanitizes and persists for an admin-like role", async () => {
    isAdminLikeRoleMock.mockReturnValue(true);
    sanitizeVisibleMenuIdsMock.mockReturnValue(["a"]);

    const result = await SettingsService.updateMenuVisibility("u1", "admin", ["a", "bogus"]);

    expect(repositoryMock.updateMenuVisibility).toHaveBeenCalledWith("u1", ["a"]);
    expect(result).toEqual({ visibleMenuIds: ["a"] });
  });
});

describe("SettingsService.changePassword", () => {
  it("throws ValidationError for an oauth-only account (no passwordHash)", async () => {
    repositoryMock.findPasswordHash.mockResolvedValue({ passwordHash: null });
    await expect(SettingsService.changePassword("u1", "current", "newpassword1")).rejects.toThrow(ValidationError);
  });

  it("throws IncorrectPasswordError when the current password doesn't match", async () => {
    repositoryMock.findPasswordHash.mockResolvedValue({ passwordHash: "hash" });
    verifyPasswordMock.mockReturnValue(false);
    await expect(SettingsService.changePassword("u1", "wrong", "newpassword1")).rejects.toThrow(IncorrectPasswordError);
    expect(repositoryMock.updatePassword).not.toHaveBeenCalled();
  });

  it("updates the password hash when the current password matches", async () => {
    repositoryMock.findPasswordHash.mockResolvedValue({ passwordHash: "hash" });
    verifyPasswordMock.mockReturnValue(true);

    await SettingsService.changePassword("u1", "current", "newpassword1");

    expect(repositoryMock.updatePassword).toHaveBeenCalledWith("u1", "hashed:newpassword1");
  });
});

describe("SettingsService.getProfile", () => {
  it("returns null when the user doesn't exist", async () => {
    repositoryMock.findProfile.mockResolvedValue(null);
    expect(await SettingsService.getProfile("u1")).toBeNull();
  });

  it("strips passwordHash and adds hasPassword", async () => {
    repositoryMock.findProfile.mockResolvedValue({ id: "u1", name: "A", email: "a@x.com", image: null, role: "user", createdAt: new Date(0), passwordHash: "hash" });
    const result = await SettingsService.getProfile("u1");
    expect(result?.hasPassword).toBe(true);
    expect(result?.passwordHash).toBeUndefined();
  });
});

describe("SettingsService.updateProfile", () => {
  it("throws ConflictError when the email belongs to a different user", async () => {
    repositoryMock.findUserIdByEmail.mockResolvedValue({ id: "other" });
    await expect(SettingsService.updateProfile("u1", { name: "A", email: "a@x.com" })).rejects.toThrow(ConflictError);
  });

  it("allows keeping your own email unchanged", async () => {
    repositoryMock.findUserIdByEmail.mockResolvedValue({ id: "u1" });
    repositoryMock.updateProfile.mockResolvedValue({ id: "u1", name: "A", email: "a@x.com" });

    const result = await SettingsService.updateProfile("u1", { name: "A", email: "a@x.com" });

    expect(result).toEqual({ id: "u1", name: "A", email: "a@x.com" });
  });
});
