import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { PurchaseOrdersRepository, withTransaction } = await import("@/lib/purchase-orders/repository");

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

describe("PurchaseOrdersRepository.getNextPoNumberSeq", () => {
  it("returns the next sequence number as a plain number", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ next_seq: "7" }] });
    const seq = await PurchaseOrdersRepository.getNextPoNumberSeq();
    expect(seq).toBe(7);
  });
});

describe("PurchaseOrdersRepository.listPurchaseOrders", () => {
  it("adds no filter when search is empty", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await PurchaseOrdersRepository.listPurchaseOrders("");
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual([]);
  });

  it("builds an ILIKE filter across po_number/factory/destination/manager/sku when search is given", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await PurchaseOrdersRepository.listPurchaseOrders("acme");
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("po.po_number, '') ILIKE $1");
    expect(params).toEqual(["%acme%"]);
  });
});

describe("PurchaseOrdersRepository.findMissingSkus", () => {
  it("returns only skus not found in fc_products", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    const missing = await PurchaseOrdersRepository.findMissingSkus(["SKU-1", "SKU-2"], { query: clientQueryMock } as never);
    expect(missing).toEqual(["SKU-2"]);
  });
});

describe("PurchaseOrdersRepository.lockForUpdate / lockForDelete", () => {
  it("returns null when the row doesn't exist", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    expect(await PurchaseOrdersRepository.lockForUpdate("1", { query: clientQueryMock } as never)).toBeNull();
    expect(await PurchaseOrdersRepository.lockForDelete("1", { query: clientQueryMock } as never)).toBeNull();
  });
});
