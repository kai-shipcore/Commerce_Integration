import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ConflictError, ForbiddenError } from "@/lib/errors";

const repositoryMock = {
  ensureCreatedByColumn: vi.fn(),
  ensureFactoryCodeSequence: vi.fn(),
  getNextPoNumberSeq: vi.fn(),
  listPurchaseOrders: vi.fn(),
  upsertFactoryByName: vi.fn(),
  findMissingSkus: vi.fn(),
  syncProductMoqCbm: vi.fn(),
  insertPurchaseOrder: vi.fn(),
  insertPurchaseOrderItem: vi.fn(),
  getStatusById: vi.fn(),
  updateWorkflowStatus: vi.fn(),
  lockForUpdate: vi.fn(),
  updateHeader: vi.fn(),
  deleteItemsByPoId: vi.fn(),
  lockForDelete: vi.fn(),
  deleteCascade: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const isPOApproverRoleMock = vi.fn();

vi.mock("@/lib/purchase-orders/repository", () => ({ PurchaseOrdersRepository: repositoryMock, withTransaction: withTransactionMock }));
vi.mock("@/components/layout/navigation-config", () => ({ isPOApproverRole: isPOApproverRoleMock }));

const { PurchaseOrdersService } = await import("@/lib/purchase-orders/service");

const HEADER = { number: "PO-1", date: "2026-01-01", eta: "2026-02-01", factory: " Acme ", status: "draft" as const, items: [{ sku: "SKU-1", moq: 5, qty: 10, cbm: 1 }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchaseOrdersService.getNextNumber", () => {
  it("formats as PO-<year>-<padded seq>", async () => {
    repositoryMock.getNextPoNumberSeq.mockResolvedValue(7);
    const number = await PurchaseOrdersService.getNextNumber();
    expect(number).toBe(`PO-${new Date().getFullYear()}-007`);
  });
});

describe("PurchaseOrdersService.createPurchaseOrder", () => {
  it("throws ValidationError listing missing skus, without inserting the PO", async () => {
    repositoryMock.upsertFactoryByName.mockResolvedValue("f1");
    repositoryMock.insertPurchaseOrder.mockResolvedValue("po1");
    repositoryMock.findMissingSkus.mockResolvedValue(["SKU-1"]);

    await expect(PurchaseOrdersService.createPurchaseOrder(HEADER, "u1")).rejects.toThrow(
      "SKU does not exist in fc_products: SKU-1",
    );
  });

  it("trims the factory name before upsert and creation, syncs product moq/cbm per item", async () => {
    repositoryMock.upsertFactoryByName.mockResolvedValue("f1");
    repositoryMock.insertPurchaseOrder.mockResolvedValue("po1");
    repositoryMock.findMissingSkus.mockResolvedValue([]);

    const result = await PurchaseOrdersService.createPurchaseOrder(HEADER, "u1");

    expect(repositoryMock.upsertFactoryByName).toHaveBeenCalledWith("Acme", expect.anything());
    expect(repositoryMock.syncProductMoqCbm).toHaveBeenCalledWith("SKU-1", 5, 1, expect.anything());
    expect(repositoryMock.insertPurchaseOrderItem).toHaveBeenCalledWith("po1", HEADER.items[0], expect.anything());
    expect(result).toEqual({ id: "po1", factoryId: "f1" });
  });
});

describe("PurchaseOrdersService.transitionWorkflow", () => {
  it("throws ForbiddenError for an adminOnly action when the role isn't an approver", async () => {
    isPOApproverRoleMock.mockReturnValue(false);
    await expect(PurchaseOrdersService.transitionWorkflow("1", "approve", "user")).rejects.toThrow(ForbiddenError);
    expect(repositoryMock.getStatusById).not.toHaveBeenCalled();
  });

  it("allows a non-adminOnly action regardless of role", async () => {
    repositoryMock.getStatusById.mockResolvedValue("draft");
    const result = await PurchaseOrdersService.transitionWorkflow("1", "request_review", "user");
    expect(result).toEqual({ id: "1", status: "pending" });
  });

  it("throws NotFoundError when the purchase order doesn't exist", async () => {
    isPOApproverRoleMock.mockReturnValue(true);
    repositoryMock.getStatusById.mockResolvedValue(null);
    await expect(PurchaseOrdersService.transitionWorkflow("1", "approve", "admin")).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the current status isn't in the allowed 'from' list", async () => {
    isPOApproverRoleMock.mockReturnValue(true);
    repositoryMock.getStatusById.mockResolvedValue("sent");
    await expect(PurchaseOrdersService.transitionWorkflow("1", "approve", "admin")).rejects.toThrow(
      "Cannot perform this action from status: sent",
    );
  });
});

describe("PurchaseOrdersService.updatePurchaseOrder", () => {
  it("throws ValidationError up front when the incoming status is sent", async () => {
    await expect(PurchaseOrdersService.updatePurchaseOrder("1", { ...HEADER, status: "sent" })).rejects.toThrow(
      "Sent purchase orders cannot be edited",
    );
    expect(repositoryMock.lockForUpdate).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the PO doesn't exist", async () => {
    repositoryMock.lockForUpdate.mockResolvedValue(null);
    await expect(PurchaseOrdersService.updatePurchaseOrder("1", HEADER)).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError (409) when the existing status is already sent, distinct from the 400 pre-check", async () => {
    repositoryMock.lockForUpdate.mockResolvedValue({ id: "1", status: "sent" });
    await expect(PurchaseOrdersService.updatePurchaseOrder("1", HEADER)).rejects.toThrow(ConflictError);
  });

  it("replaces items: deletes existing then inserts the new set", async () => {
    repositoryMock.lockForUpdate.mockResolvedValue({ id: "1", status: "draft" });
    repositoryMock.findMissingSkus.mockResolvedValue([]);
    repositoryMock.upsertFactoryByName.mockResolvedValue("f2");

    await PurchaseOrdersService.updatePurchaseOrder("1", HEADER);

    expect(repositoryMock.deleteItemsByPoId).toHaveBeenCalledWith("1", expect.anything());
    expect(repositoryMock.insertPurchaseOrderItem).toHaveBeenCalledWith("1", HEADER.items[0], expect.anything());
  });
});

describe("PurchaseOrdersService.deletePurchaseOrder", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.lockForDelete.mockResolvedValue(null);
    await expect(PurchaseOrdersService.deletePurchaseOrder("1")).rejects.toThrow(NotFoundError);
  });

  it("cascades and returns id/number", async () => {
    repositoryMock.lockForDelete.mockResolvedValue({ id: "1", po_number: "PO-1" });
    const result = await PurchaseOrdersService.deletePurchaseOrder("1");
    expect(repositoryMock.deleteCascade).toHaveBeenCalledWith("1", expect.anything());
    expect(result).toEqual({ id: "1", number: "PO-1" });
  });
});
