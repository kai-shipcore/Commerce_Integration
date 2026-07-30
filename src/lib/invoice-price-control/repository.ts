/**
 * Pure data access for Invoice Review, Credit Notes, and SKU Price History
 * (shipcore.fc_invoices / fc_invoice_items / fc_credit_notes /
 * fc_sku_price_history / fc_price_list_files on the primary DB).
 *
 * These three areas are grouped in one repository because they're coupled at
 * the SQL level (price history is joined into invoice items and vice versa),
 * not because they're the same table. Business logic (bucket counts, credit
 * amount rules, Excel parsing, audit logging) lives in
 * src/lib/invoice-price-control/service.ts — this file only runs queries.
 *
 * Several methods accept an optional `executor` (defaults to the shared
 * pool) so the Service can compose multiple calls into one transaction via
 * `withTransaction()` — e.g. insert item + recalculate invoice status.
 */

import type { Pool, PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";

export type SqlExecutor = Pick<Pool, "query">;

function pool(): SqlExecutor {
  return getPrimaryPool();
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────────

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  status: string;
  factoryName: string;
  containerNumber: string | null;
  errorCount: number;
  invoicePriceTotal: number;
}

export interface InvoiceListFilter {
  search: string;
  factoryId: string;
  statuses: string[];
}

export interface CreateInvoiceInput {
  invoiceNumber: string;
  factoryId: string;
  containerId: string | null;
  containerNumber: string | null;
  invoiceDate: string;
  note: string | null;
  createdBy: string | null;
}

export interface ExistingInvoiceRow {
  status: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  containerId: string | null;
  containerNumber: string | null;
  note: string | null;
}

export interface InvoiceDetailsInput {
  invoiceNumber: string;
  invoiceDate: string;
  containerId: string | null;
  containerNumber: string | null;
  note: string | null;
}

export interface InvoiceSummary {
  invoiceNumber: string;
  factoryId: string;
  invoiceDate: string;
}

export interface InvoiceItemDetail {
  id: string;
  sku: string;
  qty: number;
  invoiceUnitPrice: number;
  expectedUnitPrice: number | null;
  expectedEffectiveDate: string | null;
  diffUnitPrice: number | null;
  result: string;
  creditStatus: string | null;
  creditAmount: number | null;
  factoryConfirmRequestedAt: string | null;
  factoryConfirmConfirmedAt: string | null;
}

export interface AppliedCreditDetail {
  id: string;
  sourceInvoiceId: string | null;
  sourceInvoiceNumber: string | null;
  containerNumber: string | null;
  sku: string;
  expectedUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  qty: number;
  creditAmount: number;
  appliedDate: string | null;
  note: string | null;
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  factoryId: string;
  factoryName: string;
  containerId: string | null;
  containerNumber: string | null;
  invoiceDate: string | null;
  status: string;
  attachmentFileId: string | null;
  signedAttachmentFileId: string | null;
  signedBy: string | null;
  signedAt: string | null;
  lastComparedAt: string | null;
  note: string | null;
  items: InvoiceItemDetail[];
  appliedCredits: AppliedCreditDetail[];
}

function rowToInvoiceItemDetail(row: Record<string, unknown>): InvoiceItemDetail {
  return {
    id: String(row.id),
    sku: row.sku as string,
    qty: Number(row.qty),
    invoiceUnitPrice: Number(row.invoice_unit_price),
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    expectedEffectiveDate: serializeDate(row.expected_effective_date),
    diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
    result: row.result as string,
    creditStatus: row.credit_status as string | null,
    creditAmount: row.credit_amount == null ? null : Number(row.credit_amount),
    factoryConfirmRequestedAt: toIso(row.factory_confirm_requested_at),
    factoryConfirmConfirmedAt: toIso(row.factory_confirm_confirmed_at),
  };
}

function rowToAppliedCreditDetail(row: Record<string, unknown>): AppliedCreditDetail {
  return {
    id: String(row.id),
    sourceInvoiceId: row.source_invoice_id == null ? null : String(row.source_invoice_id),
    sourceInvoiceNumber: row.source_invoice_number as string | null,
    containerNumber: row.container_number as string | null,
    sku: row.sku as string,
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    invoiceUnitPrice: row.invoice_unit_price == null ? null : Number(row.invoice_unit_price),
    qty: Number(row.qty),
    creditAmount: Number(row.credit_amount),
    appliedDate: serializeDate(row.applied_date),
    note: row.note as string | null,
  };
}

export const InvoicePriceControlRepository = {
  async queryInvoiceList(filter: InvoiceListFilter): Promise<InvoiceListRow[]> {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (filter.search) {
      params.push(`%${filter.search}%`);
      filters.push(`(i.invoice_number ILIKE $${params.length} OR f.factory_name ILIKE $${params.length} OR i.container_number ILIKE $${params.length})`);
    }
    if (filter.factoryId) {
      params.push(filter.factoryId);
      filters.push(`i.factory_id = $${params.length}::bigint`);
    }
    if (filter.statuses.length > 0) {
      params.push(filter.statuses);
      filters.push(`i.status::text = ANY($${params.length}::text[])`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool().query(
      `SELECT
         i.id::text AS id,
         i.invoice_number,
         i.invoice_date::text AS invoice_date,
         i.status::text AS status,
         f.factory_name,
         i.container_number,
         COALESCE(err.error_count, 0)::int AS error_count,
         COALESCE(totals.invoice_price_total, 0) AS invoice_price_total
       FROM shipcore.fc_invoices i
       JOIN shipcore.fc_factories f ON f.id = i.factory_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS error_count
         FROM shipcore.fc_invoice_items ii
         WHERE ii.invoice_id = i.id AND ii.result IN ('price_error', 'overcharged')
       ) err ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(ii.qty * ii.invoice_unit_price) AS invoice_price_total
         FROM shipcore.fc_invoice_items ii
         WHERE ii.invoice_id = i.id
       ) totals ON TRUE
       ${where}
       ORDER BY i.invoice_date DESC, i.id DESC
       LIMIT 500`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      invoiceNumber: row.invoice_number as string,
      invoiceDate: serializeDate(row.invoice_date),
      status: row.status as string,
      factoryName: row.factory_name as string,
      containerNumber: row.container_number as string | null,
      errorCount: row.error_count as number,
      invoicePriceTotal: Number(row.invoice_price_total),
    }));
  },

  async queryInvoiceStatusCounts(): Promise<Array<{ status: string; count: number }>> {
    const result = await pool().query<{ status: string; count: number }>(
      `SELECT status::text AS status, COUNT(*)::int AS count
       FROM shipcore.fc_invoices
       GROUP BY status`,
    );
    return result.rows;
  },

  async createInvoice(input: CreateInvoiceInput): Promise<string> {
    const result = await pool().query<{ id: string }>(
      `INSERT INTO shipcore.fc_invoices
         (invoice_number, factory_id, container_id, container_number, invoice_date, status, note, created_by, created_at, updated_at)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5::date, 'price_review', $6, $7, NOW(), NOW())
       RETURNING id::text AS id`,
      [
        input.invoiceNumber,
        input.factoryId,
        input.containerId,
        input.containerNumber,
        input.invoiceDate,
        input.note,
        input.createdBy,
      ],
    );
    return result.rows[0].id;
  },

  async getInvoiceForUpdate(id: string): Promise<ExistingInvoiceRow | null> {
    const result = await pool().query(
      `SELECT
         status::text AS status,
         invoice_number,
         invoice_date::text AS invoice_date,
         container_id::text AS container_id,
         container_number,
         note
       FROM shipcore.fc_invoices
       WHERE id = $1::bigint`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      status: row.status,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      containerId: row.container_id,
      containerNumber: row.container_number,
      note: row.note,
    };
  },

  async updateInvoiceStatus(id: string, status: string, isSigning: boolean, signedByName: string | null): Promise<string | null> {
    const result = await pool().query<{ id: string }>(
      `UPDATE shipcore.fc_invoices
       SET status = $2::shipcore.fc_invoice_status,
           signed_by = CASE WHEN $3::boolean THEN $4 ELSE signed_by END,
           signed_at = CASE WHEN $3::boolean THEN NOW() ELSE signed_at END,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, status, isSigning, signedByName],
    );
    return result.rowCount === 0 ? null : id;
  },

  async updateInvoiceDetails(id: string, details: InvoiceDetailsInput): Promise<string | null> {
    const result = await pool().query<{ id: string }>(
      `UPDATE shipcore.fc_invoices
       SET invoice_number = $2,
           invoice_date = $3::date,
           container_id = $4::bigint,
           container_number = $5,
           note = $6,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, details.invoiceNumber, details.invoiceDate, details.containerId, details.containerNumber, details.note],
    );
    return result.rowCount === 0 ? null : id;
  },

  async getInvoiceNumber(id: string, executor: SqlExecutor = pool()): Promise<string | null> {
    const result = await executor.query<{ invoice_number: string }>(
      `SELECT invoice_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    return result.rows[0]?.invoice_number ?? null;
  },

  async getInvoiceSummary(id: string, executor: SqlExecutor = pool()): Promise<InvoiceSummary | null> {
    const result = await executor.query(
      `SELECT invoice_number, factory_id::text AS factory_id, invoice_date::text AS invoice_date
       FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { invoiceNumber: row.invoice_number, factoryId: row.factory_id, invoiceDate: row.invoice_date };
  },

  async deleteInvoice(id: string): Promise<void> {
    await pool().query(`DELETE FROM shipcore.fc_invoices WHERE id = $1::bigint`, [id]);
  },

  async loadInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
    const p = pool();
    const [headerResult, itemsResult, appliedCreditsResult] = await Promise.all([
      p.query(
        `SELECT
           i.id::text AS id,
           i.invoice_number,
           i.factory_id::text AS factory_id,
           f.factory_name,
           i.container_id::text AS container_id,
           i.container_number,
           i.invoice_date::text AS invoice_date,
           i.status::text AS status,
           i.attachment_file_id::text AS attachment_file_id,
           i.signed_attachment_file_id::text AS signed_attachment_file_id,
           i.signed_by,
           i.signed_at,
           i.last_compared_at,
           i.note
         FROM shipcore.fc_invoices i
         JOIN shipcore.fc_factories f ON f.id = i.factory_id
         WHERE i.id = $1::bigint`,
        [id],
      ),
      p.query(
        `SELECT * FROM shipcore.fc_invoice_items WHERE invoice_id = $1::bigint ORDER BY id ASC`,
        [id],
      ),
      p.query(
        `SELECT
           cn.id::text AS id,
           cn.source_invoice_id::text AS source_invoice_id,
           source.invoice_number AS source_invoice_number,
           cn.container_number,
           cn.sku,
           cn.expected_unit_price,
           cn.invoice_unit_price,
           cn.qty,
           cn.credit_amount,
           cn.applied_date::text AS applied_date,
           cn.note
         FROM shipcore.fc_credit_notes cn
         LEFT JOIN shipcore.fc_invoices source ON source.id = cn.source_invoice_id
         WHERE cn.applied_invoice_id = $1::bigint
           AND cn.status = 'applied'
         ORDER BY cn.applied_date DESC NULLS LAST, cn.id DESC`,
        [id],
      ),
    ]);

    if (headerResult.rowCount === 0) return null;
    const header = headerResult.rows[0];

    return {
      id: header.id as string,
      invoiceNumber: header.invoice_number as string,
      factoryId: header.factory_id as string,
      factoryName: header.factory_name as string,
      containerId: header.container_id as string | null,
      containerNumber: header.container_number as string | null,
      invoiceDate: serializeDate(header.invoice_date),
      status: header.status as string,
      attachmentFileId: header.attachment_file_id as string | null,
      signedAttachmentFileId: header.signed_attachment_file_id as string | null,
      signedBy: header.signed_by as string | null,
      signedAt: toIso(header.signed_at),
      lastComparedAt: toIso(header.last_compared_at),
      note: header.note as string | null,
      items: itemsResult.rows.map(rowToInvoiceItemDetail),
      appliedCredits: appliedCreditsResult.rows.map(rowToAppliedCreditDetail),
    };
  },

  async loadInvoiceForDocument(id: string): Promise<{
    header: { id: string; invoiceNumber: string; invoiceDate: string | null; factoryName: string; containerNumber: string | null };
    items: Array<{ sku: string; qty: number; unitPrice: number }>;
    credits: Array<{ sourceInvoiceNumber: string | null; sku: string; qty: number; invoiceUnitPrice: number | null; expectedUnitPrice: number | null; creditAmount: number; appliedDate: string | null }>;
  } | null> {
    const p = pool();
    const [headerResult, itemsResult, creditsResult] = await Promise.all([
      p.query(
        `SELECT
           i.id::text AS id,
           i.invoice_number,
           i.invoice_date::text AS invoice_date,
           i.container_number,
           f.factory_name
         FROM shipcore.fc_invoices i
         JOIN shipcore.fc_factories f ON f.id = i.factory_id
         WHERE i.id = $1::bigint`,
        [id],
      ),
      p.query(
        `SELECT sku, qty, invoice_unit_price
         FROM shipcore.fc_invoice_items
         WHERE invoice_id = $1::bigint
         ORDER BY id ASC`,
        [id],
      ),
      p.query(
        `SELECT
           source.invoice_number AS source_invoice_number,
           cn.sku,
           cn.qty,
           cn.invoice_unit_price,
           cn.expected_unit_price,
           cn.credit_amount,
           cn.applied_date::text AS applied_date
         FROM shipcore.fc_credit_notes cn
         LEFT JOIN shipcore.fc_invoices source ON source.id = cn.source_invoice_id
         WHERE cn.applied_invoice_id = $1::bigint
           AND cn.status = 'applied'
         ORDER BY cn.applied_date DESC NULLS LAST, cn.id ASC`,
        [id],
      ),
    ]);

    if (headerResult.rowCount === 0) return null;
    const headerRow = headerResult.rows[0];
    return {
      header: {
        id: headerRow.id as string,
        invoiceNumber: headerRow.invoice_number as string,
        invoiceDate: serializeDate(headerRow.invoice_date),
        factoryName: headerRow.factory_name as string,
        containerNumber: headerRow.container_number as string | null,
      },
      items: itemsResult.rows.map((row) => ({
        sku: row.sku as string,
        qty: Number(row.qty),
        unitPrice: Number(row.invoice_unit_price),
      })),
      credits: creditsResult.rows.map((row) => ({
        sourceInvoiceNumber: row.source_invoice_number as string | null,
        sku: row.sku as string,
        qty: Number(row.qty),
        invoiceUnitPrice: row.invoice_unit_price == null ? null : Number(row.invoice_unit_price),
        expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
        creditAmount: Number(row.credit_amount),
        appliedDate: serializeDate(row.applied_date),
      })),
    };
  },

  async updateInvoiceLastComparedAt(id: string, who: string | null, executor: SqlExecutor = pool()): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_invoices SET last_compared_at = NOW(), last_compared_by = $2, updated_at = NOW() WHERE id = $1::bigint`,
      [id, who],
    );
  },

  async updateInvoiceAttachment(id: string, column: "attachment_file_id" | "signed_attachment_file_id", fileId: string): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_invoices SET ${column} = $2::bigint, updated_at = NOW() WHERE id = $1::bigint`,
      [id, fileId],
    );
  },

  async clearInvoiceAttachmentIfMatches(id: string, fileId: string, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_invoices
       SET attachment_file_id = CASE WHEN attachment_file_id = $2::bigint THEN NULL ELSE attachment_file_id END,
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [id, fileId],
    );
  },

  // ───────────────────────────────────────────────────────────────────────
  // Invoice items (price comparison)
  // ───────────────────────────────────────────────────────────────────────

  async insertInvoiceItemWithComparison(
    executor: SqlExecutor,
    invoiceId: string,
    factoryId: string,
    invoiceDate: string,
    item: { sku: string; qty: number; unitPrice: number; sourceFileId?: string | null },
  ): Promise<{ id: string; expectedUnitPrice: number | null; diffUnitPrice: number | null; result: string }> {
    const result = await executor.query(
      `WITH expected AS (
         SELECT h.id AS price_history_id, h.unit_price AS expected_unit_price, h.effective_date AS expected_effective_date
         FROM shipcore.fc_sku_price_history h
         WHERE h.factory_id = $5::bigint
           AND h.sku = UPPER($2)
           AND h.effective_date <= $6::date
         ORDER BY h.effective_date DESC, h.id DESC
         LIMIT 1
       )
       INSERT INTO shipcore.fc_invoice_items (
         invoice_id, sku, qty, invoice_unit_price,
         expected_unit_price, expected_effective_date, price_history_id,
         diff_unit_price, result, source_file_id, created_at, updated_at
       )
       SELECT
         $1::bigint, UPPER($2), $3::int, $4::numeric,
         e.expected_unit_price, e.expected_effective_date, e.price_history_id,
         CASE WHEN e.expected_unit_price IS NULL THEN NULL ELSE ROUND(($4::numeric - e.expected_unit_price)::numeric, 2) END,
         (CASE
            WHEN e.expected_unit_price IS NULL THEN 'no_price_history'
            WHEN ROUND(($4::numeric - e.expected_unit_price)::numeric, 2) = 0 THEN 'match'
            WHEN ROUND(($4::numeric - e.expected_unit_price)::numeric, 2) < 0 THEN 'price_error'
            ELSE 'overcharged'
          END)::shipcore.fc_invoice_item_result,
         $7::bigint, NOW(), NOW()
       FROM (VALUES (1)) AS seed(x)
       LEFT JOIN expected e ON TRUE
       RETURNING id::text AS id, expected_unit_price, diff_unit_price, result`,
      [invoiceId, item.sku, item.qty, item.unitPrice, factoryId, invoiceDate, item.sourceFileId ?? null],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
      diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
      result: row.result,
    };
  },

  async recompareInvoiceItems(executor: SqlExecutor, invoiceId: string): Promise<void> {
    await executor.query(
      `WITH expected AS (
         SELECT
           i.id AS item_id,
           i.credit_status,
           i.invoice_unit_price,
           i.qty,
           h.id AS price_history_id,
           h.unit_price AS expected_unit_price,
           h.effective_date AS expected_effective_date
         FROM shipcore.fc_invoice_items i
         JOIN shipcore.fc_invoices inv ON inv.id = i.invoice_id
         LEFT JOIN LATERAL (
           SELECT h.id, h.unit_price, h.effective_date
           FROM shipcore.fc_sku_price_history h
           WHERE h.factory_id = inv.factory_id
             AND h.sku = i.sku
             AND h.effective_date <= inv.invoice_date
           ORDER BY h.effective_date DESC, h.id DESC
           LIMIT 1
         ) h ON TRUE
         WHERE i.invoice_id = $1::bigint
       )
       UPDATE shipcore.fc_invoice_items i
       SET expected_unit_price     = e.expected_unit_price,
           expected_effective_date = e.expected_effective_date,
           price_history_id        = e.price_history_id,
           diff_unit_price = CASE WHEN e.expected_unit_price IS NULL THEN NULL
                                  ELSE ROUND((e.invoice_unit_price - e.expected_unit_price)::numeric, 2) END,
           result = (CASE
               WHEN e.expected_unit_price IS NULL THEN 'no_price_history'
               WHEN ROUND((e.invoice_unit_price - e.expected_unit_price)::numeric, 2) = 0 THEN 'match'
               WHEN ROUND((e.invoice_unit_price - e.expected_unit_price)::numeric, 2) < 0 THEN 'price_error'
               ELSE 'overcharged'
             END)::shipcore.fc_invoice_item_result,
           credit_amount = CASE
               WHEN e.credit_status IS NOT NULL THEN i.credit_amount
               WHEN e.expected_unit_price IS NOT NULL AND ROUND((e.invoice_unit_price - e.expected_unit_price)::numeric, 2) > 0
                 THEN ROUND((e.invoice_unit_price - e.expected_unit_price)::numeric, 2) * e.qty
               ELSE NULL
             END,
           updated_at = NOW()
       FROM expected e
       WHERE i.id = e.item_id`,
      [invoiceId],
    );
  },

  async recalculateInvoiceStatus(executor: SqlExecutor, invoiceId: string): Promise<void> {
    const AUTO_MANAGED_STATUSES = ["received", "price_review", "discrepancy_found"];
    const current = await executor.query<{ status: string }>(
      `SELECT status FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [invoiceId],
    );
    const currentStatus = current.rows[0]?.status;
    if (!currentStatus || !AUTO_MANAGED_STATUSES.includes(currentStatus)) return;

    const nextStatus = "price_review";
    if (nextStatus !== currentStatus) {
      await executor.query(
        `UPDATE shipcore.fc_invoices SET status = $2::shipcore.fc_invoice_status, updated_at = NOW() WHERE id = $1::bigint`,
        [invoiceId, nextStatus],
      );
    }
  },

  async assertItemBelongsToInvoice(invoiceId: string, itemId: string): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    sku: string;
    qty: number;
    invoiceUnitPrice: string | number;
    creditStatus: string | null;
    factoryConfirmRequestedAt: Date | null;
    factoryConfirmConfirmedAt: Date | null;
  } | null> {
    const result = await pool().query(
      `SELECT
         i.invoice_id::text AS invoice_id,
         inv.invoice_number,
         i.sku,
         i.qty,
         i.invoice_unit_price,
         i.credit_status::text AS credit_status,
         i.factory_confirm_requested_at,
         i.factory_confirm_confirmed_at
       FROM shipcore.fc_invoice_items i
       JOIN shipcore.fc_invoices inv ON inv.id = i.invoice_id
       WHERE i.id = $1::bigint`,
      [itemId],
    );
    if (result.rowCount === 0 || result.rows[0].invoice_id !== invoiceId) return null;
    const row = result.rows[0];
    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      sku: row.sku,
      qty: row.qty,
      invoiceUnitPrice: row.invoice_unit_price,
      creditStatus: row.credit_status,
      factoryConfirmRequestedAt: row.factory_confirm_requested_at,
      factoryConfirmConfirmedAt: row.factory_confirm_confirmed_at,
    };
  },

  async updateInvoiceItemLine(executor: SqlExecutor, itemId: string, sku: string, qty: number, unitPrice: number): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_invoice_items
       SET sku = UPPER($2), qty = $3::int, invoice_unit_price = $4::numeric, updated_at = NOW()
       WHERE id = $1::bigint`,
      [itemId, sku, qty, unitPrice],
    );
  },

  async updateInvoiceItemCredit(itemId: string, creditStatus: string | null, updatedBy: string | null): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_invoice_items
       SET credit_status = $2,
           credit_updated_by = $3,
           credit_updated_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [itemId, creditStatus, updatedBy],
    );
  },

  async updateInvoiceItemFactoryConfirm(itemId: string, action: "request" | "confirm", who: string | null): Promise<void> {
    const column = action === "request"
      ? { by: "factory_confirm_requested_by", at: "factory_confirm_requested_at" }
      : { by: "factory_confirm_confirmed_by", at: "factory_confirm_confirmed_at" };

    await pool().query(
      `UPDATE shipcore.fc_invoice_items
       SET ${column.by} = $2, ${column.at} = NOW(), updated_at = NOW()
       WHERE id = $1::bigint`,
      [itemId, who],
    );
  },

  async deleteInvoiceItem(executor: SqlExecutor, itemId: string): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_invoice_items WHERE id = $1::bigint`, [itemId]);
  },

  async queryImportBatches(invoiceId: string): Promise<Array<{
    sourceFileId: string;
    originalName: string;
    sizeBytes: number;
    uploadedBy: string | null;
    createdAt: string;
    rowCount: number;
    skuCount: number;
    totalQty: number;
    invoiceTotal: number;
    errorCount: number;
  }>> {
    const result = await pool().query(
      `SELECT
         i.source_file_id::text AS source_file_id,
         f.original_name,
         f.size_bytes,
         COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
         f.created_at,
         COUNT(i.id)::int AS row_count,
         COUNT(DISTINCT i.sku)::int AS sku_count,
         COALESCE(SUM(i.qty), 0)::int AS total_qty,
         COALESCE(SUM(i.qty * i.invoice_unit_price), 0)::numeric AS invoice_total,
         COUNT(*) FILTER (WHERE i.result IN ('price_error', 'overcharged'))::int AS error_count
       FROM shipcore.fc_invoice_items i
       JOIN shipcore.fc_price_list_files f ON f.id = i.source_file_id
       LEFT JOIN shipcore.fc_user u ON u.id = f.uploaded_by
       WHERE i.invoice_id = $1::bigint
         AND i.source_file_id IS NOT NULL
       GROUP BY i.source_file_id, f.id, u.name, u.email
       ORDER BY f.created_at DESC, i.source_file_id DESC`,
      [invoiceId],
    );

    return result.rows.map((row) => ({
      sourceFileId: String(row.source_file_id),
      originalName: row.original_name as string,
      sizeBytes: Number(row.size_bytes ?? 0),
      uploadedBy: row.uploaded_by_display as string | null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      rowCount: Number(row.row_count ?? 0),
      skuCount: Number(row.sku_count ?? 0),
      totalQty: Number(row.total_qty ?? 0),
      invoiceTotal: Number(row.invoice_total ?? 0),
      errorCount: Number(row.error_count ?? 0),
    }));
  },

  async queryImportBatchDetail(invoiceId: string, sourceFileId: string): Promise<{
    sourceFileId: string;
    originalName: string;
    sizeBytes: number;
    uploadedBy: string | null;
    createdAt: string;
    items: Array<{ id: string; sku: string; qty: number; invoiceUnitPrice: number; expectedUnitPrice: number | null; diffUnitPrice: number | null; result: string }>;
  } | null> {
    const result = await pool().query(
      `SELECT
         f.id::text AS source_file_id,
         f.original_name,
         f.size_bytes,
         COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
         f.created_at,
         i.id::text AS id,
         i.sku,
         i.qty,
         i.invoice_unit_price,
         i.expected_unit_price,
         i.diff_unit_price,
         i.result::text AS result
       FROM shipcore.fc_price_list_files f
       JOIN shipcore.fc_invoice_items i ON i.source_file_id = f.id
       WHERE i.invoice_id = $1::bigint
         AND i.source_file_id = $2::bigint
       ORDER BY i.id ASC`,
      [invoiceId, sourceFileId],
    );

    if (result.rowCount === 0) return null;
    const first = result.rows[0];
    return {
      sourceFileId: first.source_file_id as string,
      originalName: first.original_name as string,
      sizeBytes: Number(first.size_bytes ?? 0),
      uploadedBy: first.uploaded_by_display as string | null,
      createdAt: first.created_at instanceof Date ? first.created_at.toISOString() : String(first.created_at),
      items: result.rows.map((row) => ({
        id: String(row.id),
        sku: row.sku as string,
        qty: Number(row.qty),
        invoiceUnitPrice: Number(row.invoice_unit_price),
        expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
        diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
        result: row.result as string,
      })),
    };
  },

  async deleteInvoiceItemsBySourceFile(executor: SqlExecutor, invoiceId: string, sourceFileId: string): Promise<number> {
    const result = await executor.query(
      `DELETE FROM shipcore.fc_invoice_items
       WHERE invoice_id = $1::bigint
         AND source_file_id = $2::bigint`,
      [invoiceId, sourceFileId],
    );
    return result.rowCount ?? 0;
  },

  async deletePriceListFileIfOrphaned(executor: SqlExecutor, sourceFileId: string): Promise<void> {
    await executor.query(
      `DELETE FROM shipcore.fc_price_list_files f
       WHERE f.id = $1::bigint
         AND NOT EXISTS (SELECT 1 FROM shipcore.fc_invoice_items i WHERE i.source_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM shipcore.fc_sku_price_history h WHERE h.source_file_id = f.id)
         AND NOT EXISTS (SELECT 1 FROM shipcore.fc_invoices inv WHERE inv.attachment_file_id = f.id OR inv.signed_attachment_file_id = f.id)`,
      [sourceFileId],
    );
  },

  async getPriceListFileOriginalName(executor: SqlExecutor, sourceFileId: string): Promise<string | null> {
    const result = await executor.query<{ original_name: string }>(
      `SELECT original_name FROM shipcore.fc_price_list_files WHERE id = $1::bigint`,
      [sourceFileId],
    );
    return result.rows[0]?.original_name ?? null;
  },

  // ───────────────────────────────────────────────────────────────────────
  // Blob files (shared by invoice imports, invoice attachments, price lists)
  // ───────────────────────────────────────────────────────────────────────

  async insertPriceListFile(
    input: { originalName: string; mimeType: string | null; sizeBytes: number; fileData: Buffer; uploadedBy: string | null },
    executor: SqlExecutor = pool(),
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO shipcore.fc_price_list_files
         (original_name, mime_type, size_bytes, file_data, uploaded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id::text AS id`,
      [input.originalName, input.mimeType, input.sizeBytes, input.fileData, input.uploadedBy],
    );
    return result.rows[0].id;
  },

  async getPriceListFile(id: string): Promise<{ originalName: string; mimeType: string | null; fileData: Buffer } | null> {
    const result = await pool().query<{ original_name: string; mime_type: string | null; file_data: Buffer }>(
      `SELECT original_name, mime_type, file_data
       FROM shipcore.fc_price_list_files
       WHERE id = $1::bigint`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { originalName: row.original_name, mimeType: row.mime_type, fileData: row.file_data };
  },

  // ───────────────────────────────────────────────────────────────────────
  // Credit notes
  // ───────────────────────────────────────────────────────────────────────

  async queryCreditNoteList(filter: { factoryId: string; search: string; statuses: string[] }): Promise<Array<Record<string, unknown>>> {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (filter.factoryId) {
      params.push(filter.factoryId);
      filters.push(`cn.factory_id = $${params.length}::bigint`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      filters.push(`(cn.sku ILIKE $${params.length} OR src.invoice_number ILIKE $${params.length} OR cn.container_number ILIKE $${params.length})`);
    }
    if (filter.statuses.length > 0) {
      params.push(filter.statuses);
      filters.push(`cn.status::text = ANY($${params.length}::text[])`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool().query(
      `SELECT
         cn.*,
         f.factory_name,
         src.invoice_number AS source_invoice_number,
         applied.invoice_number AS applied_invoice_number
       FROM shipcore.fc_credit_notes cn
       JOIN shipcore.fc_factories f ON f.id = cn.factory_id
       JOIN shipcore.fc_invoices src ON src.id = cn.source_invoice_id
       LEFT JOIN shipcore.fc_invoices applied ON applied.id = cn.applied_invoice_id
       ${where}
       ORDER BY cn.requested_at DESC, cn.id DESC
       LIMIT 1000`,
      params,
    );
    return result.rows;
  },

  async queryCreditNoteStatusSummary(): Promise<Array<{ status: string; count: number; amount: number }>> {
    const result = await pool().query<{ status: string; count: number; amount: string }>(
      `SELECT status::text AS status, COUNT(*)::int AS count, COALESCE(SUM(credit_amount), 0) AS amount
       FROM shipcore.fc_credit_notes
       GROUP BY status`,
    );
    return result.rows.map((row) => ({ status: row.status, count: row.count, amount: Number(row.amount) }));
  },

  async getInvoiceForCreditNote(sourceInvoiceId: string): Promise<{ factoryId: string; containerId: string | null; containerNumber: string | null } | null> {
    const result = await pool().query(
      `SELECT factory_id, container_id, container_number FROM shipcore.fc_invoices WHERE id = $1::bigint`,
      [sourceInvoiceId],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { factoryId: row.factory_id, containerId: row.container_id, containerNumber: row.container_number };
  },

  async createCreditNote(input: {
    factoryId: string;
    containerId: string | null;
    containerNumber: string | null;
    sourceInvoiceId: string;
    sku: string;
    expectedUnitPrice: number | null;
    invoiceUnitPrice: number;
    qty: number;
    creditAmount: number;
    note: string | null;
    createdBy: string | null;
  }): Promise<string> {
    const result = await pool().query<{ id: string }>(
      `INSERT INTO shipcore.fc_credit_notes
         (factory_id, container_id, container_number, source_invoice_id, sku,
          expected_unit_price, invoice_unit_price, qty, credit_amount, note, created_by, requested_at)
       VALUES ($1::bigint, $2::bigint, $3, $4::bigint, UPPER($5), $6::numeric, $7::numeric, $8::int, $9::numeric, $10, $11, NOW())
       RETURNING id::text AS id`,
      [
        input.factoryId,
        input.containerId,
        input.containerNumber,
        input.sourceInvoiceId,
        input.sku,
        input.expectedUnitPrice,
        input.invoiceUnitPrice,
        input.qty,
        input.creditAmount,
        input.note,
        input.createdBy,
      ],
    );
    return result.rows[0].id;
  },

  async getCreditNoteForUpdate(id: string): Promise<{ sourceInvoiceId: string; sku: string; status: string } | null> {
    const result = await pool().query(
      `SELECT source_invoice_id, sku, status::text AS status FROM shipcore.fc_credit_notes WHERE id = $1::bigint`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { sourceInvoiceId: row.source_invoice_id, sku: row.sku, status: row.status };
  },

  async confirmCreditNote(id: string): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_credit_notes SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
      [id],
    );
  },

  async applyCreditNote(id: string, appliedInvoiceId: string, appliedDate: string): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_credit_notes
       SET status = 'applied', applied_invoice_id = $2::bigint, applied_date = $3::date, applied_at = NOW(), updated_at = NOW()
       WHERE id = $1::bigint`,
      [id, appliedInvoiceId, appliedDate],
    );
  },

  async revertCreditNoteFromApplied(id: string): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_credit_notes
       SET status = 'confirmed', applied_invoice_id = NULL, applied_date = NULL, applied_at = NULL, updated_at = NOW()
       WHERE id = $1::bigint`,
      [id],
    );
  },

  async revertCreditNoteFromConfirmed(id: string): Promise<void> {
    await pool().query(
      `UPDATE shipcore.fc_credit_notes SET status = 'pending', confirmed_at = NULL, updated_at = NOW() WHERE id = $1::bigint`,
      [id],
    );
  },

  async editCreditNote(id: string, edits: { creditAmount?: number; note?: string }): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    if (edits.creditAmount !== undefined) {
      values.push(edits.creditAmount);
      sets.push(`credit_amount = $${values.length}::numeric`);
    }
    if (edits.note !== undefined) {
      values.push(edits.note || null);
      sets.push(`note = $${values.length}`);
    }
    sets.push("updated_at = NOW()");

    await pool().query(
      `UPDATE shipcore.fc_credit_notes SET ${sets.join(", ")} WHERE id = $1::bigint`,
      values,
    );
  },

  async deleteCreditNote(id: string): Promise<void> {
    await pool().query(`DELETE FROM shipcore.fc_credit_notes WHERE id = $1::bigint`, [id]);
  },

  async queryOverchargedItemsForBulk(itemIds: string[]): Promise<Array<{
    itemId: string;
    invoiceId: string;
    sku: string;
    qty: number;
    invoiceUnitPrice: number;
    expectedUnitPrice: number | null;
    diffUnitPrice: number | null;
    invoiceNumber: string;
    factoryId: string;
    containerId: string | null;
    containerNumber: string | null;
  }>> {
    const result = await pool().query(
      `SELECT
         ii.id AS item_id,
         ii.invoice_id,
         ii.sku,
         ii.qty,
         ii.invoice_unit_price,
         ii.expected_unit_price,
         ii.diff_unit_price,
         i.invoice_number,
         i.factory_id,
         i.container_id,
         i.container_number
       FROM shipcore.fc_invoice_items ii
       JOIN shipcore.fc_invoices i ON i.id = ii.invoice_id
       WHERE ii.id = ANY($1::bigint[])
         AND ii.result = 'overcharged'`,
      [itemIds],
    );

    return result.rows.map((row) => ({
      itemId: String(row.item_id),
      invoiceId: String(row.invoice_id),
      sku: row.sku,
      qty: Number(row.qty),
      invoiceUnitPrice: Number(row.invoice_unit_price),
      expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
      diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
      invoiceNumber: row.invoice_number,
      factoryId: row.factory_id,
      containerId: row.container_id,
      containerNumber: row.container_number,
    }));
  },

  async insertBulkCreditNote(input: {
    factoryId: string;
    containerId: string | null;
    containerNumber: string | null;
    sourceInvoiceId: string;
    sourceInvoiceItemId: string;
    sku: string;
    expectedUnitPrice: number | null;
    invoiceUnitPrice: number;
    qty: number;
    creditAmount: number;
    createdBy: string | null;
  }): Promise<string | null> {
    const result = await pool().query<{ id: string }>(
      `INSERT INTO shipcore.fc_credit_notes
         (factory_id, container_id, container_number, source_invoice_id, source_invoice_item_id, sku,
          expected_unit_price, invoice_unit_price, qty, credit_amount, created_by, requested_at)
       VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5::bigint, $6, $7::numeric, $8::numeric, $9::int, $10::numeric, $11, NOW())
       ON CONFLICT (source_invoice_item_id) WHERE source_invoice_item_id IS NOT NULL DO NOTHING
       RETURNING id::text AS id`,
      [
        input.factoryId,
        input.containerId,
        input.containerNumber,
        input.sourceInvoiceId,
        input.sourceInvoiceItemId,
        input.sku,
        input.expectedUnitPrice,
        input.invoiceUnitPrice,
        input.qty,
        input.creditAmount,
        input.createdBy,
      ],
    );
    return result.rowCount && result.rowCount > 0 ? result.rows[0].id : null;
  },

  // ───────────────────────────────────────────────────────────────────────
  // SKU price history
  // ───────────────────────────────────────────────────────────────────────

  async queryPriceHistoryFilesMode(factoryId: string): Promise<Array<Record<string, unknown>>> {
    const fileFilters: string[] = [];
    const fileParams: unknown[] = [];
    if (factoryId) {
      fileParams.push(factoryId);
      fileFilters.push(`EXISTS (
        SELECT 1
        FROM shipcore.fc_sku_price_history h_filter
        WHERE h_filter.source_file_id = f.id
          AND h_filter.factory_id = $${fileParams.length}::bigint
      )`);
    }
    const fileWhere = fileFilters.length ? `WHERE ${fileFilters.join(" AND ")}` : "";

    const result = await pool().query(
      `SELECT
         f.id,
         f.original_name,
         f.mime_type,
         f.size_bytes,
         COALESCE(u.name, u.email, f.uploaded_by) AS uploaded_by_display,
         f.created_at,
         COUNT(h.id)::int AS row_count,
         COUNT(DISTINCT h.factory_id)::int AS factory_count,
         COUNT(DISTINCT h.sku)::int AS sku_count,
         STRING_AGG(DISTINCT h.factory_id::text, ',' ORDER BY h.factory_id::text) AS factory_ids,
         STRING_AGG(DISTINCT ff.factory_name, ', ' ORDER BY ff.factory_name) AS factory_names,
         MIN(h.effective_date)::text AS first_effective_date,
         MAX(h.effective_date)::text AS last_effective_date
       FROM shipcore.fc_price_list_files f
       LEFT JOIN shipcore.fc_sku_price_history h ON h.source_file_id = f.id
       LEFT JOIN shipcore.fc_factories ff ON ff.id = h.factory_id
       LEFT JOIN shipcore.fc_user u ON u.id = f.uploaded_by
       ${fileWhere}
       GROUP BY f.id, u.name, u.email
       ORDER BY f.created_at DESC
       LIMIT 100`,
      fileParams,
    );
    return result.rows;
  },

  async queryPriceHistoryList(filter: { factoryId: string; sku: string; asOfDate: string; sourceFileId: string; currentOnly: boolean }): Promise<Array<Record<string, unknown>>> {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (filter.factoryId) {
      params.push(filter.factoryId);
      filters.push(`h.factory_id = $${params.length}::bigint`);
    }
    if (filter.sku) {
      params.push(`%${filter.sku}%`);
      filters.push(`h.sku ILIKE $${params.length}`);
    }
    if (filter.asOfDate) {
      params.push(filter.asOfDate);
      filters.push(`h.effective_date <= $${params.length}::date`);
    }
    if (filter.sourceFileId) {
      params.push(filter.sourceFileId);
      filters.push(`h.source_file_id = $${params.length}::bigint`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const currentClause = filter.currentOnly ? "WHERE ranked.current_rank = 1" : "";

    const result = await pool().query(
      `WITH base AS (
         SELECT
           h.*,
           f.factory_name,
           sf.original_name AS source_file_name,
           COALESCE(invoice_refs.item_count, 0)::int AS invoice_reference_count,
           COALESCE(invoice_refs.invoice_count, 0)::int AS invoice_reference_invoice_count,
           LAG(h.unit_price) OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date, h.id) AS previous_price,
           ROW_NUMBER() OVER (PARTITION BY h.factory_id, h.sku ORDER BY h.effective_date DESC, h.id DESC) AS current_rank
         FROM shipcore.fc_sku_price_history h
         JOIN shipcore.fc_factories f ON f.id = h.factory_id
         LEFT JOIN shipcore.fc_price_list_files sf ON sf.id = h.source_file_id
         LEFT JOIN LATERAL (
           SELECT
             COUNT(ii.id)::int AS item_count,
             COUNT(DISTINCT ii.invoice_id)::int AS invoice_count
           FROM shipcore.fc_invoice_items ii
           JOIN shipcore.fc_invoices inv ON inv.id = ii.invoice_id
           WHERE inv.factory_id = h.factory_id
             AND ii.sku = h.sku
             AND ii.expected_effective_date = h.effective_date
         ) invoice_refs ON TRUE
         ${where}
       )
       SELECT * FROM base ranked
       ${currentClause}
       ORDER BY ranked.sku ASC, ranked.effective_date DESC, ranked.id DESC
       LIMIT 1000`,
      params,
    );
    return result.rows;
  },

  async createPriceHistory(input: { factoryId: string; sku: string; effectiveDate: string; unitPrice: number; currency: string; reason: string | null; createdBy: string | null }): Promise<string | null> {
    const result = await pool().query<{ id: string }>(
      `INSERT INTO shipcore.fc_sku_price_history
         (factory_id, sku, effective_date, unit_price, currency, reason, created_by, created_at, updated_at)
       VALUES ($1::bigint, UPPER($2), $3::date, $4::numeric, UPPER($5), $6, $7, NOW(), NOW())
       ON CONFLICT (factory_id, sku, effective_date) DO NOTHING
       RETURNING id`,
      [input.factoryId, input.sku, input.effectiveDate, input.unitPrice, input.currency, input.reason, input.createdBy],
    );
    return result.rowCount === 0 ? null : String(result.rows[0].id);
  },

  async updatePriceHistory(id: string, input: { factoryId: string; sku: string; effectiveDate: string; unitPrice: number; currency: string; reason: string | null }): Promise<string | null> {
    const result = await pool().query<{ id: string }>(
      `UPDATE shipcore.fc_sku_price_history
       SET factory_id = $2::bigint,
           sku = UPPER($3),
           effective_date = $4::date,
           unit_price = $5::numeric,
           currency = UPPER($6),
           reason = $7,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, input.factoryId, input.sku, input.effectiveDate, input.unitPrice, input.currency, input.reason],
    );
    return result.rowCount === 0 ? null : id;
  },

  async deletePriceHistoryBatch(sourceFileId: string): Promise<{ deletedRows: number; fileDeleted: boolean }> {
    return withTransaction(async (client) => {
      const deletedRows = await client.query(
        `DELETE FROM shipcore.fc_sku_price_history WHERE source_file_id = $1::bigint`,
        [sourceFileId],
      );
      const deletedFile = await client.query(
        `DELETE FROM shipcore.fc_price_list_files WHERE id = $1::bigint`,
        [sourceFileId],
      );
      return { deletedRows: deletedRows.rowCount ?? 0, fileDeleted: (deletedFile.rowCount ?? 0) > 0 };
    });
  },

  async deletePriceHistoryByIds(ids: string[]): Promise<number> {
    const result = await pool().query(`DELETE FROM shipcore.fc_sku_price_history WHERE id = ANY($1::bigint[])`, [ids]);
    return result.rowCount ?? 0;
  },

  async deletePriceHistoryById(id: string): Promise<number> {
    const result = await pool().query(`DELETE FROM shipcore.fc_sku_price_history WHERE id = $1::bigint`, [id]);
    return result.rowCount ?? 0;
  },

  async findExistingPriceHistoryRow(executor: SqlExecutor, factoryId: string, sku: string, effectiveDate: string): Promise<boolean> {
    const result = await executor.query(
      `SELECT id
       FROM shipcore.fc_sku_price_history
       WHERE factory_id = $1::bigint
         AND sku = $2
         AND effective_date = $3::date
       LIMIT 1`,
      [factoryId, sku, effectiveDate],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async upsertPriceHistoryRow(executor: SqlExecutor, input: {
    factoryId: string;
    sku: string;
    effectiveDate: string;
    unitPrice: number;
    currency: string;
    reason: string | null;
    sourceFileId: string;
    createdBy: string | null;
  }): Promise<void> {
    await executor.query(
      `INSERT INTO shipcore.fc_sku_price_history
         (factory_id, sku, effective_date, unit_price, currency, reason, source_file_id, created_by, created_at, updated_at)
       VALUES ($1::bigint, $2, $3::date, $4::numeric, $5, $6, $7::bigint, $8, NOW(), NOW())
       ON CONFLICT (factory_id, sku, effective_date) DO UPDATE SET
         unit_price = EXCLUDED.unit_price,
         currency = EXCLUDED.currency,
         reason = COALESCE(NULLIF(EXCLUDED.reason, ''), shipcore.fc_sku_price_history.reason),
         source_file_id = EXCLUDED.source_file_id,
         updated_at = NOW()`,
      [input.factoryId, input.sku, input.effectiveDate, input.unitPrice, input.currency, input.reason, input.sourceFileId, input.createdBy],
    );
  },
};
