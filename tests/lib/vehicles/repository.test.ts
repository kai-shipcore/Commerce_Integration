import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const primaryConnectMock = vi.fn();
const lookupConnectMock = vi.fn();
let lookupPool: { connect: typeof lookupConnectMock } | null = { connect: lookupConnectMock };

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: primaryConnectMock })),
}));
vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => lookupPool) }));

const { VehiclesRepository } = await import("@/lib/vehicles/repository");

beforeEach(() => {
  vi.clearAllMocks();
  lookupPool = { connect: lookupConnectMock };
});

describe("VehiclesRepository.listVehicles", () => {
  it("orders by make, model, f_number", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await VehiclesRepository.listVehicles();
    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("ORDER BY make, model, f_number");
  });
});

describe("VehiclesRepository.insertVehicle / updateVehicle", () => {
  it("builds a parameterized INSERT from the given columns", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await VehiclesRepository.insertVehicle(["f_number", "make"], ["F1", "Toyota"]);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO shipcore.sc_product_vehicle (f_number, make) VALUES ($1, $2)");
    expect(params).toEqual(["F1", "Toyota"]);
  });

  it("builds a parameterized UPDATE from the given set clauses", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await VehiclesRepository.updateVehicle(5, ["make = $1"], ["Honda", 5]);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("UPDATE shipcore.sc_product_vehicle SET make = $1 WHERE id = $2");
    expect(params).toEqual(["Honda", 5]);
  });
});

describe("VehiclesRepository.syncFromLookup", () => {
  it("throws when the lookup pool is unavailable", async () => {
    lookupPool = null;
    await expect(VehiclesRepository.syncFromLookup()).rejects.toThrow(
      "Lookup DB (SUPABASE_LOOKUP_DATABASE_URL) is not configured",
    );
  });

  it("filters out rows missing f_number/make/model, commits, and returns counts", async () => {
    const lookupClientQuery = vi.fn().mockResolvedValue({
      rows: [
        { f_number: "F1", make: "Toyota", model: "Camry", updated_at: "2026-01-01" },
        { f_number: null, make: "Honda", model: "Civic", updated_at: "2026-01-01" },
      ],
    });
    lookupConnectMock.mockResolvedValue({ query: lookupClientQuery, release: vi.fn() });

    const primaryClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 2 });
    primaryConnectMock.mockResolvedValue({ query: primaryClientQuery, release: vi.fn() });

    const result = await VehiclesRepository.syncFromLookup();

    expect(result).toEqual({ upserted: 1, deleted: 2 });
    expect(primaryClientQuery).toHaveBeenCalledWith("BEGIN");
    expect(primaryClientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back and rethrows on failure", async () => {
    lookupConnectMock.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
    const primaryClientQuery = vi.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("boom")); // setval
    primaryConnectMock.mockResolvedValue({ query: primaryClientQuery, release: vi.fn() });

    await expect(VehiclesRepository.syncFromLookup()).rejects.toThrow("boom");
    expect(primaryClientQuery).toHaveBeenCalledWith("ROLLBACK");
  });
});
