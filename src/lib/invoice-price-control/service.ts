/**
 * Business logic for Invoice Review, Credit Notes, and SKU Price History:
 * status-bucket computation, credit-amount rules, Excel import parsing,
 * price-comparison transaction orchestration, and audit logging (via the
 * domain-specific src/lib/invoice-audit.ts, kept separate from the shared
 * logAudit table by design). Data access lives in
 * src/lib/invoice-price-control/repository.ts.
 */

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { logInvoiceAudit } from "@/lib/invoice-audit";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";
import { FactoriesRepository } from "@/lib/factories/repository";
import { InvoicePriceControlRepository, withTransaction } from "@/lib/invoice-price-control/repository";

async function whoAmI() {
  const session = await auth();
  return {
    userId: session?.user?.id ?? null,
    userName: session?.user?.name ?? null,
    userEmail: session?.user?.email ?? null,
    displayName: session?.user?.name ?? session?.user?.email ?? null,
  };
}

function pickValue(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
    const found = entries.find(([key]) => key.toLowerCase().replace(/[\s_-]/g, "") === normalized);
    if (found) return found[1];
  }
  return undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────────

const STATUS_BUCKETS: Record<string, string[]> = {
  pending_review: ["received", "price_review", "discrepancy_found"],
  hold: ["factory_confirmation"],
  reviewed: ["approved", "signed", "sent_to_factory"],
};

export interface ListInvoicesQuery {
  search: string;
  factoryId: string;
  bucketsCsv: string;
}

export interface CreateInvoiceInput {
  factoryId: string;
  containerId?: string;
  containerNumber?: string;
  invoiceNumber: string;
  invoiceDate: string;
  note?: string;
}

export interface InvoiceDetailsInput {
  invoiceNumber: string;
  invoiceDate: string;
  containerId?: string;
  containerNumber?: string;
  note?: string;
}

export interface NewInvoiceItemInput {
  sku: string;
  qty: number;
  unitPrice: number;
}

export type InvoiceItemEdit =
  | { kind: "line"; sku: string; qty: number; unitPrice: number }
  | { kind: "credit"; creditStatus: "requested" | "confirmed" | "applied" | null }
  | { kind: "confirm"; action: "request" | "confirm" };

export const InvoicePriceControlService = {
  async listInvoices(query: ListInvoicesQuery) {
    const buckets = query.bucketsCsv ? query.bucketsCsv.split(",").filter(Boolean) : [];
    const statuses = buckets.flatMap((bucket) => STATUS_BUCKETS[bucket] ?? []);

    try {
      const [invoices, statusCounts] = await Promise.all([
        InvoicePriceControlRepository.queryInvoiceList({ search: query.search, factoryId: query.factoryId, statuses }),
        InvoicePriceControlRepository.queryInvoiceStatusCounts(),
      ]);

      const rawCounts = new Map(statusCounts.map((row) => [row.status, row.count]));
      const bucketCounts: Record<string, number> = { all: 0 };
      for (const [bucket, bucketStatuses] of Object.entries(STATUS_BUCKETS)) {
        bucketCounts[bucket] = bucketStatuses.reduce((sum, status) => sum + (rawCounts.get(status) ?? 0), 0);
      }
      bucketCounts.all = [...rawCounts.values()].reduce((sum, count) => sum + count, 0);

      return { invoices, bucketCounts };
    } catch (error) {
      console.error("Failed to load invoices", error);
      throw new Error("Invoice 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  },

  async createInvoice(input: CreateInvoiceInput) {
    const who = await whoAmI();
    let id: string;
    try {
      id = await InvoicePriceControlRepository.createInvoice({
        invoiceNumber: input.invoiceNumber,
        factoryId: input.factoryId,
        containerId: input.containerId || null,
        containerNumber: input.containerNumber || null,
        invoiceDate: input.invoiceDate,
        note: input.note || null,
        createdBy: who.userId,
      });
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new ConflictError("이미 존재하는 Invoice 번호입니다.");
      }
      throw error;
    }

    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: input.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { ...input },
    });

    return { id };
  },

  async getInvoiceDetail(id: string) {
    const detail = await InvoicePriceControlRepository.loadInvoiceDetail(id);
    if (!detail) throw new NotFoundError("Invoice not found");
    return detail;
  },

  async updateInvoiceStatus(id: string, status: string, ip: string | null) {
    const existing = await InvoicePriceControlRepository.getInvoiceForUpdate(id);
    if (!existing) throw new NotFoundError("Invoice not found");

    const who = await whoAmI();
    const isSigning = status === "signed";
    const updatedId = await InvoicePriceControlRepository.updateInvoiceStatus(id, status, isSigning, who.displayName);
    if (!updatedId) throw new NotFoundError("Invoice not found");

    if (existing.status !== status) {
      void logInvoiceAudit({
        invoiceId: id,
        invoiceNumber: existing.invoiceNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "status_change",
        before: { status: existing.status },
        after: { status },
        ip,
      });
    }

    return { id };
  },

  async updateInvoiceDetails(id: string, details: InvoiceDetailsInput, ip: string | null) {
    const existing = await InvoicePriceControlRepository.getInvoiceForUpdate(id);
    if (!existing) throw new NotFoundError("Invoice not found");

    const updatedId = await InvoicePriceControlRepository.updateInvoiceDetails(id, {
      invoiceNumber: details.invoiceNumber,
      invoiceDate: details.invoiceDate,
      containerId: details.containerId || null,
      containerNumber: details.containerNumber || null,
      note: details.note || null,
    });
    if (!updatedId) throw new NotFoundError("Invoice not found");

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber: details.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "details_update",
      before: {
        invoiceNumber: existing.invoiceNumber,
        invoiceDate: existing.invoiceDate,
        containerId: existing.containerId,
        containerNumber: existing.containerNumber,
        note: existing.note,
      },
      after: { ...details },
      ip,
    });

    return { id };
  },

  async deleteInvoice(id: string, ip: string | null) {
    const invoiceNumber = await InvoicePriceControlRepository.getInvoiceNumber(id);
    if (invoiceNumber === null) throw new NotFoundError("Invoice not found");

    await InvoicePriceControlRepository.deleteInvoice(id);

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: id,
      invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      ip,
    });
  },

  // ───────────────────────────────────────────────────────────────────────
  // Invoice items
  // ───────────────────────────────────────────────────────────────────────

  async addInvoiceItem(invoiceId: string, item: NewInvoiceItemInput) {
    const invoice = await InvoicePriceControlRepository.getInvoiceSummary(invoiceId);
    if (!invoice) throw new NotFoundError("Invoice not found");

    const inserted = await withTransaction(async (client) => {
      const result = await InvoicePriceControlRepository.insertInvoiceItemWithComparison(
        client, invoiceId, invoice.factoryId, invoice.invoiceDate, item,
      );
      await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
      return result;
    });

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "items_update",
      after: { added: item },
    });

    return inserted;
  },

  async importInvoiceItemsFromExcel(invoiceId: string, file: File) {
    const invoice = await InvoicePriceControlRepository.getInvoiceSummary(invoiceId);
    if (!invoice) throw new NotFoundError("Invoice not found");

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

    const errors: string[] = [];
    const parsedRows: Array<{ sku: string; qty: number; unitPrice: number }> = [];

    rows.forEach((row, index) => {
      const rowNo = index + 2;
      const sku = String(pickValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
      const qty = Number(pickValue(row, ["qty", "quantity"]));
      const rawPrice = pickValue(row, ["unit_price", "unit price", "price", "cost", "invoice_price", "invoice price"]);
      const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));

      if (!sku || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        errors.push(`Row ${rowNo}: sku, qty, unit_price are required`);
        return;
      }
      parsedRows.push({ sku, qty, unitPrice });
    });

    let sourceFileId: string | null = null;
    const who = await whoAmI();

    await withTransaction(async (client) => {
      sourceFileId = await InvoicePriceControlRepository.insertPriceListFile({
        originalName: file.name,
        mimeType: file.type || null,
        sizeBytes: buffer.byteLength,
        fileData: buffer,
        uploadedBy: who.userId,
      }, client);

      for (const parsedRow of parsedRows) {
        await InvoicePriceControlRepository.insertInvoiceItemWithComparison(client, invoiceId, invoice.factoryId, invoice.invoiceDate, {
          ...parsedRow,
          sourceFileId,
        });
      }
      await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
    });

    void logInvoiceAudit({
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "items_update",
      after: { imported: parsedRows.length, errors, sourceFileId },
    });

    return { sourceFileId, imported: parsedRows.length, errors };
  },

  listImportBatches(invoiceId: string) {
    return InvoicePriceControlRepository.queryImportBatches(invoiceId);
  },

  async getImportBatchDetail(invoiceId: string, sourceFileId: string) {
    const detail = await InvoicePriceControlRepository.queryImportBatchDetail(invoiceId, sourceFileId);
    if (!detail) throw new NotFoundError("Upload batch not found");
    return detail;
  },

  async deleteImportBatch(invoiceId: string, sourceFileId: string) {
    const result = await withTransaction(async (client) => {
      const invoiceNumber = await InvoicePriceControlRepository.getInvoiceNumber(invoiceId, client);
      if (invoiceNumber === null) {
        return { notFound: true as const };
      }

      const originalName = await InvoicePriceControlRepository.getPriceListFileOriginalName(client, sourceFileId);
      const deletedRows = await InvoicePriceControlRepository.deleteInvoiceItemsBySourceFile(client, invoiceId, sourceFileId);
      if (deletedRows === 0) {
        return { notFound: true as const };
      }

      await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
      await InvoicePriceControlRepository.clearInvoiceAttachmentIfMatches(invoiceId, sourceFileId, client);
      await InvoicePriceControlRepository.deletePriceListFileIfOrphaned(client, sourceFileId);

      return { notFound: false as const, deletedRows, invoiceNumber, originalName };
    });

    if (result.notFound) throw new NotFoundError("Upload batch not found");

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId,
      invoiceNumber: result.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "items_update",
      after: { deletedImportSourceFileId: sourceFileId, originalName: result.originalName, deletedRows: result.deletedRows },
    });

    return { deletedRows: result.deletedRows };
  },

  async editInvoiceItem(invoiceId: string, itemId: string, edit: InvoiceItemEdit) {
    const owner = await InvoicePriceControlRepository.assertItemBelongsToInvoice(invoiceId, itemId);
    if (!owner) throw new NotFoundError("Invoice item not found");

    const who = await whoAmI();

    if (edit.kind === "line") {
      await withTransaction(async (client) => {
        await InvoicePriceControlRepository.updateInvoiceItemLine(client, itemId, edit.sku, edit.qty, edit.unitPrice);
        await InvoicePriceControlRepository.recompareInvoiceItems(client, invoiceId);
        await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
      });

      void logInvoiceAudit({
        invoiceId,
        invoiceNumber: owner.invoiceNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "items_update",
        before: { itemId, sku: owner.sku, qty: Number(owner.qty), unitPrice: Number(owner.invoiceUnitPrice) },
        after: { itemId, sku: edit.sku, qty: edit.qty, unitPrice: edit.unitPrice },
      });
      return;
    }

    if (edit.kind === "credit") {
      await InvoicePriceControlRepository.updateInvoiceItemCredit(itemId, edit.creditStatus, who.displayName);

      void logInvoiceAudit({
        invoiceId,
        invoiceNumber: owner.invoiceNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "credit_update",
        before: { itemId, creditStatus: owner.creditStatus },
        after: { itemId, creditStatus: edit.creditStatus },
      });
      return;
    }

    // edit.kind === "confirm"
    await InvoicePriceControlRepository.updateInvoiceItemFactoryConfirm(itemId, edit.action, who.displayName);

    void logInvoiceAudit({
      invoiceId,
      invoiceNumber: owner.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "factory_confirm_update",
      before: {
        itemId,
        requestedAt: owner.factoryConfirmRequestedAt?.toISOString() ?? null,
        confirmedAt: owner.factoryConfirmConfirmedAt?.toISOString() ?? null,
      },
      after: { itemId, action: edit.action },
    });
  },

  async removeInvoiceItem(invoiceId: string, itemId: string) {
    const owner = await InvoicePriceControlRepository.assertItemBelongsToInvoice(invoiceId, itemId);
    if (!owner) throw new NotFoundError("Invoice item not found");

    await withTransaction(async (client) => {
      await InvoicePriceControlRepository.deleteInvoiceItem(client, itemId);
      await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
    });

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId,
      invoiceNumber: owner.invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "items_update",
      before: { itemId, sku: owner.sku, qty: Number(owner.qty), unitPrice: Number(owner.invoiceUnitPrice), creditStatus: owner.creditStatus },
      after: { removedItemId: itemId },
    });
  },

  // ───────────────────────────────────────────────────────────────────────
  // Recompare & attachment
  // ───────────────────────────────────────────────────────────────────────

  async recompareInvoice(invoiceId: string) {
    const invoiceNumber = await InvoicePriceControlRepository.getInvoiceNumber(invoiceId);
    if (invoiceNumber === null) throw new NotFoundError("Invoice not found");

    const who = await whoAmI();
    await withTransaction(async (client) => {
      await InvoicePriceControlRepository.recompareInvoiceItems(client, invoiceId);
      await InvoicePriceControlRepository.recalculateInvoiceStatus(client, invoiceId);
      await InvoicePriceControlRepository.updateInvoiceLastComparedAt(invoiceId, who.displayName, client);
    });

    void logInvoiceAudit({
      invoiceId,
      invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "recompare",
    });
  },

  async uploadAttachment(invoiceId: string, file: File, isSigned: boolean) {
    const invoiceNumber = await InvoicePriceControlRepository.getInvoiceNumber(invoiceId);
    if (invoiceNumber === null) throw new NotFoundError("Invoice not found");

    const who = await whoAmI();
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileId = await InvoicePriceControlRepository.insertPriceListFile(
      { originalName: file.name, mimeType: file.type || null, sizeBytes: buffer.byteLength, fileData: buffer, uploadedBy: who.userId },
    );

    const column = isSigned ? "signed_attachment_file_id" : "attachment_file_id";
    await InvoicePriceControlRepository.updateInvoiceAttachment(invoiceId, column, fileId);

    void logInvoiceAudit({
      invoiceId,
      invoiceNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "attachment_update",
      after: { fileId, signed: isSigned },
    });

    return { fileId };
  },

  findPriceListFile(id: string) {
    return InvoicePriceControlRepository.getPriceListFile(id);
  },

  // ───────────────────────────────────────────────────────────────────────
  // Credit notes
  // ───────────────────────────────────────────────────────────────────────

  async listCreditNotes(query: { factoryId: string; search: string; statusCsv: string }) {
    const statuses = query.statusCsv ? query.statusCsv.split(",").filter(Boolean) : [];

    try {
      const [rows, summaryRows] = await Promise.all([
        InvoicePriceControlRepository.queryCreditNoteList({ factoryId: query.factoryId, search: query.search, statuses }),
        InvoicePriceControlRepository.queryCreditNoteStatusSummary(),
      ]);

      const summary = { pending: { count: 0, amount: 0 }, confirmed: { count: 0, amount: 0 }, applied: { count: 0, amount: 0 } };
      for (const row of summaryRows) {
        const key = row.status as keyof typeof summary;
        if (summary[key]) summary[key] = { count: row.count, amount: row.amount };
      }

      return { creditNotes: rows.map(rowToCreditNote), summary };
    } catch (error) {
      console.error("Failed to load credit notes", error);
      throw new Error("Credit 목록을 불러오지 못했습니다.");
    }
  },

  async createCreditNote(input: {
    sourceInvoiceId: string;
    sku: string;
    expectedUnitPrice?: number | null;
    invoiceUnitPrice: number;
    qty: number;
    creditAmount?: number;
    note?: string;
  }) {
    const invoice = await InvoicePriceControlRepository.getInvoiceForCreditNote(input.sourceInvoiceId);
    if (!invoice) throw new NotFoundError("원본 Invoice를 찾을 수 없습니다.");

    const creditAmount = input.creditAmount ?? (
      input.expectedUnitPrice != null
        ? Number((input.qty * (input.invoiceUnitPrice - input.expectedUnitPrice)).toFixed(4))
        : null
    );
    if (creditAmount == null) {
      throw new ValidationError("Expected Price가 없으면 Credit Amount를 직접 입력해야 합니다.");
    }

    const who = await whoAmI();
    const id = await InvoicePriceControlRepository.createCreditNote({
      factoryId: invoice.factoryId,
      containerId: invoice.containerId,
      containerNumber: invoice.containerNumber,
      sourceInvoiceId: input.sourceInvoiceId,
      sku: input.sku,
      expectedUnitPrice: input.expectedUnitPrice ?? null,
      invoiceUnitPrice: input.invoiceUnitPrice,
      qty: input.qty,
      creditAmount,
      note: input.note || null,
      createdBy: who.userId,
    });

    void logInvoiceAudit({
      invoiceId: input.sourceInvoiceId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "credit_note_create",
      after: { creditNoteId: id, sku: input.sku, creditAmount, source: "manual" },
    });

    return { id };
  },

  async assertCreditNoteExists(id: string): Promise<void> {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");
  },

  async confirmCreditNote(id: string) {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");
    if (existing.status !== "pending") throw new ValidationError("Pending 상태의 Credit만 확인 처리할 수 있습니다.");

    await InvoicePriceControlRepository.confirmCreditNote(id);

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: existing.sourceInvoiceId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "credit_note_status_change",
      before: { status: existing.status },
      after: { status: "confirmed", creditNoteId: id, sku: existing.sku },
    });
  },

  async applyCreditNote(id: string, appliedInvoiceId: string, appliedDate: string) {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");
    if (existing.status !== "confirmed") throw new ValidationError("Confirmed 상태의 Credit만 적용할 수 있습니다.");

    const invoiceNumber = await InvoicePriceControlRepository.getInvoiceNumber(appliedInvoiceId);
    if (invoiceNumber === null) throw new NotFoundError("적용할 Invoice를 찾을 수 없습니다.");

    await InvoicePriceControlRepository.applyCreditNote(id, appliedInvoiceId, appliedDate);

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: existing.sourceInvoiceId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "credit_note_status_change",
      before: { status: existing.status },
      after: { status: "applied", creditNoteId: id, sku: existing.sku, appliedInvoiceNumber: invoiceNumber, appliedDate },
    });
  },

  async revertCreditNote(id: string) {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");

    const who = await whoAmI();

    if (existing.status === "applied") {
      await InvoicePriceControlRepository.revertCreditNoteFromApplied(id);
      void logInvoiceAudit({
        invoiceId: existing.sourceInvoiceId,
        userId: who.userId,
        userName: who.displayName,
        userEmail: who.userEmail,
        action: "credit_note_status_change",
        before: { status: existing.status },
        after: { status: "confirmed", reverted: true, creditNoteId: id, sku: existing.sku },
      });
      return;
    }

    if (existing.status === "confirmed") {
      await InvoicePriceControlRepository.revertCreditNoteFromConfirmed(id);
      void logInvoiceAudit({
        invoiceId: existing.sourceInvoiceId,
        userId: who.userId,
        userName: who.displayName,
        userEmail: who.userEmail,
        action: "credit_note_status_change",
        before: { status: existing.status },
        after: { status: "pending", reverted: true, creditNoteId: id, sku: existing.sku },
      });
      return;
    }

    throw new ValidationError("Pending 상태는 되돌릴 수 없습니다.");
  },

  async editCreditNote(id: string, edits: { creditAmount?: number; note?: string }) {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");

    await InvoicePriceControlRepository.editCreditNote(id, edits);

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: existing.sourceInvoiceId,
      userId: who.userId,
      userName: who.displayName,
      userEmail: who.userEmail,
      action: "credit_note_status_change",
      after: { creditNoteId: id, sku: existing.sku, ...edits },
    });
  },

  async deleteCreditNote(id: string) {
    const existing = await InvoicePriceControlRepository.getCreditNoteForUpdate(id);
    if (!existing) throw new NotFoundError("Credit 레코드를 찾을 수 없습니다.");

    await InvoicePriceControlRepository.deleteCreditNote(id);

    const who = await whoAmI();
    void logInvoiceAudit({
      invoiceId: existing.sourceInvoiceId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "credit_note_status_change",
      before: { status: existing.status },
      after: { deleted: true, creditNoteId: id, sku: existing.sku },
    });
  },

  async bulkCreateCreditNotes(itemIds: string[]) {
    const items = await InvoicePriceControlRepository.queryOverchargedItemsForBulk(itemIds);
    if (items.length === 0) throw new ValidationError("과청구(overcharged) 라인이 없습니다.");

    const who = await whoAmI();
    let created = 0;
    let skipped = 0;

    for (const row of items) {
      const creditAmount = row.qty * (row.diffUnitPrice ?? 0);
      const id = await InvoicePriceControlRepository.insertBulkCreditNote({
        factoryId: row.factoryId,
        containerId: row.containerId,
        containerNumber: row.containerNumber,
        sourceInvoiceId: row.invoiceId,
        sourceInvoiceItemId: row.itemId,
        sku: row.sku,
        expectedUnitPrice: row.expectedUnitPrice,
        invoiceUnitPrice: row.invoiceUnitPrice,
        qty: row.qty,
        creditAmount,
        createdBy: who.displayName,
      });

      if (id) {
        created += 1;
        void logInvoiceAudit({
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          userId: who.userId,
          userName: who.userName,
          userEmail: who.userEmail,
          action: "credit_note_create",
          after: { creditNoteId: id, sku: row.sku, creditAmount, source: "bulk_export" },
        });
      } else {
        skipped += 1;
      }
    }

    return { created, skipped };
  },

  // ───────────────────────────────────────────────────────────────────────
  // SKU price history
  // ───────────────────────────────────────────────────────────────────────

  async getFactoriesForPriceHistory(activeOnly: boolean) {
    const factories = await FactoriesRepository.listFactories({ active: activeOnly ? true : null, search: "" });
    return factories.map((row) => ({
      id: row.id,
      factoryCode: row.factory_code,
      factoryName: row.factory_name,
    }));
  },

  async getPriceHistoryFiles(factoryId: string) {
    const rows = await InvoicePriceControlRepository.queryPriceHistoryFilesMode(factoryId);
    return rows.map(rowToSourceFile);
  },

  async getPriceHistoryList(filter: { factoryId: string; sku: string; asOfDate: string; sourceFileId: string; currentOnly: boolean }) {
    const rows = await InvoicePriceControlRepository.queryPriceHistoryList(filter);
    return rows.map(rowToPrice);
  },

  async createPriceHistory(input: { factoryId: string; sku: string; effectiveDate: string; unitPrice: number; currency: string; reason?: string }) {
    const who = await whoAmI();
    const id = await InvoicePriceControlRepository.createPriceHistory({
      factoryId: input.factoryId,
      sku: input.sku,
      effectiveDate: input.effectiveDate,
      unitPrice: input.unitPrice,
      currency: input.currency,
      reason: input.reason || null,
      createdBy: who.userId,
    });
    if (!id) {
      throw new ConflictError("같은 공장, SKU, 적용일의 가격 이력이 이미 있습니다. 기존 row를 선택해서 수정하거나 적용일을 다르게 입력하세요.");
    }
    return { id };
  },

  async updatePriceHistory(id: string, input: { factoryId: string; sku: string; effectiveDate: string; unitPrice: number; currency: string; reason?: string }) {
    const updatedId = await InvoicePriceControlRepository.updatePriceHistory(id, {
      factoryId: input.factoryId,
      sku: input.sku,
      effectiveDate: input.effectiveDate,
      unitPrice: input.unitPrice,
      currency: input.currency,
      reason: input.reason || null,
    });
    if (!updatedId) throw new NotFoundError("Price history not found");
  },

  async deletePriceHistory(query: { sourceFileId?: string; ids?: string[]; id?: string }) {
    if (query.sourceFileId) {
      const { deletedRows, fileDeleted } = await InvoicePriceControlRepository.deletePriceHistoryBatch(query.sourceFileId);
      if (!fileDeleted) throw new NotFoundError("Source file not found");
      return { deletedRows };
    }

    if (query.ids && query.ids.length > 0) {
      const deletedRows = await InvoicePriceControlRepository.deletePriceHistoryByIds(query.ids);
      return { deletedRows };
    }

    if (!query.id) throw new ValidationError("id is required");
    const deletedRows = await InvoicePriceControlRepository.deletePriceHistoryById(query.id);
    if (deletedRows === 0) throw new NotFoundError("Price history not found");
    return null;
  },

  async importPriceHistoryExcel(file: File, fallbackFactoryId: string, fallbackEffectiveDate: string, fallbackReason: string) {
    if (!DATE_RE.test(fallbackEffectiveDate)) {
      throw new ValidationError("effectiveDate is required");
    }

    const currency = "USD";
    const who = await whoAmI();
    const buffer = Buffer.from(await file.arrayBuffer());

    return withTransaction(async (client) => {
      const sourceFileId = await InvoicePriceControlRepository.insertPriceListFile({
        originalName: file.name,
        mimeType: file.type || null,
        sizeBytes: buffer.byteLength,
        fileData: buffer,
        uploadedBy: who.userId,
      }, client);

      const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      if (!isExcel) {
        return { sourceFileId, imported: 0, errors: [] as string[] };
      }

      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const errors: string[] = [];
      let created = 0;
      let updated = 0;

      for (const [index, row] of rows.entries()) {
        const rowNo = index + 2;
        const sku = String(pickValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
        const effectiveDate = fallbackEffectiveDate;
        const rawPrice = pickValue(row, ["unit_price", "unit price", "price", "cost"]);
        const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));
        const factoryId = fallbackFactoryId;
        const reason = String(pickValue(row, ["reason", "note", "memo"]) ?? fallbackReason).trim();

        if (!sku || !effectiveDate || !Number.isFinite(unitPrice) || unitPrice < 0 || !factoryId) {
          errors.push(`Row ${rowNo}: sku, selected effective date, unit_price, selected factory are required`);
          continue;
        }

        const existed = await InvoicePriceControlRepository.findExistingPriceHistoryRow(client, factoryId, sku, effectiveDate);
        await InvoicePriceControlRepository.upsertPriceHistoryRow(client, {
          factoryId, sku, effectiveDate, unitPrice, currency, reason: reason || null, sourceFileId, createdBy: who.userId,
        });
        if (existed) updated += 1;
        else created += 1;
      }

      return { sourceFileId, imported: created + updated, created, updated, skipped: errors.length, errors };
    });
  },
};

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function rowToCreditNote(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    factoryId: String(row.factory_id),
    factoryName: row.factory_name as string,
    containerNumber: row.container_number as string | null,
    sourceInvoiceId: String(row.source_invoice_id),
    sourceInvoiceNumber: row.source_invoice_number as string,
    sourceInvoiceItemId: row.source_invoice_item_id == null ? null : String(row.source_invoice_item_id),
    sku: row.sku as string,
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    invoiceUnitPrice: Number(row.invoice_unit_price),
    qty: Number(row.qty),
    creditAmount: Number(row.credit_amount),
    status: row.status as string,
    appliedInvoiceId: row.applied_invoice_id == null ? null : String(row.applied_invoice_id),
    appliedInvoiceNumber: row.applied_invoice_number as string | null,
    appliedDate: serializeDate(row.applied_date),
    note: row.note as string | null,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string).toISOString() : null,
    appliedAt: row.applied_at ? new Date(row.applied_at as string).toISOString() : null,
    createdBy: row.created_by as string | null,
  };
}

function rowToSourceFile(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    originalName: row.original_name as string,
    mimeType: row.mime_type as string | null,
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedBy: row.uploaded_by_display as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rowCount: Number(row.row_count ?? 0),
    factoryCount: Number(row.factory_count ?? 0),
    skuCount: Number(row.sku_count ?? 0),
    factoryIds: row.factory_ids ? String(row.factory_ids).split(",").filter(Boolean) : [],
    factoryNames: row.factory_names as string | null,
    firstEffectiveDate: serializeDate(row.first_effective_date),
    lastEffectiveDate: serializeDate(row.last_effective_date),
  };
}

function rowToPrice(row: Record<string, unknown>) {
  const unitPrice = Number(row.unit_price ?? 0);
  const previousPrice = row.previous_price == null ? null : Number(row.previous_price);
  const changeAmount = previousPrice == null ? null : unitPrice - previousPrice;
  const changeRate = previousPrice == null || previousPrice === 0 ? null : (changeAmount! / previousPrice) * 100;

  return {
    id: String(row.id),
    factoryId: String(row.factory_id),
    factoryName: row.factory_name as string,
    sku: row.sku as string,
    effectiveDate: serializeDate(row.effective_date),
    unitPrice,
    currency: row.currency as string,
    reason: row.reason as string | null,
    sourceFileId: row.source_file_id == null ? null : String(row.source_file_id),
    sourceFileName: row.source_file_name as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    previousPrice,
    changeAmount,
    changeRate,
    invoiceReferenceCount: Number(row.invoice_reference_count ?? 0),
    invoiceReferenceInvoiceCount: Number(row.invoice_reference_invoice_count ?? 0),
  };
}
