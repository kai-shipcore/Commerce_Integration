import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const {
  listPlatformIntegrations,
  listActivePlatformIntegrations,
  getPlatformIntegrationById,
  createPlatformIntegration,
  updatePlatformIntegration,
  deletePlatformIntegration,
} = await import("@/lib/integrations/repository");

const ROW = {
  id: "int-1",
  platform: "shopify",
  name: "Main Store",
  isActive: true,
  config: { shopDomain: "x.myshopify.com" },
  syncCursor: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  totalOrdersSynced: 5,
  totalRecordsSynced: 10,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPlatformIntegrations", () => {
  it("maps rows and converts Date fields to ISO strings", async () => {
    poolQueryMock.mockResolvedValue({ rows: [ROW] });

    const result = await listPlatformIntegrations();

    expect(result).toEqual([
      {
        ...ROW,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("ORDER BY \"createdAt\" DESC"));
  });
});

describe("listActivePlatformIntegrations", () => {
  it("filters on isActive = TRUE", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await listActivePlatformIntegrations();
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining('"isActive" = TRUE'));
  });
});

describe("getPlatformIntegrationById", () => {
  it("returns null when no row is found", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await getPlatformIntegrationById("missing")).toBeNull();
  });

  it("returns the mapped record when found", async () => {
    poolQueryMock.mockResolvedValue({ rows: [ROW] });
    const result = await getPlatformIntegrationById("int-1");
    expect(result?.id).toBe("int-1");
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), ["int-1"]);
  });
});

describe("createPlatformIntegration", () => {
  it("inserts with a generated id and JSON-encoded config", async () => {
    poolQueryMock.mockResolvedValue({ rows: [ROW] });

    await createPlatformIntegration({ platform: "shopify", name: "Main Store", config: { a: 1 } });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO");
    expect(params[1]).toBe("shopify");
    expect(params[2]).toBe("Main Store");
    expect(params[3]).toBe(true);
    expect(params[4]).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("updatePlatformIntegration", () => {
  it("returns null when the row does not exist", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await updatePlatformIntegration("missing", { name: "x" })).toBeNull();
  });

  it("builds a dynamic SET clause only for provided fields", async () => {
    poolQueryMock.mockResolvedValue({ rows: [ROW] });

    await updatePlatformIntegration("int-1", { isActive: false, incrementTotalOrdersSynced: 3 });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain('"isActive" = $2');
    expect(sql).toContain('"totalOrdersSynced" = COALESCE("totalOrdersSynced", 0) + $3');
    expect(sql).not.toContain("config = $");
    expect(params).toEqual(["int-1", false, 3]);
  });

  it("clears syncCursor with a literal NULL when explicitly set to null", async () => {
    poolQueryMock.mockResolvedValue({ rows: [ROW] });
    await updatePlatformIntegration("int-1", { syncCursor: null });
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain('"syncCursor" = NULL');
    expect(params).toEqual(["int-1"]);
  });
});

describe("deletePlatformIntegration", () => {
  it("returns true when a row was deleted", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "int-1" }] });
    expect(await deletePlatformIntegration("int-1")).toBe(true);
  });

  it("returns false when nothing matched", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await deletePlatformIntegration("missing")).toBe(false);
  });
});
