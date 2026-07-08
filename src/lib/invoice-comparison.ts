// Code Guide: Shared price-comparison logic for Invoice Review.
// Encodes the "expected price = latest fc_sku_price_history row with
// effective_date <= invoice_date" rule in exactly one place, used by
// manual line-item add, Excel import, and the recompare action.

import type { PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";

export interface NewInvoiceItemInput {
  sku: string;
  qty: number;
  unitPrice: number;
}

export interface InsertedInvoiceItem {
  id: string;
  expectedUnitPrice: number | null;
  diffUnitPrice: number | null;
  result: "match" | "price_error" | "overcharged" | "no_price_history";
}

/**
 * Inserts one invoice line item, resolving its expected price inline so the
 * row is never left in a stale/uncompared state.
 */
export async function insertInvoiceItemWithComparison(
  client: PoolClient,
  invoiceId: string,
  factoryId: string,
  invoiceDate: string,
  item: NewInvoiceItemInput,
): Promise<InsertedInvoiceItem> {
  const result = await client.query(
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
       diff_unit_price, result, created_at, updated_at
     )
     SELECT
       $1::bigint, UPPER($2), $3::int, $4::numeric,
       e.expected_unit_price, e.expected_effective_date, e.price_history_id,
       CASE WHEN e.expected_unit_price IS NULL THEN NULL ELSE $4::numeric - e.expected_unit_price END,
       (CASE
          WHEN e.expected_unit_price IS NULL THEN 'no_price_history'
          WHEN $4::numeric = e.expected_unit_price THEN 'match'
          WHEN $4::numeric < e.expected_unit_price THEN 'price_error'
          ELSE 'overcharged'
        END)::shipcore.fc_invoice_item_result,
       NOW(), NOW()
     FROM (VALUES (1)) AS seed(x)
     LEFT JOIN expected e ON TRUE
     RETURNING id::text AS id, expected_unit_price, diff_unit_price, result`,
    [invoiceId, item.sku, item.qty, item.unitPrice, factoryId, invoiceDate],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
    diffUnitPrice: row.diff_unit_price == null ? null : Number(row.diff_unit_price),
    result: row.result,
  };
}

/**
 * Re-resolves the expected price for every line item on an invoice against
 * the current fc_sku_price_history (the "재검수" action). Needed because the
 * factory's price list often arrives after the invoice itself, so a line may
 * start as "no_price_history" and only become comparable later.
 *
 * Once a line's credit_status has been set (requested/confirmed/applied), its
 * credit_amount is intentionally left untouched even if result/diff change --
 * money amounts must never be silently rewritten after a credit decision has
 * begun.
 */
export async function recompareInvoiceItems(client: PoolClient, invoiceId: string): Promise<void> {
  await client.query(
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
                                ELSE e.invoice_unit_price - e.expected_unit_price END,
         result = (CASE
             WHEN e.expected_unit_price IS NULL THEN 'no_price_history'
             WHEN e.invoice_unit_price = e.expected_unit_price THEN 'match'
             WHEN e.invoice_unit_price < e.expected_unit_price THEN 'price_error'
             ELSE 'overcharged'
           END)::shipcore.fc_invoice_item_result,
         credit_amount = CASE
             WHEN e.credit_status IS NOT NULL THEN i.credit_amount
             WHEN e.expected_unit_price IS NOT NULL AND e.invoice_unit_price > e.expected_unit_price
               THEN (e.invoice_unit_price - e.expected_unit_price) * e.qty
             ELSE NULL
           END,
         updated_at = NOW()
     FROM expected e
     WHERE i.id = e.item_id`,
    [invoiceId],
  );
}

export type InvoiceStatus =
  | "received"
  | "price_review"
  | "discrepancy_found"
  | "factory_confirmation"
  | "approved"
  | "signed"
  | "sent_to_factory";

const AUTO_MANAGED_STATUSES: InvoiceStatus[] = ["received", "price_review", "discrepancy_found"];

/**
 * Advances an invoice between received/price_review/discrepancy_found based
 * on whether any line item currently has a discrepancy. Once a human has
 * manually pushed the invoice past discrepancy_found (factory_confirmation
 * or later), adding/recomparing items no longer touches invoice status --
 * status changes past that point are always an explicit user action.
 */
export async function recalculateInvoiceStatus(client: PoolClient, invoiceId: string): Promise<void> {
  const current = await client.query<{ status: InvoiceStatus }>(
    `SELECT status FROM shipcore.fc_invoices WHERE id = $1::bigint`,
    [invoiceId],
  );
  const currentStatus = current.rows[0]?.status;
  if (!currentStatus || !AUTO_MANAGED_STATUSES.includes(currentStatus)) return;

  const counts = await client.query<{ discrepancies: string }>(
    `SELECT COUNT(*) FILTER (WHERE result IN ('price_error', 'overcharged')) AS discrepancies
     FROM shipcore.fc_invoice_items WHERE invoice_id = $1::bigint`,
    [invoiceId],
  );
  const nextStatus: InvoiceStatus = Number(counts.rows[0]?.discrepancies ?? 0) > 0 ? "discrepancy_found" : "price_review";

  if (nextStatus !== currentStatus) {
    await client.query(
      `UPDATE shipcore.fc_invoices SET status = $2::shipcore.fc_invoice_status, updated_at = NOW() WHERE id = $1::bigint`,
      [invoiceId, nextStatus],
    );
  }
}

/** Convenience wrapper for call sites that don't already hold a transaction client. */
export async function withInvoiceTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
