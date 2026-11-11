import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  list: vi.fn(),
  findExistingProductSkus: vi.fn(),
  getForUpdate: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const invalidateCacheMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/lib/sku-replacing-soon/repository", () => ({ SkuReplacingSoonRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { SkuReplacingSoonService } = await import("@/lib/sku-replacing-soon/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuReplacingSoonService.save", () => {
  it("normalizes SKUs, defaults to 30 days, and upserts inside a transaction", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue(null);
    repositoryMock.upsert.mockResolvedValue(true);

    const result = await SkuReplacingSoonService.save([{ masterSku: " sku-1 ", replacementSku: " sku-2 ", note: "  " }], WHO, null);

    expect(result).toEqual({ inserted: 1, updated: 0, total: 1 });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(repositoryMock.upsert).toHaveBeenCalledWith(
      { masterSku: "SKU-1", targetInvLifeDays: 30, replacementSku: "SKU-2", note: null },
      "Alice",
      expect.anything(),
    );
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sku_replacing_soon", entityId: "SKU-1", action: "create",
    }));
  });

  it("rejects days outside 1-365 or fractional days", async () => {
    await expect(SkuReplacingSoonService.save([{ masterSku: "SKU-1", targetInvLifeDays: 0 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(SkuReplacingSoonService.save([{ masterSku: "SKU-1", targetInvLifeDays: 400 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(SkuReplacingSoonService.save([{ masterSku: "SKU-1", targetInvLifeDays: 30.5 }], WHO, null))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a SKU listed as its own replacement", async () => {
    await expect(SkuReplacingSoonService.save([{ masterSku: "SKU-1", replacementSku: "sku-1" }], WHO, null))
      .rejects.toThrow("cannot be its own replacement");
  });

  it("rejects the whole batch when any SKU is missing from SKU Master", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    await expect(SkuReplacingSoonService.save(
      [{ masterSku: "SKU-1" }, { masterSku: "SKU-X" }],
      WHO, null,
    )).rejects.toThrow("SKU does not exist in SKU Master: SKU-X");
    expect(repositoryMock.upsert).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it("does not audit-log a save that changes nothing", async () => {
    repositoryMock.findExistingProductSkus.mockResolvedValue(new Set(["SKU-1"]));
    repositoryMock.getForUpdate.mockResolvedValue({ masterSku: "SKU-1", targetInvLifeDays: 30, replacementSku: null, note: null });
    repositoryMock.upsert.mockResolvedValue(false);

    const result = await SkuReplacingSoonService.save([{ masterSku: "SKU-1", targetInvLifeDays: 30 }], WHO, null);
    expect(result).toEqual({ inserted: 0, updated: 1, total: 1 });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("SkuReplacingSoonService.remove", () => {
  it("deletes, invalidates the cache, and audit-logs each removed SKU", async () => {
    repositoryMock.deleteMany.mockResolvedValue(["SKU-1"]);
    const result = await SkuReplacingSoonService.remove([" sku-1", "SKU-1"], WHO, null);
    expect(repositoryMock.deleteMany).toHaveBeenCalledWith(["SKU-1"]);
    expect(result).toEqual({ skus: ["SKU-1"] });
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("throws NotFoundError when nothing was registered", async () => {
    repositoryMock.deleteMany.mockResolvedValue([]);
    await expect(SkuReplacingSoonService.remove(["SKU-1"], WHO, null)).rejects.toBeInstanceOf(NotFoundError);
  });
});
