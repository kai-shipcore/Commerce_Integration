import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { PermissionAdminRepository } = await import("@/lib/users/permission-admin-repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PermissionAdminRepository.loadRolePermissionMatrix", () => {
  it("groups rows by role and blends with defaults for every managed role", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ role: "admin", section: "inventory", action: "read", allowed: false }],
    });

    const result = await PermissionAdminRepository.loadRolePermissionMatrix();

    expect(result.admin.inventory.read).toBe(false);
    expect(result.user).toBeDefined();
  });
});

describe("PermissionAdminRepository.replaceRolePermissions", () => {
  it("runs delete + bulk insert in a transaction and commits", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });

    await PermissionAdminRepository.replaceRolePermissions("admin", {} as never);

    expect(clientQueryMock).toHaveBeenCalledWith("BEGIN");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("rolls back and rethrows on failure", async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE
      .mockRejectedValueOnce(new Error("insert failed")); // INSERT

    await expect(PermissionAdminRepository.replaceRolePermissions("admin", {} as never)).rejects.toThrow("insert failed");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});

describe("PermissionAdminRepository.getUserLabel", () => {
  it("falls back to the userId when the query throws", async () => {
    poolQueryMock.mockRejectedValue(new Error("db down"));
    const label = await PermissionAdminRepository.getUserLabel("u1");
    expect(label).toBe("u1");
  });

  it("prefers email over name", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ name: "Bob", email: "bob@x.com" }] });
    const label = await PermissionAdminRepository.getUserLabel("u1");
    expect(label).toBe("bob@x.com");
  });
});
