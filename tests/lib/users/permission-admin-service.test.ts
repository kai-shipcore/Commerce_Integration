import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  loadRolePermissionMatrix: vi.fn(),
  replaceRolePermissions: vi.fn(),
  getUserOverrides: vi.fn(),
  getUserLabel: vi.fn(),
  upsertUserOverride: vi.fn(),
  deleteUserOverride: vi.fn(),
};

const cacheManagerMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const logAuditMock = vi.fn();

vi.mock("@/lib/users/permission-admin-repository", () => ({ PermissionAdminRepository: repositoryMock }));
vi.mock("@/lib/redis", () => ({ CacheManager: cacheManagerMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
// @/lib/permissions imports @/lib/auth (NextAuth) transitively; mock it so
// loading the real permissions.ts (needed for its exported cache-key
// constants) doesn't drag in next-auth's Node/Edge module resolution.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { PermissionAdminService } = await import("@/lib/users/permission-admin-service");
const { ROLES_CACHE_KEY, userOverridesCacheKey } = await import("@/lib/permissions");

const WHO = { userId: "actor-1", userName: "Actor", userEmail: "actor@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PermissionAdminService.getRolePermissionMatrix", () => {
  it("returns the cached matrix without querying on a hit", async () => {
    const cached = { admin: {} };
    cacheManagerMock.get.mockResolvedValue(cached);
    const result = await PermissionAdminService.getRolePermissionMatrix();
    expect(result).toBe(cached);
    expect(repositoryMock.loadRolePermissionMatrix).not.toHaveBeenCalled();
  });

  it("loads from the repository and caches on a miss", async () => {
    cacheManagerMock.get.mockResolvedValue(null);
    repositoryMock.loadRolePermissionMatrix.mockResolvedValue({ admin: {} });

    await PermissionAdminService.getRolePermissionMatrix();

    expect(cacheManagerMock.set).toHaveBeenCalledWith(ROLES_CACHE_KEY, { admin: {} }, 600);
  });

  it("wraps a repository failure in a friendly message", async () => {
    cacheManagerMock.get.mockResolvedValue(null);
    repositoryMock.loadRolePermissionMatrix.mockRejectedValue(new Error("db down"));
    await expect(PermissionAdminService.getRolePermissionMatrix()).rejects.toThrow("Failed to load permissions");
  });
});

describe("PermissionAdminService.updateRolePermissionMatrix", () => {
  it("throws ValidationError for an unmanaged role", async () => {
    await expect(
      PermissionAdminService.updateRolePermissionMatrix("not-a-role", {}, WHO, null),
    ).rejects.toThrow(ValidationError);
    expect(repositoryMock.replaceRolePermissions).not.toHaveBeenCalled();
  });

  it("throws ValidationError for non-object permissions", async () => {
    await expect(
      PermissionAdminService.updateRolePermissionMatrix("admin", null, WHO, null),
    ).rejects.toThrow(ValidationError);
  });

  it("replaces, invalidates the cache, and audit-logs on success", async () => {
    await PermissionAdminService.updateRolePermissionMatrix("admin", { inventory: { read: true } }, WHO, "1.2.3.4");

    expect(repositoryMock.replaceRolePermissions).toHaveBeenCalledWith("admin", { inventory: { read: true } });
    expect(cacheManagerMock.delete).toHaveBeenCalledWith(ROLES_CACHE_KEY);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "role_permission", action: "config_update", entityId: "admin", ip: "1.2.3.4",
    }));
  });
});

describe("PermissionAdminService.getUserOverrides", () => {
  it("caches under the shared userOverridesCacheKey convention", async () => {
    cacheManagerMock.get.mockResolvedValue(null);
    repositoryMock.getUserOverrides.mockResolvedValue([{ section: "inventory", action: "read", allowed: true }]);

    await PermissionAdminService.getUserOverrides("u1");

    expect(cacheManagerMock.get).toHaveBeenCalledWith(userOverridesCacheKey("u1"));
    expect(cacheManagerMock.set).toHaveBeenCalledWith(userOverridesCacheKey("u1"), expect.anything(), 600);
  });
});

describe("PermissionAdminService.setUserOverride", () => {
  it("throws ValidationError for an invalid section", async () => {
    await expect(PermissionAdminService.setUserOverride("u1", "bogus", "read", true, WHO, null)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError for an invalid action", async () => {
    await expect(PermissionAdminService.setUserOverride("u1", "inventory", "bogus", true, WHO, null)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when allowed isn't boolean", async () => {
    await expect(PermissionAdminService.setUserOverride("u1", "inventory", "read", "yes", WHO, null)).rejects.toThrow(
      "allowed must be boolean",
    );
  });

  it("upserts, invalidates the user cache, and audit-logs", async () => {
    repositoryMock.getUserLabel.mockResolvedValue("user@x.com");

    await PermissionAdminService.setUserOverride("u1", "inventory", "read", true, WHO, "1.2.3.4");

    expect(repositoryMock.upsertUserOverride).toHaveBeenCalledWith("u1", "inventory", "read", true);
    expect(cacheManagerMock.delete).toHaveBeenCalledWith(userOverridesCacheKey("u1"));
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "permission_grant" }));
  });
});

describe("PermissionAdminService.deleteUserOverride", () => {
  it("validates section/action before deleting", async () => {
    await expect(PermissionAdminService.deleteUserOverride("u1", "bogus", "read", WHO, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.deleteUserOverride).not.toHaveBeenCalled();
  });

  it("deletes, invalidates cache, and audit-logs", async () => {
    repositoryMock.getUserLabel.mockResolvedValue("user@x.com");

    await PermissionAdminService.deleteUserOverride("u1", "inventory", "read", WHO, null);

    expect(repositoryMock.deleteUserOverride).toHaveBeenCalledWith("u1", "inventory", "read");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "permission_revoke" }));
  });
});
