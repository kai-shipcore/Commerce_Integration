/**
 * Pure data access for shipcore.fc_purchase_orders / fc_purchase_order_items.
 * Raw SQL only — no Prisma model exists for these tables.
 *
 * ensureCreatedByColumn/ensureFactoryCodeSequence intentionally always run
 * against the shared pool, not a transaction's client — that matches the
 * original route, where these idempotent DDL/sequence-sync calls run on a
 * separate connection from the surrounding BEGIN/COMMIT.
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

export interface PurchaseOrderItemInput {
  sku: string;
  moq: number;
  qty: number;
  cbm: number;
  unitPrice?: number | null;
}

export interface PurchaseOrderHeaderInput {
  number: string;
  date: string;
  eta: string;
  factory: string;
  destination?: string;
  manager?: string;
  note?: string;
  status: "draft" | "pending" | "approved" | "sent";
}

export const PurchaseOrdersRepository = {
  async ensureCreatedByColumn(): Promise<void> {
    await pool().query(`
      ALTER TABLE shipcore.fc_purchase_orders
      ADD COLUMN IF NOT EXISTS created_by text
    `);
  },

  async ensureFactoryCodeSequence(): Promise<void> {
    await pool().query("CREATE SEQUENCE IF NOT EXISTS shipcore.fc_factory_code_seq START 1");
    await pool().query(`
      WITH code_state AS (
        SELECT COALESCE((
            SELECT MAX((regexp_match(factory_code, '^FC-([0-9]+)$'))[1]::bigint)
            FROM shipcore.fc_factories
            WHERE factory_code ~ '^FC-[0-9]+$'
          ), 0) AS max_code
      )
      SELECT setval(
        'shipcore.fc_factory_code_seq',
        GREATEST(code_state.max_code, shipcore.fc_factory_code_seq.last_value, 1),
        code_state.max_code > 0 OR shipcore.fc_factory_code_seq.is_called
      )
      FROM code_state, shipcore.fc_factory_code_seq
    `);
  },

  async getNextPoNumberSeq(): Promise<number> {
    const result = await pool().query<{ next_seq: string }>(`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN po_number ~ '^PO-[0-9]{4}-[0-9]+$'
            THEN (regexp_match(po_number, '^PO-[0-9]{4}-([0-9]+)$'))[1]::bigint
          END
        ), 0
      ) + 1 AS next_seq
      FROM shipcore.fc_purchase_orders
    `);
    return Number(result.rows[0].next_seq);
  },

  async listPurchaseOrders(search: string): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [];
    const filters: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(
        COALESCE(po.po_number, '') ILIKE $${params.length}
        OR COALESCE(po.factory_name, '') ILIKE $${params.length}
        OR COALESCE(po.dest_warehouse, '') ILIKE $${params.length}
        OR COALESCE(po.manager, '') ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM shipcore.fc_purchase_order_items search_item
          WHERE search_item.po_id = po.id
            AND search_item.master_sku ILIKE $${params.length}
        )
      )`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool().query(
      `SELECT
         po.id::text AS id,
         po.po_number,
         po.po_date,
         po.eta_date,
         po.factory_id::text AS factory_id,
         COALESCE(factory.factory_name, po.factory_name) AS factory_name,
         po.origin,
         po.dest_warehouse,
         po.manager,
         po.note,
         po.status::text AS status,
         po.created_by,
         po.sent_at,
         COALESCE(item_summary.item_count, 0)::int AS item_count,
         COALESCE(item_summary.total_qty, 0)::int AS total_qty,
         COALESCE(item_summary.total_cbm, 0)::text AS total_cbm,
         COALESCE(item_summary.items, '[]'::json) AS items
       FROM shipcore.fc_purchase_orders po
       LEFT JOIN shipcore.fc_factories factory ON factory.id = po.factory_id
       LEFT JOIN (
         SELECT
           po_id,
           COUNT(*)::int AS item_count,
           COALESCE(SUM(order_qty), 0)::int AS total_qty,
           COALESCE(SUM(total_cbm), 0)::numeric AS total_cbm,
           json_agg(
             json_build_object(
               'id', id::text,
               'sku', master_sku,
               'moq', moq,
               'qty', order_qty,
               'cbm', COALESCE(cbm_unit, CASE WHEN order_qty > 0 THEN total_cbm / order_qty ELSE 0 END, 0),
               'totalCbm', COALESCE(total_cbm, 0),
               'unitPrice', unit_price
             )
             ORDER BY id
           ) AS items
         FROM shipcore.fc_purchase_order_items
         GROUP BY po_id
       ) item_summary ON item_summary.po_id = po.id
       ${where}
       ORDER BY po.po_date DESC, po.id DESC`,
      params,
    );
    return result.rows;
  },

  async upsertFactoryByName(factoryName: string, executor: SqlExecutor): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO shipcore.fc_factories (factory_code, factory_name)
       VALUES ('FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0'), $1)
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(shipcore.fc_factories.factory_code, EXCLUDED.factory_code),
         is_active = true,
         updated_at = now()
       RETURNING id::text`,
      [factoryName],
    );
    return result.rows[0].id;
  },

  async findMissingSkus(skus: string[], executor: SqlExecutor): Promise<string[]> {
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    const existing = new Set(result.rows.map((row) => row.master_sku));
    return skus.filter((sku) => !existing.has(sku));
  },

  async syncProductMoqCbm(sku: string, moq: number, cbm: number, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_products
       SET moq = $2::int,
           order_multiple = $2::int,
           cbm_per_unit = COALESCE(NULLIF($3::numeric(14,6), 0), cbm_per_unit),
           updated_at = NOW()
       WHERE master_sku = $1`,
      [sku, moq, cbm],
    );
  },

  async insertPurchaseOrder(header: PurchaseOrderHeaderInput, factoryId: string, factoryName: string, createdBy: string | null, executor: SqlExecutor): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO shipcore.fc_purchase_orders
         (po_number, po_date, eta_date, factory_id, factory_name, dest_warehouse, manager, note, status, created_by)
       VALUES ($1, $2::date, $3::date, $4::bigint, $5, $6, $7, $8, $9::shipcore.fc_po_status, $10)
       RETURNING id::text`,
      [
        header.number.trim(),
        header.date,
        header.eta,
        factoryId,
        factoryName,
        header.destination?.trim() || null,
        header.manager?.trim() || null,
        header.note?.trim() || null,
        header.status,
        createdBy,
      ],
    );
    return result.rows[0].id;
  },

  async insertPurchaseOrderItem(poId: string, item: PurchaseOrderItemInput, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `INSERT INTO shipcore.fc_purchase_order_items
         (po_id, master_sku, moq, order_qty, cbm_unit, unit_price)
       VALUES ($1::bigint, $2, $3, $4, $5::numeric(14,6), $6)`,
      [poId, item.sku.trim(), item.moq, item.qty, item.cbm || null, item.unitPrice ?? null],
    );
  },

  async getStatusById(id: string, executor: SqlExecutor): Promise<string | null> {
    const result = await executor.query<{ status: string }>(
      `SELECT status::text FROM shipcore.fc_purchase_orders WHERE id = $1::bigint`,
      [id],
    );
    return result.rows[0]?.status ?? null;
  },

  async updateWorkflowStatus(id: string, newStatus: string, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_purchase_orders
          SET status = $1::shipcore.fc_po_status,
              sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
              updated_at = now()
        WHERE id = $2::bigint`,
      [newStatus, id],
    );
  },

  async lockForUpdate(id: string, executor: SqlExecutor): Promise<{ id: string; status: string } | null> {
    const result = await executor.query<{ id: string; status: string }>(
      `SELECT id::text, status::text
       FROM shipcore.fc_purchase_orders
       WHERE id = $1::bigint
       FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async updateHeader(id: string, header: PurchaseOrderHeaderInput, factoryId: string, factoryName: string, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_purchase_orders
       SET po_number = $2,
           po_date = $3::date,
           eta_date = $4::date,
           factory_id = $5::bigint,
           factory_name = $6,
           dest_warehouse = $7,
           manager = $8,
           note = $9,
           status = $10::shipcore.fc_po_status
       WHERE id = $1::bigint`,
      [
        id,
        header.number.trim(),
        header.date,
        header.eta,
        factoryId,
        factoryName,
        header.destination?.trim() || null,
        header.manager?.trim() || null,
        header.note?.trim() || null,
        header.status,
      ],
    );
  },

  async deleteItemsByPoId(poId: string, executor: SqlExecutor): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_purchase_order_items WHERE po_id = $1::bigint`, [poId]);
  },

  async lockForDelete(id: string, executor: SqlExecutor): Promise<{ id: string; po_number: string } | null> {
    const result = await executor.query<{ id: string; po_number: string }>(
      `SELECT id::text, po_number
       FROM shipcore.fc_purchase_orders
       WHERE id = $1::bigint
       FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async deleteCascade(id: string, executor: SqlExecutor): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_container_po_links WHERE po_id = $1::bigint`, [id]);
    await executor.query(`DELETE FROM shipcore.fc_purchase_order_items WHERE po_id = $1::bigint`, [id]);
    await executor.query(`DELETE FROM shipcore.fc_purchase_orders WHERE id = $1::bigint`, [id]);
  },
};
