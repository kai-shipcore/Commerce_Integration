import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "@/lib/errors";

const repositoryMock = {
  listContainers: vi.fn(),
  findMissingSkus: vi.fn(),
  insertContainer: vi.fn(),
  insertContainerItems: vi.fn(),
  getContainer: vi.fn(),
  lockContainer: vi.fn(),
  updateStatus: vi.fn(),
  updateConfirmed: vi.fn(),
  updateDetails: vi.fn(),
  updateEta: vi.fn(),
  updateEtaLaxLgb: vi.fn(),
  getItemSummary: vi.fn(),
  replaceContainerFull: vi.fn(),
  getContainerForDelete: vi.fn(),
  deleteContainerCascade: vi.fn(),
  listAuditLog: vi.fn(),
  getContainerNumber: vi.fn(),
  updateNote: vi.fn(),
  softDeleteNote: vi.fn(),
  getProductCbm: vi.fn(),
  getProductCbmMap: vi.fn(),
  upsertItem: vi.fn(),
  upsertItemForAutoFill: vi.fn(),
  getItemForUpdate: vi.fn(),
  updateItemQty: vi.fn(),
  deleteItem: vi.fn(),
  syncRemainingAllocationForContainerItem: vi.fn(),
  deleteRemainingAllocationsForContainerItem: vi.fn(),
  lockContainerStatus: vi.fn(),
  lockAvailableStockForAllocate: vi.fn(),
  bulkIncrementAllocations: vi.fn(),
  bulkIncrementItems: vi.fn(),
  lockAllocationsForDeallocate: vi.fn(),
  getItemQtysBySku: vi.fn(),
  deleteAllocationsByIds: vi.fn(),
  decrementOrDeleteItemsBySku: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const invalidateCacheMock = vi.fn();
const logContainerAuditMock = vi.fn();
const isPOApproverRoleMock = vi.fn();

vi.mock("@/lib/container-planning/repository", () => ({ ContainerPlanningRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateCacheMock }));
vi.mock("@/lib/container-audit", () => ({ logContainerAudit: logContainerAuditMock }));
vi.mock("@/components/layout/navigation-config", () => ({ isPOApproverRole: isPOApproverRoleMock }));

const { ContainerPlanningService } = await import("@/lib/container-planning/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com", ip: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContainerPlanningService.createContainer", () => {
  it("throws ValidationError listing missing skus without inserting", async () => {
    repositoryMock.findMissingSkus.mockResolvedValue(["SKU-2"]);
    await expect(
      ContainerPlanningService.createContainer({ number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-2", qty: 1, cbm: 1 }] }, WHO),
    ).rejects.toThrow("SKU does not exist in fc_products: SKU-2");
    expect(repositoryMock.insertContainer).not.toHaveBeenCalled();
  });

  it("maps a unique-constraint violation to ConflictError", async () => {
    repositoryMock.findMissingSkus.mockResolvedValue([]);
    repositoryMock.insertContainer.mockRejectedValue({ constraint: "fc_containers_number_uk" });
    await expect(
      ContainerPlanningService.createContainer({ number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [] }, WHO),
    ).rejects.toThrow(ConflictError);
  });

  it("creates, invalidates cache, and audit-logs on success", async () => {
    repositoryMock.findMissingSkus.mockResolvedValue([]);
    repositoryMock.insertContainer.mockResolvedValue("42");

    const result = await ContainerPlanningService.createContainer(
      { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-1", qty: 2, cbm: 1 }] },
      WHO,
    );

    expect(result).toEqual({ id: "42" });
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(logContainerAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create", containerId: "42" }));
  });
});

describe("ContainerPlanningService PATCH branches", () => {
  const existing = {
    status: "draft", containerNumber: "C-1", eta: "2026-01-01", cbmCapacity: 80,
    factoryName: null, destWarehouse: null, note: null, estLoading: null, etdNgb: null, etaLaxLgb: null,
    confirmedDate: null, confirmedTime: null,
  };

  it("getExistingOrThrow throws NotFoundError when missing", async () => {
    repositoryMock.getContainer.mockResolvedValue(null);
    await expect(ContainerPlanningService.getExistingOrThrow("1")).rejects.toThrow(NotFoundError);
  });

  it("assertNotComplete throws ForbiddenError only when status is complete", () => {
    expect(() => ContainerPlanningService.assertNotComplete(existing)).not.toThrow();
    expect(() => ContainerPlanningService.assertNotComplete({ ...existing, status: "complete" })).toThrow(ForbiddenError);
  });

  it("updateStatus throws NotFoundError when the row disappeared, else audits only on real change", async () => {
    repositoryMock.updateStatus.mockResolvedValue(false);
    await expect(ContainerPlanningService.updateStatus("1", existing, "complete", WHO)).rejects.toThrow(NotFoundError);

    repositoryMock.updateStatus.mockResolvedValue(true);
    await ContainerPlanningService.updateStatus("1", existing, "draft", WHO);
    expect(logContainerAuditMock).not.toHaveBeenCalled();

    await ContainerPlanningService.updateStatus("1", existing, "complete", WHO);
    expect(logContainerAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
  });

  it("updateDetails logs status_change, eta_change, and details_update independently", async () => {
    repositoryMock.updateDetails.mockResolvedValue(true);
    await ContainerPlanningService.updateDetails(
      "1",
      existing,
      { number: "C-1", eta: "2026-02-01", cbmCapacity: 100, factory: "F2" },
      WHO,
    );
    const actions = logContainerAuditMock.mock.calls.map((c) => c[0].action);
    expect(actions).toContain("eta_change");
    expect(actions).toContain("details_update");
    expect(actions).not.toContain("status_change");
  });

  it("replaceContainer throws NotFoundError when the lock misses, ValidationError on missing skus", async () => {
    repositoryMock.lockContainer.mockResolvedValue(false);
    await expect(
      ContainerPlanningService.replaceContainer("1", existing, { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [] }, WHO),
    ).rejects.toThrow(NotFoundError);

    repositoryMock.lockContainer.mockResolvedValue(true);
    repositoryMock.getItemSummary.mockResolvedValue({ skuCount: 0, totalQty: 0 });
    repositoryMock.findMissingSkus.mockResolvedValue(["SKU-9"]);
    await expect(
      ContainerPlanningService.replaceContainer("1", existing, { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-9", qty: 1, cbm: 1 }] }, WHO),
    ).rejects.toThrow(ValidationError);
  });

  it("replaceContainer logs items_update only when sku count or qty actually changed", async () => {
    repositoryMock.lockContainer.mockResolvedValue(true);
    repositoryMock.getItemSummary.mockResolvedValue({ skuCount: 1, totalQty: 5 });
    repositoryMock.findMissingSkus.mockResolvedValue([]);

    await ContainerPlanningService.replaceContainer(
      "1", existing,
      { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-1", qty: 5, cbm: 1 }] },
      WHO,
    );
    expect(logContainerAuditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: "items_update" }));

    await ContainerPlanningService.replaceContainer(
      "1", existing,
      { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-1", qty: 9, cbm: 1 }] },
      WHO,
    );
    expect(logContainerAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "items_update" }));
  });
});

describe("ContainerPlanningService.deleteContainer", () => {
  it("throws NotFoundError when the container doesn't exist", async () => {
    repositoryMock.getContainerForDelete.mockResolvedValue(null);
    await expect(ContainerPlanningService.deleteContainer("1", { ...WHO, role: "user" })).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError for a complete container unless the role is a PO approver", async () => {
    repositoryMock.getContainerForDelete.mockResolvedValue({ id: "1", status: "complete", containerNumber: "C-1", eta: null });
    isPOApproverRoleMock.mockReturnValue(false);
    await expect(ContainerPlanningService.deleteContainer("1", { ...WHO, role: "user" })).rejects.toThrow(ForbiddenError);

    isPOApproverRoleMock.mockReturnValue(true);
    repositoryMock.deleteContainerCascade.mockResolvedValue("1");
    await expect(ContainerPlanningService.deleteContainer("1", { ...WHO, role: "admin" })).resolves.toEqual({ id: "1" });
  });
});

describe("ContainerPlanningService history notes", () => {
  it("addHistoryNote throws NotFoundError when the container is missing", async () => {
    repositoryMock.getContainerNumber.mockResolvedValue(null);
    await expect(ContainerPlanningService.addHistoryNote("1", "hello", WHO)).rejects.toThrow(NotFoundError);
  });

  it("editHistoryNote/deleteHistoryNote throw NotFoundError when the update affects no rows", async () => {
    repositoryMock.updateNote.mockResolvedValue(false);
    await expect(ContainerPlanningService.editHistoryNote("1", "1", "hi", "u1")).rejects.toThrow(NotFoundError);

    repositoryMock.softDeleteNote.mockResolvedValue(false);
    await expect(ContainerPlanningService.deleteHistoryNote("1", "1", "u1")).rejects.toThrow(NotFoundError);
  });
});

describe("ContainerPlanningService.upsertItem", () => {
  it("throws ValidationError when no cbm is available from input or product lookup", async () => {
    repositoryMock.getProductCbm.mockResolvedValue(null);
    await expect(ContainerPlanningService.upsertItem(1, "sku-1", 5, 0, null)).rejects.toThrow(
      "No CBM per unit on file for this SKU. Set it in SKU Master first.",
    );
  });

  it("looks up cbm from the product when not supplied, syncs allocation, invalidates cache", async () => {
    repositoryMock.getProductCbm.mockResolvedValue(2);
    repositoryMock.upsertItem.mockResolvedValue({ id: 5, cbmUnit: 2, totalCbm: 10, skuMemo: null });
    repositoryMock.syncRemainingAllocationForContainerItem.mockResolvedValue(3);

    const result = await ContainerPlanningService.upsertItem(1, "sku-1", 5, 0, null);

    expect(result).toEqual({ item_id: 5, qty: 5, allocated_qty: 3, cbm_unit: 2, total_cbm: 10, sku_memo: null });
    expect(invalidateCacheMock).toHaveBeenCalled();
  });
});

describe("ContainerPlanningService.updateItem / deleteItem", () => {
  it("updateItem throws NotFoundError when the item doesn't exist", async () => {
    repositoryMock.getItemForUpdate.mockResolvedValue(null);
    await expect(ContainerPlanningService.updateItem(1, 5, null)).rejects.toThrow(NotFoundError);
  });

  it("deleteItem is idempotent when the item no longer exists", async () => {
    repositoryMock.getItemForUpdate.mockResolvedValue(null);
    await expect(ContainerPlanningService.deleteItem(1)).resolves.toBeUndefined();
    expect(repositoryMock.deleteItem).not.toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
  });
});

describe("ContainerPlanningService.autoFill", () => {
  it("skips items with no positive cbm on file", async () => {
    repositoryMock.getProductCbmMap.mockResolvedValue(new Map([["SKU-1", 0], ["SKU-2", 2]]));
    repositoryMock.upsertItemForAutoFill.mockResolvedValue({ id: 1, cbmUnit: 2, totalCbm: 4 });
    repositoryMock.syncRemainingAllocationForContainerItem.mockResolvedValue(2);

    const results = await ContainerPlanningService.autoFill(1, [{ sku: "sku-1", qty: 5 }, { sku: "sku-2", qty: 2 }]);

    expect(results).toEqual([{ sku: "SKU-2", item_id: 1, qty: 2, cbm_unit: 2, total_cbm: 4, allocated_qty: 2 }]);
  });
});

describe("ContainerPlanningService.allocateStock", () => {
  it("throws NotFoundError when the container doesn't exist", async () => {
    repositoryMock.lockContainerStatus.mockResolvedValue(null);
    await expect(ContainerPlanningService.allocateStock("1", [{ stockId: "1", qty: 1 }])).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the container isn't draft", async () => {
    repositoryMock.lockContainerStatus.mockResolvedValue("complete");
    await expect(ContainerPlanningService.allocateStock("1", [{ stockId: "1", qty: 1 }])).rejects.toThrow(ConflictError);
  });

  it("throws ValidationError when a stock row is missing or over-requested", async () => {
    repositoryMock.lockContainerStatus.mockResolvedValue("draft");
    repositoryMock.lockAvailableStockForAllocate.mockResolvedValue([]);
    await expect(ContainerPlanningService.allocateStock("1", [{ stockId: "1", qty: 1 }])).rejects.toThrow(
      "One or more available stock records were not found.",
    );

    repositoryMock.lockAvailableStockForAllocate.mockResolvedValue([{ id: "1", masterSku: "SKU-1", cbm: 1, availableQty: 0 }]);
    await expect(ContainerPlanningService.allocateStock("1", [{ stockId: "1", qty: 1 }])).rejects.toThrow(
      "Requested quantity exceeds available quantity for SKU-1",
    );
  });

  it("allocates successfully and invalidates cache", async () => {
    repositoryMock.lockContainerStatus.mockResolvedValue("draft");
    repositoryMock.lockAvailableStockForAllocate.mockResolvedValue([{ id: "1", masterSku: "SKU-1", cbm: 1, availableQty: 5 }]);

    await ContainerPlanningService.allocateStock("1", [{ stockId: "1", qty: 3 }]);

    expect(repositoryMock.bulkIncrementAllocations).toHaveBeenCalledWith("1", ["1"], [3], expect.anything());
    expect(repositoryMock.bulkIncrementItems).toHaveBeenCalledWith("1", ["SKU-1"], [3], [1], expect.anything());
    expect(invalidateCacheMock).toHaveBeenCalled();
  });
});

describe("ContainerPlanningService.deallocateStock", () => {
  it("throws NotFoundError when an allocation id doesn't resolve", async () => {
    repositoryMock.lockAllocationsForDeallocate.mockResolvedValue([]);
    await expect(ContainerPlanningService.deallocateStock(["1"])).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when allocations span multiple containers", async () => {
    repositoryMock.lockAllocationsForDeallocate.mockResolvedValue([
      { id: "1", containerId: "1", masterSku: "SKU-1", qty: 1, status: "draft" },
      { id: "2", containerId: "2", masterSku: "SKU-1", qty: 1, status: "draft" },
    ]);
    await expect(ContainerPlanningService.deallocateStock(["1", "2"])).rejects.toThrow(
      "Selected allocations must belong to the same container.",
    );
  });

  it("throws ConflictError when the container isn't draft", async () => {
    repositoryMock.lockAllocationsForDeallocate.mockResolvedValue([
      { id: "1", containerId: "1", masterSku: "SKU-1", qty: 1, status: "complete" },
    ]);
    await expect(ContainerPlanningService.deallocateStock(["1"])).rejects.toThrow(
      "Allocated stock can be removed only while the container is Draft.",
    );
  });

  it("throws ConflictError when item qty is inconsistent with allocated qty", async () => {
    repositoryMock.lockAllocationsForDeallocate.mockResolvedValue([
      { id: "1", containerId: "1", masterSku: "SKU-1", qty: 5, status: "draft" },
    ]);
    repositoryMock.getItemQtysBySku.mockResolvedValue(new Map([["SKU-1", 2]]));
    await expect(ContainerPlanningService.deallocateStock(["1"])).rejects.toThrow(
      "Container item quantity is inconsistent with allocated stock.",
    );
  });

  it("deallocates successfully and invalidates cache", async () => {
    repositoryMock.lockAllocationsForDeallocate.mockResolvedValue([
      { id: "1", containerId: "1", masterSku: "SKU-1", qty: 2, status: "draft" },
    ]);
    repositoryMock.getItemQtysBySku.mockResolvedValue(new Map([["SKU-1", 5]]));

    const result = await ContainerPlanningService.deallocateStock(["1"]);

    expect(result).toEqual({ containerId: "1", deletedCount: 1 });
    expect(repositoryMock.deleteAllocationsByIds).toHaveBeenCalledWith(["1"], expect.anything());
    expect(invalidateCacheMock).toHaveBeenCalled();
  });
});
