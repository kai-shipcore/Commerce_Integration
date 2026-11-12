import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { FloorMatSetRepository } = await import("@/lib/sku-master/floor-mat-set-repository");

beforeEach(() => {
  vi.clearAllMocks();
});

const SET = {
  frontSku: "CA-FM-F",
  rearSku: "CA-FM-R",
  preOrder12: true,
  preOrder3: null,
  thirdRows: [{ sku: "CA-FM-3A", preOrder: false }],
  oldSetSkus: ["CA-FM-OLD"],
};

describe("FloorMatSetRepository.findBySkus", () => {
  it("skips the query for an empty list", async () => {
    expect(await FloorMatSetRepository.findBySkus([])).toEqual(new Map());
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("maps rows to sets, tolerating malformed third_rows", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        { master_sku: "M1", front_sku: "CA-FM-F", rear_sku: "CA-FM-R", preorder_12: true, preorder_3: null, third_rows: [{ sku: "CA-FM-3A", preOrder: false }], old_set_skus: ["CA-FM-OLD"] },
        { master_sku: "M2", front_sku: null, rear_sku: null, preorder_12: null, preorder_3: true, third_rows: [{ sku: "" }, "junk", { sku: "CA-FM-3B", preOrder: "yes" }], old_set_skus: null },
      ],
    });

    const result = await FloorMatSetRepository.findBySkus(["M1", "M2"]);

    expect(result.get("M1")).toEqual(SET);
    expect(result.get("M2")).toEqual({
      frontSku: null, rearSku: null, preOrder12: null, preOrder3: true,
      thirdRows: [{ sku: "CA-FM-3B", preOrder: null }],
      oldSetSkus: [],
    });
  });

  it("reads as empty while the table has not been migrated yet", async () => {
    poolQueryMock.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(await FloorMatSetRepository.findBySkus(["M1"])).toEqual(new Map());
  });

  it("rethrows any other database error", async () => {
    poolQueryMock.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "08006" }));
    await expect(FloorMatSetRepository.findBySkus(["M1"])).rejects.toThrow("connection lost");
  });
});

describe("FloorMatSetRepository.save", () => {
  it("upserts a set, serializing third rows as JSON", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });

    await FloorMatSetRepository.save("M1", SET, "Tester");

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO shipcore.fc_floor_mat_sets");
    expect(sql).toContain("ON CONFLICT (master_sku) DO UPDATE");
    expect(params).toEqual(["M1", "CA-FM-F", "CA-FM-R", true, null, JSON.stringify(SET.thirdRows), ["CA-FM-OLD"], "Tester"]);
  });

  it("deletes the row when the set is empty", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });

    await FloorMatSetRepository.save(
      "M1",
      { frontSku: null, rearSku: null, preOrder12: null, preOrder3: null, thirdRows: [], oldSetSkus: [] },
      "Tester"
    );

    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM shipcore.fc_floor_mat_sets"), ["M1"]);
  });

  it("uses the given executor so the import can write inside its transaction", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await FloorMatSetRepository.save("M1", SET, null, client as never);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("FloorMatSetRepository.findExistingProductSkus", () => {
  it("returns the SKUs that have a product row", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "CA-FM-F" }] });
    expect(await FloorMatSetRepository.findExistingProductSkus(["CA-FM-F", "CA-FM-X"])).toEqual(new Set(["CA-FM-F"]));
  });
});
