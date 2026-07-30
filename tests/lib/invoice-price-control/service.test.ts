import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";

const repositoryMock = {
  queryInvoiceList: vi.fn(),
  queryInvoiceStatusCounts: vi.fn(),
  createInvoice: vi.fn(),
  getInvoiceForUpdate: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  updateInvoiceDetails: vi.fn(),
  getInvoiceNumber: vi.fn(),
  getInvoiceSummary: vi.fn(),
  deleteInvoice: vi.fn(),
  loadInvoiceDetail: vi.fn(),
  insertInvoiceItemWithComparison: vi.fn(),
  recalculateInvoiceStatus: vi.fn(),
  recompareInvoiceItems: vi.fn(),
  assertItemBelongsToInvoice: vi.fn(),
  updateInvoiceItemLine: vi.fn(),
  updateInvoiceItemCredit: vi.fn(),
  updateInvoiceItemFactoryConfirm: vi.fn(),
  deleteInvoiceItem: vi.fn(),
  queryImportBatches: vi.fn(),
  queryImportBatchDetail: vi.fn(),
  deleteInvoiceItemsBySourceFile: vi.fn(),
  deletePriceListFileIfOrphaned: vi.fn(),
  getPriceListFileOriginalName: vi.fn(),
  clearInvoiceAttachmentIfMatches: vi.fn(),
  insertPriceListFile: vi.fn(),
  updateInvoiceAttachment: vi.fn(),
  updateInvoiceLastComparedAt: vi.fn(),
  getPriceListFile: vi.fn(),
  queryCreditNoteList: vi.fn(),
  queryCreditNoteStatusSummary: vi.fn(),
  getInvoiceForCreditNote: vi.fn(),
  createCreditNote: vi.fn(),
  getCreditNoteForUpdate: vi.fn(),
  confirmCreditNote: vi.fn(),
  applyCreditNote: vi.fn(),
  revertCreditNoteFromApplied: vi.fn(),
  revertCreditNoteFromConfirmed: vi.fn(),
  editCreditNote: vi.fn(),
  deleteCreditNote: vi.fn(),
  queryOverchargedItemsForBulk: vi.fn(),
  insertBulkCreditNote: vi.fn(),
  queryPriceHistoryFilesMode: vi.fn(),
  queryPriceHistoryList: vi.fn(),
  createPriceHistory: vi.fn(),
  updatePriceHistory: vi.fn(),
  deletePriceHistoryBatch: vi.fn(),
  deletePriceHistoryByIds: vi.fn(),
  deletePriceHistoryById: vi.fn(),
  findExistingPriceHistoryRow: vi.fn(),
  upsertPriceHistoryRow: vi.fn(),
};

const withTransactionMock = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }));
const authMock = vi.fn();
const logInvoiceAuditMock = vi.fn();
const listFactoriesMock = vi.fn();

vi.mock("@/lib/invoice-price-control/repository", () => ({
  InvoicePriceControlRepository: repositoryMock,
  withTransaction: withTransactionMock,
}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/invoice-audit", () => ({ logInvoiceAudit: logInvoiceAuditMock }));
vi.mock("@/lib/factories/repository", () => ({ FactoriesRepository: { listFactories: listFactoriesMock } }));

const { InvoicePriceControlService } = await import("@/lib/invoice-price-control/service");

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", name: "Alice", email: "a@x.com" } });
});

describe("InvoicePriceControlService.listInvoices", () => {
  it("computes bucket counts from status counts", async () => {
    repositoryMock.queryInvoiceList.mockResolvedValue([]);
    repositoryMock.queryInvoiceStatusCounts.mockResolvedValue([
      { status: "received", count: 2 },
      { status: "approved", count: 3 },
      { status: "factory_confirmation", count: 1 },
    ]);

    const result = await InvoicePriceControlService.listInvoices({ search: "", factoryId: "", bucketsCsv: "" });

    expect(result.bucketCounts).toEqual({ all: 6, pending_review: 2, hold: 1, reviewed: 3 });
  });

  it("wraps query errors in a friendly Korean message", async () => {
    repositoryMock.queryInvoiceList.mockRejectedValue(new Error("db down"));
    await expect(InvoicePriceControlService.listInvoices({ search: "", factoryId: "", bucketsCsv: "" }))
      .rejects.toThrow("Invoice 목록을 불러오지 못했습니다");
  });
});

describe("InvoicePriceControlService.createInvoice", () => {
  it("maps a unique-constraint violation to ConflictError", async () => {
    repositoryMock.createInvoice.mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    await expect(
      InvoicePriceControlService.createInvoice({ factoryId: "1", invoiceNumber: "INV-1", invoiceDate: "2026-01-01" }),
    ).rejects.toThrow(ConflictError);
  });

  it("rethrows unrelated errors", async () => {
    repositoryMock.createInvoice.mockRejectedValue(new Error("connection refused"));
    await expect(
      InvoicePriceControlService.createInvoice({ factoryId: "1", invoiceNumber: "INV-1", invoiceDate: "2026-01-01" }),
    ).rejects.toThrow("connection refused");
  });

  it("creates and audit-logs on success", async () => {
    repositoryMock.createInvoice.mockResolvedValue("1");
    const result = await InvoicePriceControlService.createInvoice({ factoryId: "1", invoiceNumber: "INV-1", invoiceDate: "2026-01-01" });
    expect(result).toEqual({ id: "1" });
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create", invoiceId: "1" }));
  });
});

describe("InvoicePriceControlService.updateInvoiceStatus", () => {
  it("throws NotFoundError when the invoice doesn't exist", async () => {
    repositoryMock.getInvoiceForUpdate.mockResolvedValue(null);
    await expect(InvoicePriceControlService.updateInvoiceStatus("1", "signed", null)).rejects.toThrow(NotFoundError);
  });

  it("only audit-logs when the status actually changed", async () => {
    repositoryMock.getInvoiceForUpdate.mockResolvedValue({ status: "received", invoiceNumber: "INV-1" });
    repositoryMock.updateInvoiceStatus.mockResolvedValue("1");

    await InvoicePriceControlService.updateInvoiceStatus("1", "received", null);
    expect(logInvoiceAuditMock).not.toHaveBeenCalled();

    await InvoicePriceControlService.updateInvoiceStatus("1", "approved", null);
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
  });
});

describe("InvoicePriceControlService.addInvoiceItem", () => {
  it("throws NotFoundError when the invoice is missing", async () => {
    repositoryMock.getInvoiceSummary.mockResolvedValue(null);
    await expect(InvoicePriceControlService.addInvoiceItem("1", { sku: "A", qty: 1, unitPrice: 1 })).rejects.toThrow(NotFoundError);
  });

  it("inserts inside a transaction and recalculates status", async () => {
    repositoryMock.getInvoiceSummary.mockResolvedValue({ invoiceNumber: "INV-1", factoryId: "5", invoiceDate: "2026-01-01" });
    repositoryMock.insertInvoiceItemWithComparison.mockResolvedValue({ id: "10", expectedUnitPrice: null, diffUnitPrice: null, result: "no_price_history" });

    const result = await InvoicePriceControlService.addInvoiceItem("1", { sku: "A", qty: 1, unitPrice: 1 });

    expect(result.id).toBe("10");
    expect(repositoryMock.recalculateInvoiceStatus).toHaveBeenCalled();
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "items_update" }));
  });
});

describe("InvoicePriceControlService.editInvoiceItem", () => {
  const owner = {
    invoiceId: "1", invoiceNumber: "INV-1", sku: "A", qty: 1, invoiceUnitPrice: "5.00",
    creditStatus: null, factoryConfirmRequestedAt: null, factoryConfirmConfirmedAt: null,
  };

  it("throws NotFoundError when the item doesn't belong to the invoice", async () => {
    repositoryMock.assertItemBelongsToInvoice.mockResolvedValue(null);
    await expect(InvoicePriceControlService.editInvoiceItem("1", "10", { kind: "line", sku: "A", qty: 1, unitPrice: 1 })).rejects.toThrow(NotFoundError);
  });

  it("line edit recompares and recalculates inside a transaction", async () => {
    repositoryMock.assertItemBelongsToInvoice.mockResolvedValue(owner);
    await InvoicePriceControlService.editInvoiceItem("1", "10", { kind: "line", sku: "B", qty: 2, unitPrice: 9 });
    expect(repositoryMock.updateInvoiceItemLine).toHaveBeenCalled();
    expect(repositoryMock.recompareInvoiceItems).toHaveBeenCalled();
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "items_update" }));
  });

  it("credit edit updates credit status without a transaction", async () => {
    repositoryMock.assertItemBelongsToInvoice.mockResolvedValue(owner);
    await InvoicePriceControlService.editInvoiceItem("1", "10", { kind: "credit", creditStatus: "requested" });
    expect(repositoryMock.updateInvoiceItemCredit).toHaveBeenCalledWith("10", "requested", "Alice");
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "credit_update" }));
  });

  it("confirm edit updates factory-confirm tracking", async () => {
    repositoryMock.assertItemBelongsToInvoice.mockResolvedValue(owner);
    await InvoicePriceControlService.editInvoiceItem("1", "10", { kind: "confirm", action: "request" });
    expect(repositoryMock.updateInvoiceItemFactoryConfirm).toHaveBeenCalledWith("10", "request", "Alice");
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "factory_confirm_update" }));
  });
});

describe("InvoicePriceControlService.deleteImportBatch", () => {
  it("throws 'Upload batch not found' when the invoice is missing", async () => {
    withTransactionMock.mockImplementationOnce(async (fn) => fn({ query: vi.fn() }));
    repositoryMock.getInvoiceNumber.mockResolvedValue(null);
    await expect(InvoicePriceControlService.deleteImportBatch("1", "9")).rejects.toThrow("Upload batch not found");
  });

  it("throws the same 'Upload batch not found' when zero rows matched", async () => {
    repositoryMock.getInvoiceNumber.mockResolvedValue("INV-1");
    repositoryMock.getPriceListFileOriginalName.mockResolvedValue("file.xlsx");
    repositoryMock.deleteInvoiceItemsBySourceFile.mockResolvedValue(0);
    await expect(InvoicePriceControlService.deleteImportBatch("1", "9")).rejects.toThrow("Upload batch not found");
    expect(logInvoiceAuditMock).not.toHaveBeenCalled();
  });

  it("cleans up and audit-logs on success", async () => {
    repositoryMock.getInvoiceNumber.mockResolvedValue("INV-1");
    repositoryMock.getPriceListFileOriginalName.mockResolvedValue("file.xlsx");
    repositoryMock.deleteInvoiceItemsBySourceFile.mockResolvedValue(3);

    const result = await InvoicePriceControlService.deleteImportBatch("1", "9");

    expect(result).toEqual({ deletedRows: 3 });
    expect(repositoryMock.recalculateInvoiceStatus).toHaveBeenCalled();
    expect(repositoryMock.clearInvoiceAttachmentIfMatches).toHaveBeenCalled();
    expect(repositoryMock.deletePriceListFileIfOrphaned).toHaveBeenCalled();
    expect(logInvoiceAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "items_update" }));
  });
});

describe("InvoicePriceControlService credit note status machine", () => {
  it("confirmCreditNote rejects a non-pending record", async () => {
    repositoryMock.getCreditNoteForUpdate.mockResolvedValue({ sourceInvoiceId: "1", sku: "A", status: "confirmed" });
    await expect(InvoicePriceControlService.confirmCreditNote("5")).rejects.toThrow(ValidationError);
  });

  it("applyCreditNote requires confirmed status and a valid target invoice", async () => {
    repositoryMock.getCreditNoteForUpdate.mockResolvedValue({ sourceInvoiceId: "1", sku: "A", status: "confirmed" });
    repositoryMock.getInvoiceNumber.mockResolvedValue(null);
    await expect(InvoicePriceControlService.applyCreditNote("5", "99", "2026-01-01")).rejects.toThrow("적용할 Invoice를 찾을 수 없습니다.");
  });

  it("revertCreditNote from applied goes back to confirmed", async () => {
    repositoryMock.getCreditNoteForUpdate.mockResolvedValue({ sourceInvoiceId: "1", sku: "A", status: "applied" });
    await InvoicePriceControlService.revertCreditNote("5");
    expect(repositoryMock.revertCreditNoteFromApplied).toHaveBeenCalledWith("5");
  });

  it("revertCreditNote from pending is rejected", async () => {
    repositoryMock.getCreditNoteForUpdate.mockResolvedValue({ sourceInvoiceId: "1", sku: "A", status: "pending" });
    await expect(InvoicePriceControlService.revertCreditNote("5")).rejects.toThrow("Pending 상태는 되돌릴 수 없습니다.");
  });
});

describe("InvoicePriceControlService.createCreditNote", () => {
  it("throws ValidationError when creditAmount can't be derived", async () => {
    repositoryMock.getInvoiceForCreditNote.mockResolvedValue({ factoryId: "1", containerId: null, containerNumber: null });
    await expect(
      InvoicePriceControlService.createCreditNote({ sourceInvoiceId: "1", sku: "A", invoiceUnitPrice: 5, qty: 1 }),
    ).rejects.toThrow(ValidationError);
  });

  it("derives creditAmount from expected/invoice price when not given explicitly", async () => {
    repositoryMock.getInvoiceForCreditNote.mockResolvedValue({ factoryId: "1", containerId: null, containerNumber: null });
    repositoryMock.createCreditNote.mockResolvedValue("1");

    await InvoicePriceControlService.createCreditNote({ sourceInvoiceId: "1", sku: "A", invoiceUnitPrice: 8, expectedUnitPrice: 5, qty: 2 });

    expect(repositoryMock.createCreditNote).toHaveBeenCalledWith(expect.objectContaining({ creditAmount: 6 }));
  });
});

describe("InvoicePriceControlService.bulkCreateCreditNotes", () => {
  it("throws ValidationError when there are no overcharged items", async () => {
    repositoryMock.queryOverchargedItemsForBulk.mockResolvedValue([]);
    await expect(InvoicePriceControlService.bulkCreateCreditNotes(["1"])).rejects.toThrow(ValidationError);
  });

  it("counts created vs skipped based on the conflict result", async () => {
    repositoryMock.queryOverchargedItemsForBulk.mockResolvedValue([
      { itemId: "1", invoiceId: "1", sku: "A", qty: 2, invoiceUnitPrice: 8, expectedUnitPrice: 5, diffUnitPrice: 3, invoiceNumber: "INV-1", factoryId: "1", containerId: null, containerNumber: null },
      { itemId: "2", invoiceId: "1", sku: "B", qty: 1, invoiceUnitPrice: 8, expectedUnitPrice: 5, diffUnitPrice: 3, invoiceNumber: "INV-1", factoryId: "1", containerId: null, containerNumber: null },
    ]);
    repositoryMock.insertBulkCreditNote.mockResolvedValueOnce("1").mockResolvedValueOnce(null);

    const result = await InvoicePriceControlService.bulkCreateCreditNotes(["1", "2"]);

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(logInvoiceAuditMock).toHaveBeenCalledTimes(1);
  });
});

describe("InvoicePriceControlService price history", () => {
  it("createPriceHistory maps a null id to ConflictError", async () => {
    repositoryMock.createPriceHistory.mockResolvedValue(null);
    await expect(
      InvoicePriceControlService.createPriceHistory({ factoryId: "1", sku: "A", effectiveDate: "2026-01-01", unitPrice: 5, currency: "USD" }),
    ).rejects.toThrow(ConflictError);
  });

  it("updatePriceHistory maps a null id to NotFoundError", async () => {
    repositoryMock.updatePriceHistory.mockResolvedValue(null);
    await expect(
      InvoicePriceControlService.updatePriceHistory("1", { factoryId: "1", sku: "A", effectiveDate: "2026-01-01", unitPrice: 5, currency: "USD" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("deletePriceHistory prioritizes sourceFileId over ids/id", async () => {
    repositoryMock.deletePriceHistoryBatch.mockResolvedValue({ deletedRows: 4, fileDeleted: true });
    const result = await InvoicePriceControlService.deletePriceHistory({ sourceFileId: "9", ids: ["1"], id: "2" });
    expect(result).toEqual({ deletedRows: 4 });
    expect(repositoryMock.deletePriceHistoryByIds).not.toHaveBeenCalled();
  });

  it("deletePriceHistory throws NotFoundError when the source file didn't exist", async () => {
    repositoryMock.deletePriceHistoryBatch.mockResolvedValue({ deletedRows: 0, fileDeleted: false });
    await expect(InvoicePriceControlService.deletePriceHistory({ sourceFileId: "missing" })).rejects.toThrow("Source file not found");
  });

  it("deletePriceHistory falls back to ids when sourceFileId is absent", async () => {
    repositoryMock.deletePriceHistoryByIds.mockResolvedValue(2);
    const result = await InvoicePriceControlService.deletePriceHistory({ ids: ["1", "2"] });
    expect(result).toEqual({ deletedRows: 2 });
  });

  it("deletePriceHistory requires an id when neither sourceFileId nor ids are given", async () => {
    await expect(InvoicePriceControlService.deletePriceHistory({})).rejects.toThrow("id is required");
  });

  it("deletePriceHistory single-id delete returns null (no data) on success", async () => {
    repositoryMock.deletePriceHistoryById.mockResolvedValue(1);
    const result = await InvoicePriceControlService.deletePriceHistory({ id: "5" });
    expect(result).toBeNull();
  });

  it("deletePriceHistory single-id delete throws NotFoundError when nothing matched", async () => {
    repositoryMock.deletePriceHistoryById.mockResolvedValue(0);
    await expect(InvoicePriceControlService.deletePriceHistory({ id: "5" })).rejects.toThrow(NotFoundError);
  });

  it("getFactoriesForPriceHistory maps FactoriesRepository rows", async () => {
    listFactoriesMock.mockResolvedValue([{ id: "1", factory_code: "FC-0001", factory_name: "Factory A" }]);
    const result = await InvoicePriceControlService.getFactoriesForPriceHistory(true);
    expect(listFactoriesMock).toHaveBeenCalledWith({ active: true, search: "" });
    expect(result).toEqual([{ id: "1", factoryCode: "FC-0001", factoryName: "Factory A" }]);
  });
});

describe("InvoicePriceControlService.importPriceHistoryExcel", () => {
  it("throws ValidationError for a malformed effectiveDate", async () => {
    const file = new File(["a"], "prices.csv", { type: "text/csv" });
    await expect(
      InvoicePriceControlService.importPriceHistoryExcel(file, "1", "not-a-date", ""),
    ).rejects.toThrow(ValidationError);
  });

  it("skips parsing for non-Excel files but still stores the blob", async () => {
    repositoryMock.insertPriceListFile.mockResolvedValue("77");
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const result = await InvoicePriceControlService.importPriceHistoryExcel(file, "1", "2026-01-01", "");

    expect(result).toEqual({ sourceFileId: "77", imported: 0, errors: [] });
  });
});
