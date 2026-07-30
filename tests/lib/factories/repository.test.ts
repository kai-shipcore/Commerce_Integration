import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { FactoriesRepository } = await import("@/lib/factories/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FactoriesRepository.listFactories", () => {
  it("queries with no filters when active is null and search is empty", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });

    await FactoriesRepository.listFactories({ active: null, search: "" });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual([]);
  });

  it("combines active and search filters", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });

    await FactoriesRepository.listFactories({ active: true, search: "acme" });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("is_active = $1");
    expect(sql).toContain("factory_name ILIKE $2");
    expect(params).toEqual([true, "%acme%"]);
  });
});

describe("FactoriesRepository.createFactory", () => {
  it("passes all fields through to the upsert query", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "1", factory_name: "Acme" }] });

    const row = await FactoriesRepository.createFactory({
      factoryCode: null,
      factoryName: "Acme",
      origin: "CN",
      contactName: "Jane",
      email: "jane@acme.com",
      phone: "123",
    });

    expect(row).toEqual({ id: "1", factory_name: "Acme" });
    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (factory_name)"),
      [null, "Acme", "CN", "Jane", "jane@acme.com", "123"]
    );
  });
});

describe("FactoriesRepository.findById", () => {
  it("returns null when not found", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await FactoriesRepository.findById("missing")).toBeNull();
  });
});

describe("FactoriesRepository.existsByNameExcludingId", () => {
  it("returns true when a duplicate row exists", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "2" }] });
    expect(await FactoriesRepository.existsByNameExcludingId("Acme", "1")).toBe(true);
  });

  it("returns false when no duplicate exists", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await FactoriesRepository.existsByNameExcludingId("Acme", "1")).toBe(false);
  });
});

describe("FactoriesRepository.setActive", () => {
  it("returns null when the factory doesn't exist", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await FactoriesRepository.setActive("missing", false)).toBeNull();
  });

  it("returns the updated row on success", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "1", is_active: false }] });
    const row = await FactoriesRepository.setActive("1", false);
    expect(row).toEqual({ id: "1", is_active: false });
  });
});
