import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { AvailableStockRepository, withTransaction } = await import("@/lib/available-stock/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withTransaction", () => {
  it("commits on success and rolls back + rethrows on failure", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    await expect(withTransaction(async () => "ok")).resolves.toBe("ok");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");

    clientQueryMock.mockClear();
    await expect(withTransaction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("AvailableStockRepository.listStock", () => {
  it("uses a static 0 allocation expression with no params when containerId is absent", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await AvailableStockRepository.listStock(null);
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("0::int AS allocated_to_container");
    expect(params).toEqual([]);
  });

  it("filters the allocation sum to the given containerId", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await AvailableStockRepository.listStock("42");
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("a.container_id = $1::bigint");
    expect(params).toEqual(["42"]);
  });

  it("ignores a non-numeric containerId (matches the original regex guard)", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await AvailableStockRepository.listStock("not-a-number");
    const [, params] = poolQueryMock.mock.calls[0];
    expect(params).toEqual([]);
  });

  it("maps rows to camelCase", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ id: "1", source_type: "remaining", reference_no: "REF-1", pl_no: null, master_sku: "SKU-1", total_qty: 10, cbm: 1.5, note: null, available_qty: 8, allocated_to_container: 2 }],
    });
    const rows = await AvailableStockRepository.listStock(null);
    expect(rows[0]).toEqual({
      id: "1", sourceType: "remaining", referenceNo: "REF-1", plNo: null, masterSku: "SKU-1",
      totalQty: 10, availableQty: 8, allocatedToContainer: 2, cbm: 1.5, note: null,
    });
  });
});

describe("AvailableStockRepository.insertStockIfNotExists", () => {
  it("returns the new id when inserted", async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "9" }] });
    const id = await AvailableStockRepository.insertStockIfNotExists(
      { sourceType: "remaining", referenceNo: "REF-1", plNo: null, masterSku: "SKU-1", totalQty: 5, cbm: 1, note: null },
      { query: clientQueryMock } as never,
    );
    expect(id).toBe("9");
  });

  it("returns null when the duplicate guard skipped the insert", async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const id = await AvailableStockRepository.insertStockIfNotExists(
      { sourceType: "remaining", referenceNo: "REF-1", plNo: null, masterSku: "SKU-1", totalQty: 5, cbm: 1, note: null },
      { query: clientQueryMock } as never,
    );
    expect(id).toBeNull();
  });
});

describe("AvailableStockRepository.getStocksForDeleteCheck", () => {
  it("locks and returns allocation counts for the given ids", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "1", allocated_qty: 0 }, { id: "2", allocated_qty: 3 }] });
    const rows = await AvailableStockRepository.getStocksForDeleteCheck(["1", "2"]);
    expect(rows).toEqual([{ id: "1", allocatedQty: 0 }, { id: "2", allocatedQty: 3 }]);
    expect(poolQueryMock.mock.calls[0][0]).toContain("FOR UPDATE OF s");
  });
});
