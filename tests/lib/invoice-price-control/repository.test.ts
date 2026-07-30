import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { InvoicePriceControlRepository, withTransaction } = await import("@/lib/invoice-price-control/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withTransaction", () => {
  it("commits on success", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    const result = await withTransaction(async (client) => {
      await client.query("SELECT 1");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(clientQueryMock).toHaveBeenCalledWith("BEGIN");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it("rolls back and rethrows on failure", async () => {
    clientQueryMock.mockResolvedValueOnce(undefined); // BEGIN
    await expect(
      withTransaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});

describe("InvoicePriceControlRepository.queryInvoiceList", () => {
  it("builds filters for search/factoryId/statuses", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await InvoicePriceControlRepository.queryInvoiceList({ search: "abc", factoryId: "1", statuses: ["received", "price_review"] });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("i.invoice_number ILIKE $1");
    expect(sql).toContain("i.factory_id = $2::bigint");
    expect(sql).toContain("i.status::text = ANY($3::text[])");
    expect(params).toEqual(["%abc%", "1", ["received", "price_review"]]);
  });

  it("maps rows to the list shape", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ id: "1", invoice_number: "INV-1", invoice_date: "2026-01-01", status: "received", factory_name: "F1", container_number: "C1", error_count: 2, invoice_price_total: "100.5" }],
    });
    const rows = await InvoicePriceControlRepository.queryInvoiceList({ search: "", factoryId: "", statuses: [] });
    expect(rows[0]).toEqual({
      id: "1", invoiceNumber: "INV-1", invoiceDate: "2026-01-01", status: "received",
      factoryName: "F1", containerNumber: "C1", errorCount: 2, invoicePriceTotal: 100.5,
    });
  });
});

describe("InvoicePriceControlRepository.createInvoice", () => {
  it("inserts and returns the new id", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "42" }] });
    const id = await InvoicePriceControlRepository.createInvoice({
      invoiceNumber: "INV-1", factoryId: "1", containerId: null, containerNumber: null,
      invoiceDate: "2026-01-01", note: null, createdBy: "u1",
    });
    expect(id).toBe("42");
    expect(poolQueryMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO shipcore.fc_invoices"), [
      "INV-1", "1", null, null, "2026-01-01", null, "u1",
    ]);
  });
});

describe("InvoicePriceControlRepository.updateInvoiceStatus", () => {
  it("returns null when no row matched", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const result = await InvoicePriceControlRepository.updateInvoiceStatus("1", "signed", true, "Alice");
    expect(result).toBeNull();
  });

  it("returns the id when updated", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "1" }] });
    const result = await InvoicePriceControlRepository.updateInvoiceStatus("1", "approved", false, null);
    expect(result).toBe("1");
  });
});

describe("InvoicePriceControlRepository.loadInvoiceDetail", () => {
  it("returns null when the header query has no rows", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await InvoicePriceControlRepository.loadInvoiceDetail("1")).toBeNull();
  });

  it("combines header, items, and applied credits", async () => {
    poolQueryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: "1", invoice_number: "INV-1", factory_id: "5", factory_name: "F1", container_id: null,
          container_number: null, invoice_date: "2026-01-01", status: "received", attachment_file_id: null,
          signed_attachment_file_id: null, signed_by: null, signed_at: null, last_compared_at: null, note: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "10", sku: "SKU-1", qty: 2, invoice_unit_price: "5.00", expected_unit_price: null, expected_effective_date: null, diff_unit_price: null, result: "no_price_history", credit_status: null, credit_amount: null, factory_confirm_requested_at: null, factory_confirm_confirmed_at: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const detail = await InvoicePriceControlRepository.loadInvoiceDetail("1");
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0]).toMatchObject({ id: "10", sku: "SKU-1", qty: 2, invoiceUnitPrice: 5 });
    expect(detail?.appliedCredits).toEqual([]);
  });
});

describe("InvoicePriceControlRepository.insertBulkCreditNote", () => {
  it("returns the id when inserted", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "7" }] });
    const id = await InvoicePriceControlRepository.insertBulkCreditNote({
      factoryId: "1", containerId: null, containerNumber: null, sourceInvoiceId: "1", sourceInvoiceItemId: "2",
      sku: "SKU-1", expectedUnitPrice: 5, invoiceUnitPrice: 8, qty: 1, creditAmount: 3, createdBy: "Alice",
    });
    expect(id).toBe("7");
  });

  it("returns null when the conflict clause skips the insert", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const id = await InvoicePriceControlRepository.insertBulkCreditNote({
      factoryId: "1", containerId: null, containerNumber: null, sourceInvoiceId: "1", sourceInvoiceItemId: "2",
      sku: "SKU-1", expectedUnitPrice: 5, invoiceUnitPrice: 8, qty: 1, creditAmount: 3, createdBy: "Alice",
    });
    expect(id).toBeNull();
  });
});

describe("InvoicePriceControlRepository.createPriceHistory / updatePriceHistory", () => {
  it("createPriceHistory returns null on ON CONFLICT DO NOTHING", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const id = await InvoicePriceControlRepository.createPriceHistory({
      factoryId: "1", sku: "SKU-1", effectiveDate: "2026-01-01", unitPrice: 5, currency: "USD", reason: null, createdBy: null,
    });
    expect(id).toBeNull();
  });

  it("updatePriceHistory returns null when not found", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const id = await InvoicePriceControlRepository.updatePriceHistory("1", {
      factoryId: "1", sku: "SKU-1", effectiveDate: "2026-01-01", unitPrice: 5, currency: "USD", reason: null,
    });
    expect(id).toBeNull();
  });
});

describe("InvoicePriceControlRepository.deletePriceHistoryBatch", () => {
  it("deletes history rows and the file within one transaction", async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 3 }) // delete history rows
      .mockResolvedValueOnce({ rowCount: 1 }) // delete file
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await InvoicePriceControlRepository.deletePriceHistoryBatch("9");
    expect(result).toEqual({ deletedRows: 3, fileDeleted: true });
  });

  it("reports fileDeleted=false when the file row didn't exist", async () => {
    clientQueryMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    const result = await InvoicePriceControlRepository.deletePriceHistoryBatch("missing");
    expect(result).toEqual({ deletedRows: 0, fileDeleted: false });
  });
});

describe("InvoicePriceControlRepository.insertInvoiceItemWithComparison", () => {
  it("passes through the comparison result from the query", async () => {
    clientQueryMock.mockResolvedValue({
      rows: [{ id: "1", expected_unit_price: "5.00", diff_unit_price: "1.00", result: "overcharged" }],
    });
    const result = await InvoicePriceControlRepository.insertInvoiceItemWithComparison(
      { query: clientQueryMock } as never, "1", "5", "2026-01-01", { sku: "sku-1", qty: 2, unitPrice: 6 },
    );
    expect(result).toEqual({ id: "1", expectedUnitPrice: 5, diffUnitPrice: 1, result: "overcharged" });
  });
});
