import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  list: vi.fn(),
  findExistingProductSkus: vi.fn(),
  getForUpdate: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  listColorRules: vi.fn(),
  getColorRuleForUpdate: vi.fn(),
  upsertColorRule: vi.fn(),
  deleteColorRule: vi.fn(),
  listActiveColorRuleSkus: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const invalidateCacheMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/lib/sku-min-sales/repository", () => ({ SkuMinSalesRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { SkuMinSalesService } = await import("@/lib/sku-min-sales/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuMinSalesService.save", () => {
  it("normalizes the SKU, rounds to 4 decimals, and upserts inside a transaction", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue(null);
    repositoryMock.upsert.mockResolvedValue(true);

    const result = await SkuMinSalesService.save([{ masterSku: " sku-1 ", minTotalAvgCurr: 2.123456, note: "  " }], WHO, "1.2.3.4");

    expect(result).toEqual({ inserted: 1, updated: 0, total: 1 });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsert).toHaveBeenCalledWith(
      { masterSku: "SKU-1", minTotalAvgCurr: 2.1235, referenceSku: null, referencePct: null, note: null },
      "Alice",
      expect.anything(),
    );
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sku_min_sales", entityId: "SKU-1", action: "create",
      after: { minTotalAvgCurr: 2.1235, referenceSku: null, referencePct: null },
    }));
  });

  it("rejects the whole batch when any SKU is missing from SKU Master", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    await expect(SkuMinSalesService.save(
      [{ masterSku: "SKU-1", minTotalAvgCurr: 1 }, { masterSku: "SKU-X", minTotalAvgCurr: 1 }],
      WHO, null,
    )).rejects.toThrow("SKU does not exist in SKU Master: SKU-X");
    expect(repositoryMock.upsert).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("rejects a negative minimum", async () => {
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", minTotalAvgCurr: -1 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps the last row when a sheet repeats a SKU, and logs an update with the previous value", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-1", minTotalAvgCurr: 1, referenceSku: null, referencePct: null, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    const result = await SkuMinSalesService.save(
      [{ masterSku: "SKU-1", minTotalAvgCurr: 2 }, { masterSku: "sku-1", minTotalAvgCurr: 4 }],
      WHO, null,
    );

    expect(result).toEqual({ inserted: 0, updated: 1, total: 1 });
    expect(repositoryMock.upsert).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsert.mock.calls[0][0]).toMatchObject({ minTotalAvgCurr: 4 });
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "update",
      before: { minTotalAvgCurr: 1, referenceSku: null, referencePct: null },
      after: { minTotalAvgCurr: 4, referenceSku: null, referencePct: null },
    }));
  });

  it("does not audit-log a save that changes nothing", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-1", minTotalAvgCurr: 2, referenceSku: null, referencePct: null, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    await SkuMinSalesService.save([{ masterSku: "SKU-1", minTotalAvgCurr: 2 }], WHO, null);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("SkuMinSalesService.save - reference SKU", () => {
  it("saves a reference without a fixed minimum", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-IB", "SKU-BE"]));
    repositoryMock.getForUpdate.mockResolvedValue(null);
    repositoryMock.upsert.mockResolvedValue(true);

    await SkuMinSalesService.save([{ masterSku: "sku-ib", referenceSku: " sku-be ", referencePct: 30 }], WHO, null);

    expect(repositoryMock.findExistingProductSkus).toHaveBeenCalledWith(["SKU-IB", "SKU-BE"], expect.anything());
    expect(repositoryMock.upsert).toHaveBeenCalledWith(
      { masterSku: "SKU-IB", minTotalAvgCurr: null, referenceSku: "SKU-BE", referencePct: 30, note: null },
      "Alice",
      expect.anything(),
    );
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "create", after: { minTotalAvgCurr: null, referenceSku: "SKU-BE", referencePct: 30 },
    }));
  });

  it("saves a fixed minimum and a reference together", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-IB", "SKU-BE"]));
    repositoryMock.getForUpdate.mockResolvedValue(null);
    repositoryMock.upsert.mockResolvedValue(true);

    await SkuMinSalesService.save([{ masterSku: "SKU-IB", minTotalAvgCurr: 1.5, referenceSku: "SKU-BE", referencePct: 30 }], WHO, null);
    expect(repositoryMock.upsert.mock.calls[0][0]).toEqual(
      { masterSku: "SKU-IB", minTotalAvgCurr: 1.5, referenceSku: "SKU-BE", referencePct: 30, note: null },
    );
  });

  it("rejects a reference SKU that is not in SKU Master", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-IB"]));
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-IB", referenceSku: "SKU-NOPE", referencePct: 30 }], WHO, null))
      .rejects.toThrow("SKU does not exist in SKU Master: SKU-NOPE");
    expect(repositoryMock.upsert).not.toHaveBeenCalled();
  });

  it("rejects a SKU that references itself, a reference without a usable percent, and a row with neither rule", async () => {
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", referenceSku: "sku-1", referencePct: 30 }], WHO, null))
      .rejects.toThrow("cannot reference itself");
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", referenceSku: "SKU-2" }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", referenceSku: "SKU-2", referencePct: 0 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", referencePct: 30 }], WHO, null))
      .rejects.toThrow("needs a reference SKU");
    await expect(SkuMinSalesService.save([{ masterSku: "SKU-1", note: "nothing" }], WHO, null))
      .rejects.toThrow("needs a minimum, a reference SKU, or both");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("audit-logs a reference change on a SKU whose minimum did not move", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-IB", "SKU-BE"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-IB", minTotalAvgCurr: 2, referenceSku: "SKU-BE", referencePct: 30, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    await SkuMinSalesService.save([{ masterSku: "SKU-IB", minTotalAvgCurr: 2, referenceSku: "SKU-BE", referencePct: 40 }], WHO, null);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "update",
      before: { minTotalAvgCurr: 2, referenceSku: "SKU-BE", referencePct: 30 },
      after: { minTotalAvgCurr: 2, referenceSku: "SKU-BE", referencePct: 40 },
    }));
  });
});

describe("SkuMinSalesService colour rules", () => {
  const ACTIVE = [
    "CA-SC-10-F-99-IB-1TO", "CA-SC-10-F-99-BE-1TO",
    "CA-SC-10-F-10-IB-1TO", "CA-SC-10-F-10-BE-1TO",
    "CA-SC-10-R-20-IB-1TO", // no BE counterpart
    "CA-SC-10-F-10-BK-1TO",
    "CC-TT-03-Y-BK-1TO", "CC-TT-03-Y-GR-1TO",
  ];
  const savedRule = {
    id: 7, categoryCode: "SC", material: null, color: "IB", referenceColor: "BE", referencePct: 30,
    note: null, updatedBy: "Alice", updatedAt: "2026-11-18T00:00:00.000Z",
  };

  it("previews how many active SKUs a rule reaches and which have no reference SKU", async () => {
    repositoryMock.listActiveColorRuleSkus.mockResolvedValue(ACTIVE);
    const coverage = await SkuMinSalesService.previewColorRule({ categoryCode: "sc", color: " ib ", referenceColor: "be", referencePct: 30 });
    expect(coverage).toEqual({ matched: 3, paired: 2, unpaired: ["CA-SC-10-R-20-IB-1TO"] });
    expect(repositoryMock.upsertColorRule).not.toHaveBeenCalled();
  });

  it("lists every rule with its coverage", async () => {
    repositoryMock.listActiveColorRuleSkus.mockResolvedValue(ACTIVE);
    repositoryMock.listColorRules.mockResolvedValue([
      savedRule,
      { ...savedRule, id: 1, categoryCode: "CC", material: "03", color: "BK", referenceColor: "GR" },
    ]);
    const rules = await SkuMinSalesService.listColorRules();
    expect(rules[0].coverage).toEqual({ matched: 3, paired: 2, unpaired: ["CA-SC-10-R-20-IB-1TO"] });
    expect(rules[1].coverage).toEqual({ matched: 1, paired: 1, unpaired: [] });
  });

  it("normalizes and saves a rule, invalidates the cache, and audit-logs it", async () => {
    repositoryMock.getColorRuleForUpdate.mockResolvedValue(null);
    repositoryMock.upsertColorRule.mockResolvedValue(savedRule);

    const result = await SkuMinSalesService.saveColorRule(
      { categoryCode: "sc", material: " ", color: "ib", referenceColor: "be", referencePct: 30.004, note: " " }, WHO, null,
    );

    expect(repositoryMock.upsertColorRule).toHaveBeenCalledWith(
      { categoryCode: "SC", material: null, color: "IB", referenceColor: "BE", referencePct: 30, note: null },
      "Alice",
      expect.anything(),
    );
    expect(result).toEqual({ rule: savedRule, created: true });
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "color-rule:7", entityLabel: "SC IB → BE", action: "create", after: { referenceColor: "BE", referencePct: 30 },
    }));
  });

  it("logs an overwrite of an existing rule as an update", async () => {
    repositoryMock.getColorRuleForUpdate.mockResolvedValue({ ...savedRule, referencePct: 20 });
    repositoryMock.upsertColorRule.mockResolvedValue(savedRule);
    const result = await SkuMinSalesService.saveColorRule({ categoryCode: "SC", color: "IB", referenceColor: "BE", referencePct: 30 }, WHO, null);
    expect(result.created).toBe(false);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "update", before: { referenceColor: "BE", referencePct: 20 },
    }));
  });

  it("rejects an unsupported category, a colour referencing itself, a bad segment code, and a bad percent", async () => {
    const base = { categoryCode: "SC", color: "IB", referenceColor: "BE", referencePct: 30 };
    await expect(SkuMinSalesService.saveColorRule({ ...base, categoryCode: "FM" }, WHO, null)).rejects.toBeInstanceOf(ValidationError);
    await expect(SkuMinSalesService.saveColorRule({ ...base, referenceColor: "ib" }, WHO, null)).rejects.toThrow("cannot reference itself");
    await expect(SkuMinSalesService.saveColorRule({ ...base, color: "I-B" }, WHO, null)).rejects.toBeInstanceOf(ValidationError);
    await expect(SkuMinSalesService.saveColorRule({ ...base, referencePct: 0 }, WHO, null)).rejects.toBeInstanceOf(ValidationError);
    await expect(SkuMinSalesService.saveColorRule({ ...base, referencePct: 1001 }, WHO, null)).rejects.toBeInstanceOf(ValidationError);
    expect(repositoryMock.upsertColorRule).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("deletes a rule, invalidates the cache, and audit-logs it", async () => {
    repositoryMock.deleteColorRule.mockResolvedValue(savedRule);
    await expect(SkuMinSalesService.removeColorRule(7, WHO, null)).resolves.toEqual({ id: 7 });
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: "color-rule:7", action: "delete" }));
  });

  it("throws NotFoundError for a rule that does not exist", async () => {
    repositoryMock.deleteColorRule.mockResolvedValue(null);
    await expect(SkuMinSalesService.removeColorRule(99, WHO, null)).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });
});

describe("SkuMinSalesService.remove", () => {
  it("deletes, invalidates the cache, and audit-logs each removed SKU", async () => {
    repositoryMock.deleteMany.mockResolvedValue(["SKU-1", "SKU-2"]);
    const result = await SkuMinSalesService.remove([" sku-1", "SKU-2", "SKU-2"], WHO, null);
    expect(repositoryMock.deleteMany).toHaveBeenCalledWith(["SKU-1", "SKU-2"]);
    expect(result).toEqual({ skus: ["SKU-1", "SKU-2"] });
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });

  it("throws NotFoundError when nothing was registered", async () => {
    repositoryMock.deleteMany.mockResolvedValue([]);
    await expect(SkuMinSalesService.remove(["SKU-1"], WHO, null)).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("rejects an empty sku list", async () => {
    await expect(SkuMinSalesService.remove([" "], WHO, null)).rejects.toBeInstanceOf(ValidationError);
  });
});
