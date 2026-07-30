import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { AuditLogRepository } = await import("@/lib/audit-log/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogRepository.query", () => {
  it("runs count and data queries with no filters when the filter is empty", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await AuditLogRepository.query(
      { user: "", entity: "", entityId: "", entityType: "", action: "", startDate: "", endDate: "" },
      20, 0,
    );

    expect(result).toEqual({ rows: [], total: 0 });
    const [countSql, countParams] = poolQueryMock.mock.calls[0];
    expect(countSql).not.toContain("WHERE");
    expect(countParams).toEqual([]);

    const [dataSql, dataParams] = poolQueryMock.mock.calls[1];
    expect(dataSql).toContain("LIMIT $1 OFFSET $2");
    expect(dataParams).toEqual([20, 0]);
  });

  it("builds combined filters with correctly-numbered placeholders", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await AuditLogRepository.query(
      { user: "alice", entity: "", entityId: "", entityType: "factory", action: "create", startDate: "2026-01-01", endDate: "2026-01-31" },
      10, 5,
    );

    const [countSql, countParams] = poolQueryMock.mock.calls[0];
    expect(countSql).toContain("user_name, '') ILIKE $1");
    expect(countSql).toContain("entity_type = $2");
    expect(countSql).toContain("action = $3");
    expect(countSql).toContain("created_at >= $4::date");
    expect(countSql).toContain("created_at < ($5::date + INTERVAL '1 day')");
    expect(countParams).toEqual(["%alice%", "factory", "create", "2026-01-01", "2026-01-31"]);

    const [dataSql, dataParams] = poolQueryMock.mock.calls[1];
    expect(dataSql).toContain("LIMIT $6 OFFSET $7");
    expect(dataParams).toEqual(["%alice%", "factory", "create", "2026-01-01", "2026-01-31", 10, 5]);
  });

  it("maps rows to camelCase with ISO createdAt", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: "a:1", entity_type: "factory", entity_id: "5", entity_label: "Factory A",
          user_id: "u1", user_name: "Alice", user_email: "a@x.com",
          action: "create", before: null, after: { name: "A" }, note: null, ip: "1.2.3.4",
          created_at: new Date("2026-01-01T00:00:00.000Z"),
        }],
      });

    const result = await AuditLogRepository.query(
      { user: "", entity: "", entityId: "", entityType: "", action: "", startDate: "", endDate: "" },
      20, 0,
    );

    expect(result.rows[0]).toEqual({
      id: "a:1", entityType: "factory", entityId: "5", entityLabel: "Factory A",
      userId: "u1", userName: "Alice", userEmail: "a@x.com",
      action: "create", before: null, after: { name: "A" }, note: null, ip: "1.2.3.4",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
