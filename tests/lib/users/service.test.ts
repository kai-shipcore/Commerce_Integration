import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  listUsers: vi.fn(),
  countPermissionOverridesByUser: vi.fn(),
  findById: vi.fn(),
  countActiveAdmins: vi.fn(),
  updateRole: vi.fn(),
  updateActive: vi.fn(),
  updateName: vi.fn(),
  updateMenuVisibility: vi.fn(),
  getLoginHistory: vi.fn(),
  getActivityTimelineUser: vi.fn(),
  getActivityTimelineEvents: vi.fn(),
  getActivityTimelineLogins: vi.fn(),
  getActivityTimelineAuditEvents: vi.fn(),
  resolveLegacySkuLabels: vi.fn(),
  getActivitySummary: vi.fn(),
  getActivityTrend: vi.fn(),
  getActivityUsers: vi.fn(),
};

const getEffectivePermissionsMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/lib/users/repository", () => ({ UsersRepository: repositoryMock }));
vi.mock("@/lib/permissions", () => ({ getEffectivePermissions: getEffectivePermissionsMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { UsersService } = await import("@/lib/users/service");

const WHO = { userId: "actor-1", userName: "Actor", userEmail: "actor@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
  getEffectivePermissionsMock.mockResolvedValue({ "user-permissions": { read: true, edit: true, status: true } });
});

describe("UsersService.listUsers", () => {
  it("clamps page/limit to their documented bounds", async () => {
    repositoryMock.listUsers.mockResolvedValue({ total: 0, users: [] });
    repositoryMock.countPermissionOverridesByUser.mockResolvedValue(new Map());

    await UsersService.listUsers({
      pageParam: "0", limitParam: "1000", search: "", roleFilter: "", statusFilter: "",
      sortByParam: null, sortDirParam: null, loginFilter: "",
    });

    const call = repositoryMock.listUsers.mock.calls[0][0];
    expect(call.skip).toBe(0); // page clamped to 1 -> (1-1)*limit
    expect(call.take).toBe(100); // limit clamped to max 100
  });

  it("falls back to sortBy=role for an unrecognized sort field", async () => {
    repositoryMock.listUsers.mockResolvedValue({ total: 0, users: [] });
    repositoryMock.countPermissionOverridesByUser.mockResolvedValue(new Map());

    await UsersService.listUsers({
      pageParam: null, limitParam: null, search: "", roleFilter: "", statusFilter: "",
      sortByParam: "not-a-field", sortDirParam: null, loginFilter: "",
    });

    const call = repositoryMock.listUsers.mock.calls[0][0];
    expect(call.orderBy[0]).toEqual({ role: "asc" });
  });

  it("computes exceptionCount and merges effective menu visibility per user", async () => {
    repositoryMock.listUsers.mockResolvedValue({
      total: 1,
      users: [{
        id: "u1", name: "Bob", email: "b@x.com", role: "user", isActive: true,
        lastLoginAt: null, menuVisibility: [], accounts: [{ provider: "google" }],
        createdAt: new Date(), updatedAt: new Date(),
      }],
    });
    repositoryMock.countPermissionOverridesByUser.mockResolvedValue(new Map([["u1", 3]]));
    getEffectivePermissionsMock.mockResolvedValue({});

    const result = await UsersService.listUsers({
      pageParam: "1", limitParam: "10", search: "", roleFilter: "", statusFilter: "",
      sortByParam: null, sortDirParam: null, loginFilter: "",
    });

    expect(result.users[0]).toMatchObject({ id: "u1", exceptionCount: 3, hasGoogleAccount: true, authProviders: ["google"] });
  });
});

describe("UsersService.updateUserRole", () => {
  it("throws ValidationError on self-role-change", async () => {
    await expect(UsersService.updateUserRole("u1", "u1", "admin", WHO, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.updateRole).not.toHaveBeenCalled();
  });

  it("does not pre-check target existence (matches original: Prisma throws if missing)", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    repositoryMock.updateRole.mockRejectedValue(new Error("Record to update not found"));

    await expect(UsersService.updateUserRole("actor-1", "missing", "admin", WHO, null)).rejects.toThrow("Record to update not found");
  });

  it("updates role and audit-logs the change", async () => {
    repositoryMock.findById.mockResolvedValue({ role: "user", email: "target@x.com", name: null });
    repositoryMock.updateRole.mockResolvedValue({ id: "u2", role: "admin", menuVisibility: [], updatedAt: new Date() });

    const result = await UsersService.updateUserRole("actor-1", "u2", "admin", WHO, "1.2.3.4");

    expect(result.role).toBe("admin");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "role_change", before: { role: "user" }, after: { role: "admin" }, ip: "1.2.3.4",
    }));
  });
});

describe("UsersService.updateUserStatus", () => {
  it("throws ValidationError on self-status-change", async () => {
    await expect(UsersService.updateUserStatus("u1", "u1", WHO, null)).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when the target doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(UsersService.updateUserStatus("actor-1", "missing", WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("blocks deactivating the last active admin", async () => {
    repositoryMock.findById.mockResolvedValue({ isActive: true, role: "admin", email: "a@x.com", name: null });
    repositoryMock.countActiveAdmins.mockResolvedValue(1);

    await expect(UsersService.updateUserStatus("actor-1", "target", WHO, null)).rejects.toThrow(
      "Cannot deactivate the last active admin account",
    );
    expect(repositoryMock.updateActive).not.toHaveBeenCalled();
  });

  it("allows deactivating an admin when others remain active", async () => {
    repositoryMock.findById.mockResolvedValue({ isActive: true, role: "admin", email: "a@x.com", name: null });
    repositoryMock.countActiveAdmins.mockResolvedValue(2);
    repositoryMock.updateActive.mockResolvedValue({ id: "target", isActive: false, updatedAt: new Date() });

    const result = await UsersService.updateUserStatus("actor-1", "target", WHO, null);
    expect(result.isActive).toBe(false);
  });

  it("does not check active-admin-count when reactivating", async () => {
    repositoryMock.findById.mockResolvedValue({ isActive: false, role: "admin", email: "a@x.com", name: null });
    repositoryMock.updateActive.mockResolvedValue({ id: "target", isActive: true, updatedAt: new Date() });

    await UsersService.updateUserStatus("actor-1", "target", WHO, null);
    expect(repositoryMock.countActiveAdmins).not.toHaveBeenCalled();
  });
});

describe("UsersService.updateUserName", () => {
  it("throws NotFoundError when the target doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(UsersService.updateUserName("missing", "New Name", WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("updates and audit-logs", async () => {
    repositoryMock.findById.mockResolvedValue({ name: "Old", email: "t@x.com" });
    repositoryMock.updateName.mockResolvedValue({ id: "t1", name: "New", updatedAt: new Date() });

    const result = await UsersService.updateUserName("t1", "New", WHO, null);
    expect(result.name).toBe("New");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ before: { name: "Old" }, after: { name: "New" } }));
  });
});

describe("UsersService.updateUserMenu", () => {
  it("throws NotFoundError when the target doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(UsersService.updateUserMenu("missing", ["a"], WHO, null)).rejects.toThrow(NotFoundError);
  });

  it("updates menu visibility and audit-logs", async () => {
    repositoryMock.findById.mockResolvedValue({ id: "t1", role: "user", email: "t@x.com", name: null });
    repositoryMock.updateMenuVisibility.mockResolvedValue({ id: "t1", menuVisibility: ["a"], updatedAt: new Date() });
    getEffectivePermissionsMock.mockResolvedValue({});

    const result = await UsersService.updateUserMenu("t1", ["a"], WHO, null);
    expect(result.id).toBe("t1");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ entityType: "user_menu", action: "update" }));
  });
});

describe("UsersService.getActivityTimeline", () => {
  it("throws NotFoundError when the user doesn't exist", async () => {
    repositoryMock.getActivityTimelineUser.mockResolvedValue(null);
    repositoryMock.getActivityTimelineEvents.mockResolvedValue([]);
    repositoryMock.getActivityTimelineLogins.mockResolvedValue([]);
    repositoryMock.getActivityTimelineAuditEvents.mockResolvedValue([]);

    await expect(UsersService.getActivityTimeline("missing", "2026-01-01")).rejects.toThrow(NotFoundError);
  });

  it("falls back to today's activity date for an invalid date param", async () => {
    repositoryMock.getActivityTimelineUser.mockResolvedValue({ id: "u1", name: "A", email: "a@x.com", role: "user" });
    repositoryMock.getActivityTimelineEvents.mockResolvedValue([]);
    repositoryMock.getActivityTimelineLogins.mockResolvedValue([]);
    repositoryMock.getActivityTimelineAuditEvents.mockResolvedValue([]);

    const result = await UsersService.getActivityTimeline("u1", "not-a-date");
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("merges and sorts events/logins/audit rows by occurredAt", async () => {
    repositoryMock.getActivityTimelineUser.mockResolvedValue({ id: "u1", name: "A", email: "a@x.com", role: "user" });
    repositoryMock.getActivityTimelineEvents.mockResolvedValue([
      { id: "1", occurred_at: new Date("2026-01-01T10:00:00Z"), event_type: "button_click", path: "/x", label: "Click", target: null, ip: null },
    ]);
    repositoryMock.getActivityTimelineLogins.mockResolvedValue([
      { id: "1", occurred_at: new Date("2026-01-01T08:00:00Z"), ip: "1.1.1.1", user_agent: "UA" },
    ]);
    repositoryMock.getActivityTimelineAuditEvents.mockResolvedValue([
      { id: "a:1", entity_type: "factory", entity_id: "5", entity_label: "F1", action: "create", before: null, after: null, note: null, ip: null, created_at: new Date("2026-01-01T09:00:00Z") },
    ]);

    const result = await UsersService.getActivityTimeline("u1", "2026-01-01");
    expect(result.events.map((e) => e.source)).toEqual(["login", "audit", "activity"]);
  });
});

describe("UsersService.getUserActivitySummary", () => {
  it("falls back to 30 days for an unsupported value", async () => {
    repositoryMock.getActivitySummary.mockResolvedValue({ today_active: "0", week_active: "0", month_active: "0" });
    repositoryMock.getActivityTrend.mockResolvedValue([]);
    repositoryMock.getActivityUsers.mockResolvedValue([]);

    const result = await UsersService.getUserActivitySummary("14");
    expect(result.periodDays).toBe(30);
  });

  it("accepts 7/90 as valid day windows", async () => {
    repositoryMock.getActivitySummary.mockResolvedValue({ today_active: "0", week_active: "0", month_active: "0" });
    repositoryMock.getActivityTrend.mockResolvedValue([]);
    repositoryMock.getActivityUsers.mockResolvedValue([]);

    const result = await UsersService.getUserActivitySummary("7");
    expect(result.periodDays).toBe(7);
  });
});
