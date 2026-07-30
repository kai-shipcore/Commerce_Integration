import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/audit-log/repository", () => ({ AuditLogRepository: { query: queryMock } }));

const { AuditLogService } = await import("@/lib/audit-log/service");

const BASE_QUERY = {
  user: "", entity: "", entityId: "", entityType: "", action: "",
  startDate: "", endDate: "", exportAll: false, pageParam: null, limitParam: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogService.listAuditLogs pagination", () => {
  it("defaults page=1 and limit=20 when params are missing", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await AuditLogService.listAuditLogs(BASE_QUERY);
    expect(queryMock).toHaveBeenCalledWith(expect.anything(), 20, 0);
  });

  it("computes offset from page/limit", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await AuditLogService.listAuditLogs({ ...BASE_QUERY, pageParam: "3", limitParam: "10" });
    expect(queryMock).toHaveBeenCalledWith(expect.anything(), 10, 20);
  });

  it("falls back to the default when limit exceeds the max", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await AuditLogService.listAuditLogs({ ...BASE_QUERY, limitParam: "500" });
    expect(queryMock).toHaveBeenCalledWith(expect.anything(), 100, 0);
  });

  it("uses limit=5000 for export regardless of limitParam", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await AuditLogService.listAuditLogs({ ...BASE_QUERY, exportAll: true, limitParam: "20" });
    expect(queryMock).toHaveBeenCalledWith(expect.anything(), 5000, 0);
  });

  it("computes totalPages from total/limit, minimum 1", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    const result = await AuditLogService.listAuditLogs(BASE_QUERY);
    expect(result.pagination.totalPages).toBe(1);

    queryMock.mockResolvedValue({ rows: [], total: 45 });
    const result2 = await AuditLogService.listAuditLogs({ ...BASE_QUERY, limitParam: "20" });
    expect(result2.pagination.totalPages).toBe(3);
  });
});

describe("AuditLogService.listAuditLogs allow-listed filters", () => {
  it("passes through a known entityType and action", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await AuditLogService.listAuditLogs({ ...BASE_QUERY, entityType: "factory", action: "create" });
    const [filter] = queryMock.mock.calls[0];
    expect(filter.entityType).toBe("factory");
    expect(filter.action).toBe("create");
  });

  it("silently drops an unknown entityType/action instead of erroring", async () => {
    queryMock.mockResolvedValue({ rows: [], total: 0 });
    await expect(
      AuditLogService.listAuditLogs({ ...BASE_QUERY, entityType: "bogus", action: "not-a-real-action" }),
    ).resolves.toBeDefined();
    const [filter] = queryMock.mock.calls[0];
    expect(filter.entityType).toBe("");
    expect(filter.action).toBe("");
  });
});

describe("AuditLogService.listAuditLogs error handling", () => {
  it("wraps repository errors in a friendly message", async () => {
    queryMock.mockRejectedValue(new Error("connection reset"));
    await expect(AuditLogService.listAuditLogs(BASE_QUERY)).rejects.toThrow("Failed to fetch audit logs");
  });
});
