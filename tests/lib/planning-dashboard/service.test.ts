import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  listSkuNotes: vi.fn(),
  deleteSkuNote: vi.fn(),
  upsertSkuNote: vi.fn(),
  listSkuWorkNotes: vi.fn(),
  deleteSkuWorkNote: vi.fn(),
  upsertSkuWorkNote: vi.fn(),
  getProductCbmForUpdate: vi.fn(),
  updateProductCbm: vi.fn(),
  cascadeContainerItemsCbm: vi.fn(),
  getOosLostDemandChannelTotals: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const authMock = vi.fn();
const logAuditMock = vi.fn();
const invalidateCacheMock = vi.fn();

vi.mock("@/lib/planning-dashboard/repository", () => ({ PlanningDashboardRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));

const { PlanningDashboardService } = await import("@/lib/planning-dashboard/service");

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", name: "Alice", email: "a@x.com" } });
});

describe("PlanningDashboardService.getSkuNotes", () => {
  it("maps rows into a masterSku -> note object", async () => {
    repositoryMock.listSkuNotes.mockResolvedValue([{ masterSku: "SKU-1", note: "hi" }]);
    const result = await PlanningDashboardService.getSkuNotes();
    expect(result).toEqual({ "SKU-1": "hi" });
  });
});

describe("PlanningDashboardService.setSkuNote", () => {
  it("throws ValidationError for a blank sku", async () => {
    await expect(PlanningDashboardService.setSkuNote("  ", "note", null)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when the note exceeds 5000 chars", async () => {
    await expect(PlanningDashboardService.setSkuNote("SKU-1", "x".repeat(5001), null)).rejects.toThrow("Note is too long");
  });

  it("deletes the note when the trimmed value is empty", async () => {
    const result = await PlanningDashboardService.setSkuNote("SKU-1", "   ", "u1");
    expect(repositoryMock.deleteSkuNote).toHaveBeenCalledWith("SKU-1");
    expect(repositoryMock.upsertSkuNote).not.toHaveBeenCalled();
    expect(result).toEqual({ sku: "SKU-1", note: "" });
  });

  it("upserts a non-empty note", async () => {
    const result = await PlanningDashboardService.setSkuNote("SKU-1", " hello ", "u1");
    expect(repositoryMock.upsertSkuNote).toHaveBeenCalledWith("SKU-1", "hello", "u1");
    expect(result).toEqual({ sku: "SKU-1", note: "hello" });
  });
});

describe("PlanningDashboardService SKU work notes", () => {
  it("maps work notes by master SKU", async () => {
    repositoryMock.listSkuWorkNotes.mockResolvedValue([{ masterSku: "SKU-1", note: "Checked" }]);
    await expect(PlanningDashboardService.getSkuWorkNotes()).resolves.toEqual({ "SKU-1": "Checked" });
  });

  it("normalizes a work note to one line before saving", async () => {
    const result = await PlanningDashboardService.setSkuWorkNote(" SKU-1 ", " Hold\nRecheck ", "u1");
    expect(repositoryMock.upsertSkuWorkNote).toHaveBeenCalledWith("SKU-1", "Hold Recheck", "u1", 1);
    expect(result).toEqual({ sku: "SKU-1", note: "Hold Recheck" });
  });

  it("deletes an empty work note and limits its length", async () => {
    await expect(PlanningDashboardService.setSkuWorkNote("SKU-1", " ", "u1"))
      .resolves.toEqual({ sku: "SKU-1", note: "" });
    expect(repositoryMock.deleteSkuWorkNote).toHaveBeenCalledWith("SKU-1", 1);
    await expect(PlanningDashboardService.setSkuWorkNote("SKU-1", "x".repeat(201), "u1"))
      .rejects.toThrow("Work note is too long");
  });

  it("keeps Note 2 and Note 3 in independent slots", async () => {
    repositoryMock.listSkuWorkNotes.mockResolvedValue([{ masterSku: "SKU-1", note: "Second" }]);
    await expect(PlanningDashboardService.getSkuWorkNotes(2)).resolves.toEqual({ "SKU-1": "Second" });
    expect(repositoryMock.listSkuWorkNotes).toHaveBeenCalledWith(2);

    await PlanningDashboardService.setSkuWorkNote("SKU-1", "Third", "u1", 3);
    expect(repositoryMock.upsertSkuWorkNote).toHaveBeenCalledWith("SKU-1", "Third", "u1", 3);
  });
});

describe("PlanningDashboardService.updateProductCbm", () => {
  it("throws ValidationError for an invalid cbm", async () => {
    await expect(PlanningDashboardService.updateProductCbm("SKU-1", "not-a-number", null)).rejects.toThrow(ValidationError);
    await expect(PlanningDashboardService.updateProductCbm("SKU-1", -1, null)).rejects.toThrow(ValidationError);
  });

  it("updates, cascades, invalidates cache, and audit-logs only when the value changed", async () => {
    repositoryMock.getProductCbmForUpdate.mockResolvedValue(1.0);
    repositoryMock.cascadeContainerItemsCbm.mockResolvedValue([{ item_id: 1, container_name: "C-1", cbm_unit: 2, total_cbm: 20 }]);

    const result = await PlanningDashboardService.updateProductCbm("SKU-1", 2, "1.2.3.4");

    expect(result).toEqual({ cbmPerUnit: 2, containerItems: [{ item_id: 1, container_name: "C-1", cbm_unit: 2, total_cbm: 20 }] });
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "sku", action: "update", before: { cbmPerUnit: 1.0 }, after: { cbmPerUnit: 2 }, ip: "1.2.3.4",
    }));
  });

  it("does not audit-log when the cbm value is unchanged", async () => {
    repositoryMock.getProductCbmForUpdate.mockResolvedValue(2);
    repositoryMock.cascadeContainerItemsCbm.mockResolvedValue([]);

    await PlanningDashboardService.updateProductCbm("SKU-1", 2, null);

    expect(logAuditMock).not.toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
  });
});

describe("PlanningDashboardService.getOosLostDemandWeights", () => {
  it("computes marketplace/shopify ratios per category", async () => {
    repositoryMock.getOosLostDemandChannelTotals.mockResolvedValue([
      { category_code: "SC", shopify_90d: "100", amazon_90d: "10", ebay_90d: "5", walmart_90d: "0" },
    ]);

    const weights = await PlanningDashboardService.getOosLostDemandWeights();

    expect(weights.SC).toEqual({ amazon: 0.1, ebay: 0.05, walmart: 0 });
    expect(weights.CC).toEqual({ amazon: 0, ebay: 0, walmart: 0 });
  });

  it("floors the shopify divisor at 1 to avoid divide-by-zero", async () => {
    repositoryMock.getOosLostDemandChannelTotals.mockResolvedValue([
      { category_code: "SC", shopify_90d: "0", amazon_90d: "5", ebay_90d: "0", walmart_90d: "0" },
    ]);

    const weights = await PlanningDashboardService.getOosLostDemandWeights();

    expect(weights.SC.amazon).toBe(5);
  });
});
