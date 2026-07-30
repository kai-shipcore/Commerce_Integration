import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionMock = vi.fn();
const userCountMock = vi.fn();
const userFindManyMock = vi.fn();
const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const loginLogFindManyMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
    user: { count: userCountMock, findMany: userFindManyMock, findUnique: userFindUniqueMock, update: userUpdateMock },
    userLoginLog: { findMany: loginLogFindManyMock },
  },
}));
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { UsersRepository } = await import("@/lib/users/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UsersRepository.listUsers", () => {
  it("runs count + findMany in one $transaction with the given filter", async () => {
    transactionMock.mockResolvedValue([2, [{ id: "u1" }, { id: "u2" }]]);

    const result = await UsersRepository.listUsers({ where: undefined, orderBy: [{ role: "asc" }], skip: 0, take: 10 });

    expect(result).toEqual({ total: 2, users: [{ id: "u1" }, { id: "u2" }] });
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});

describe("UsersRepository.countPermissionOverridesByUser", () => {
  it("short-circuits to an empty map for no user ids", async () => {
    const result = await UsersRepository.countPermissionOverridesByUser([]);
    expect(result.size).toBe(0);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("builds a userId -> count map", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ user_id: "u1", count: "3" }] });
    const result = await UsersRepository.countPermissionOverridesByUser(["u1"]);
    expect(result.get("u1")).toBe(3);
  });
});

describe("UsersRepository.countActiveAdmins", () => {
  it("filters to active admin/dev roles", async () => {
    userCountMock.mockResolvedValue(2);
    const count = await UsersRepository.countActiveAdmins();
    expect(count).toBe(2);
    expect(userCountMock).toHaveBeenCalledWith({ where: { isActive: true, role: { in: ["admin", "dev"] } } });
  });
});

describe("UsersRepository.getActivityTimelineAuditEvents", () => {
  it("scopes the 3-way audit union to one user and one LA calendar day", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await UsersRepository.getActivityTimelineAuditEvents("u1", "2026-01-01");
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("fc_container_audit_log");
    expect(sql).toContain("fc_invoice_audit_log");
    expect(sql).toContain("fc_audit_log");
    expect(sql).toContain("America/Los_Angeles");
    expect(params).toEqual(["u1", "2026-01-01"]);
  });
});

describe("UsersRepository.resolveLegacySkuLabels", () => {
  it("short-circuits to an empty map for no labels", async () => {
    const result = await UsersRepository.resolveLegacySkuLabels([]);
    expect(result.size).toBe(0);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});
