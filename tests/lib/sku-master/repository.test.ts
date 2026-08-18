import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const clientMock = { query: clientQueryMock, release: clientReleaseMock };
const poolConnectMock = vi.fn(async () => clientMock);
const primaryPoolMock = { query: poolQueryMock, connect: poolConnectMock };

const lookupClientQueryMock = vi.fn();
const lookupClientReleaseMock = vi.fn();
const lookupClientMock = { query: lookupClientQueryMock, release: lookupClientReleaseMock };
const lookupConnectMock = vi.fn(async () => lookupClientMock);
let lookupPoolValue: typeof lookupPoolConnectable | null = { connect: lookupConnectMock };
const lookupPoolConnectable = { connect: lookupConnectMock };

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => primaryPoolMock) }));
vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => lookupPoolValue) }));

const { SkuMasterRepository, inferProduct } = await import("@/lib/sku-master/repository");

beforeEach(() => {
  vi.clearAllMocks();
  lookupPoolValue = lookupPoolConnectable;
});

describe("inferProduct", () => {
  it("classifies SWC items", () => {
    expect(inferProduct("CA-SWC-1-2").productKey).toBe("swc");
  });

  it("classifies car covers", () => {
    expect(inferProduct("CC-CP-03-M-GR-1TO").productKey).toBe("cc");
    expect(inferProduct("C-SJ-GR-7").productKey).toBe("cc");
  });

  it("classifies seat covers", () => {
    expect(inferProduct("CA-SC-10-B-1TO").productKey).toBe("sc");
    expect(inferProduct("CL-SC-10-F-1TO").productKey).toBe("sc");
  });

  it("classifies floor mats", () => {
    expect(inferProduct("CA-FM-01").productKey).toBe("fm");
  });

  it("falls back to accessories for anything else", () => {
    expect(inferProduct("UNKNOWN-SKU").productKey).toBe("ac");
  });
});

describe("SkuMasterRepository.buildListFilters", () => {
  const base = {
    page: 1,
    limit: 50,
    offset: 0,
    search: "",
    productValues: [] as string[],
    status: "active" as const,
    salesType: "all" as const,
    typeFilter: "all" as const,
  };

  it("defaults to TRUE with no filters", () => {
    const { whereClause, params } = SkuMasterRepository.buildListFilters({ ...base, status: "all" });
    expect(whereClause).toBe("TRUE");
    expect(params).toEqual([]);
  });

  it("combines status, search, category, salesType, and type filters", () => {
    const { whereClause, params } = SkuMasterRepository.buildListFilters({
      ...base,
      search: "foo",
      productValues: ["cc", "unknown-key"],
      salesType: "Custom",
      typeFilter: "Hold",
    });

    expect(whereClause).toContain("p.status = $1");
    expect(whereClause).toContain("p.master_sku ILIKE $2");
    expect(whereClause).toContain("p.category_code = ANY($3");
    expect(whereClause).toContain("$4");
    expect(whereClause).toContain("$5");
    expect(params).toEqual(["active", "%foo%", ["CC"], "Custom", "Hold"]);
  });
});

describe("SkuMasterRepository.findBySku", () => {
  it("returns null when no row matches", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await SkuMasterRepository.findBySku("MISSING")).toBeNull();
  });

  it("returns the row when found", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    const result = await SkuMasterRepository.findBySku("SKU-1");
    expect(result).toEqual({ master_sku: "SKU-1" });
  });
});

describe("SkuMasterRepository.updateProduct", () => {
  it("returns false when no row was updated", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0 });
    const found = await SkuMasterRepository.updateProduct("SKU-1", {
      moq: null, orderMultiple: null, cbmPerUnit: null, caseQty: null, weightKg: null, status: null, salesStatus: undefined,
    });
    expect(found).toBe(false);
  });

  it("returns true when a row was updated", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1 });
    const found = await SkuMasterRepository.updateProduct("SKU-1", {
      moq: 5, orderMultiple: null, cbmPerUnit: null, caseQty: null, weightKg: null, status: null, salesStatus: undefined,
    });
    expect(found).toBe(true);
  });
});

describe("SkuMasterRepository.getDistinctMasterSkusFromInventory", () => {
  it("throws when the lookup pool is unavailable", async () => {
    lookupPoolValue = null;
    await expect(SkuMasterRepository.getDistinctMasterSkusFromInventory()).rejects.toThrow(
      "SUPABASE_LOOKUP_DATABASE_URL is not configured"
    );
  });

  it("normalizes and returns distinct master skus", async () => {
    lookupClientQueryMock.mockResolvedValue({ rowCount: 2, rows: [{ master_sku: "C-SJ-GR-7" }, { master_sku: "CA-SC-1" }] });

    const result = await SkuMasterRepository.getDistinctMasterSkusFromInventory();

    expect(result.sourceRowCount).toBe(2);
    // "C-SJ-GR-7" is remapped by normalizeMasterSku to "CC-CS-03-J-GR-1TO"
    expect(result.masterSkus).toContain("CC-CS-03-J-GR-1TO");
    expect(result.masterSkus).toContain("CA-SC-1");
    expect(lookupClientReleaseMock).toHaveBeenCalled();
  });
});

describe("SkuMasterRepository.upsertProductsFromSync", () => {
  it("commits and returns the upserted count on success", async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 3 });

    const result = await SkuMasterRepository.upsertProductsFromSync(["SKU-1", "SKU-2"]);

    expect(result.upserted).toBe(3);
    expect(clientQueryMock).toHaveBeenCalledWith("BEGIN");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("rolls back and rethrows on failure", async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("create temp table failed"));

    await expect(SkuMasterRepository.upsertProductsFromSync(["SKU-1"])).rejects.toThrow("create temp table failed");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});

describe("SkuMasterRepository.insertMissingProducts", () => {
  it("commits and returns the inserted count on success", async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 2 });

    const result = await SkuMasterRepository.insertMissingProducts(["SKU-1", "SKU-2"]);

    expect(result.inserted).toBe(2);
    expect(clientQueryMock).toHaveBeenCalledWith("BEGIN");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("only inserts rows that don't already exist (WHERE NOT EXISTS, not an upsert)", async () => {
    clientQueryMock.mockResolvedValue({ rowCount: 0 });

    await SkuMasterRepository.insertMissingProducts(["SKU-1"]);

    const insertCall = clientQueryMock.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO shipcore.fc_products"));
    expect(insertCall?.[0]).toContain("WHERE NOT EXISTS");
    expect(insertCall?.[0]).not.toContain("DO UPDATE SET");
  });

  it("rolls back and rethrows on failure", async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("create temp table failed"));

    await expect(SkuMasterRepository.insertMissingProducts(["SKU-1"])).rejects.toThrow("create temp table failed");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});

describe("SkuMasterRepository.applyExcelImport", () => {
  it("skips the CBM precision migration when scale is already sufficient", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("numeric_scale")) return { rows: [{ numeric_scale: 6 }] };
      if (sql.includes("UPDATE shipcore.fc_products")) return { rowCount: 1 };
      if (sql.includes("INSERT INTO shipcore.fc_products")) return { rowCount: 2 };
      return { rows: [] };
    });

    const result = await SkuMasterRepository.applyExcelImport([{ masterSku: "SKU-1", moq: 5 }]);

    expect(result).toEqual({ updated: 1, inserted: 2 });
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE"));
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
  });

  it("runs the CBM precision migration when scale is insufficient", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("numeric_scale")) return { rows: [{ numeric_scale: 2 }] };
      return { rows: [], rowCount: 0 };
    });

    await SkuMasterRepository.applyExcelImport([{ masterSku: "SKU-1" }]);

    expect(clientQueryMock).toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE"));
    expect(clientQueryMock).toHaveBeenCalledWith(expect.stringContaining("CREATE VIEW"));
  });
});

describe("SkuMasterRepository.deactivateProduct", () => {
  it("issues the soft-delete update", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1 });

    await SkuMasterRepository.deactivateProduct("SKU-1");

    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("status = 'inactive'"), ["SKU-1"]);
  });
});
