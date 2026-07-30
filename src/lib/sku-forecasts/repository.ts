/**
 * Pure data access for the SKU Planning (`/planning/sku-forecasts`) tabs that
 * this app owns directly: per-SKU inbound history and pending inbound list
 * (both joins over fc_container_items/fc_containers/fc_available_stock), and
 * the earliest order date used to bound the forecast date picker. Raw SQL
 * only — no Prisma models for these tables.
 *
 * The page's other tabs (demand forecast chart, backtest, chat) proxy to an
 * external FastAPI service via src/lib/planning-api.ts and are out of scope
 * here — there's no business logic to layer, just a pass-through.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";

export interface InboundHistoryRow {
  itemId: number;
  containerId: number;
  containerNumber: string;
  status: string;
  eta: string | null;
  statusChangedAt: string | null;
  stockInCompletedAt: string | null;
  inboundQty: number;
  cbm: number;
  sourceTypes: string[];
  remainingReferences: string[];
  remainingQty: number;
  mistakeReferences: string[];
  mistakeQty: number;
  itemUpdatedAt: string | null;
  changeHistory: null;
}

export interface InboundRow {
  id: number;
  name: string;
  eta: string | null;
  status: string;
  inbound_qty: number;
  cbm: number;
}

export const SkuForecastsRepository = {
  async getInboundHistory(masterSku: string): Promise<InboundHistoryRow[]> {
    const result = await getPrimaryPool().query<{
      item_id: number;
      container_id: number;
      container_number: string;
      status: string;
      eta: string | null;
      status_changed_at: string | null;
      inbound_qty: number;
      cbm: number;
      source_types: string[] | null;
      remaining_references: string[] | null;
      remaining_qty: number;
      mistake_references: string[] | null;
      mistake_qty: number;
      item_updated_at: string | null;
    }>(
      `
      SELECT
        ci.id::int AS item_id,
        c.id::int AS container_id,
        c.container_number,
        c.status::text AS status,
        c.eta_date::text AS eta,
        c.updated_at::text AS status_changed_at,
        ci.qty::int AS inbound_qty,
        ci.total_cbm::float8 AS cbm,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.source_type) FILTER (WHERE s.source_type IS NOT NULL), NULL) AS source_types,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.reference_no) FILTER (WHERE s.source_type = 'remaining'), NULL) AS remaining_references,
        COALESCE(SUM(a.qty) FILTER (WHERE s.source_type = 'remaining'), 0)::int AS remaining_qty,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.reference_no) FILTER (WHERE s.source_type = 'mistake'), NULL) AS mistake_references,
        COALESCE(SUM(a.qty) FILTER (WHERE s.source_type = 'mistake'), 0)::int AS mistake_qty,
        ci.updated_at::text AS item_updated_at
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
      LEFT JOIN shipcore.fc_container_item_allocations a
        ON a.container_id = ci.container_id
      LEFT JOIN shipcore.fc_available_stock s
        ON s.id = a.source_stock_id
       AND s.master_sku = ci.master_sku
      WHERE ci.master_sku = $1
        AND ci.qty > 0
      GROUP BY ci.id, c.id, c.container_number, c.status, c.eta_date, c.updated_at, ci.qty, ci.total_cbm, ci.updated_at
      ORDER BY
        c.eta_date DESC NULLS LAST,
        c.updated_at DESC,
        c.id DESC
      `,
      [masterSku],
    );

    return result.rows.map((row) => ({
      itemId: row.item_id,
      containerId: row.container_id,
      containerNumber: row.container_number,
      status: row.status,
      eta: row.eta,
      statusChangedAt: row.status_changed_at,
      stockInCompletedAt: row.status === "complete" ? row.status_changed_at : null,
      inboundQty: row.inbound_qty,
      cbm: row.cbm,
      sourceTypes: row.source_types ?? [],
      remainingReferences: row.remaining_references ?? [],
      remainingQty: row.remaining_qty,
      mistakeReferences: row.mistake_references ?? [],
      mistakeQty: row.mistake_qty,
      itemUpdatedAt: row.item_updated_at,
      changeHistory: null,
    }));
  },

  async getInbound(masterSku: string, includeDrafts: boolean): Promise<InboundRow[]> {
    const statuses = includeDrafts ? "('shipped', 'packing_received', 'draft')" : "('shipped', 'packing_received')";
    const result = await getPrimaryPool().query<InboundRow>(`
      SELECT
        c.id::int                 AS id,
        c.container_number        AS name,
        c.eta_date::text          AS eta,
        c.status::text            AS status,
        ci.qty::int               AS inbound_qty,
        ci.total_cbm::float8      AS cbm
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
      WHERE ci.master_sku = $1
        AND ci.qty > 0
        AND c.status IN ${statuses}
      ORDER BY
        CASE WHEN c.status = 'draft' THEN 1 ELSE 0 END,
        c.eta_date NULLS LAST,
        c.id
    `, [masterSku]);

    return result.rows;
  },

  async getForecastMinDate(): Promise<string | null> {
    const result = await getPrimaryPool().query<{ min_date: string | null }>(
      `SELECT MIN(order_date)::text AS min_date FROM shipcore.fc_velocity_link_snapshot`,
    );
    return result.rows[0]?.min_date?.slice(0, 10) ?? null;
  },
};
