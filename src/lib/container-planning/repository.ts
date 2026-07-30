/**
 * Pure data access for the Container Planning domain: fc_containers,
 * fc_container_items, fc_container_item_allocations, fc_container_po_links,
 * and fc_container_audit_log. Raw SQL only — no Prisma model exists for
 * these tables (the `Container` Prisma model maps to an unrelated legacy
 * `container` table that nothing in this domain reads or writes).
 *
 * This repository also owns the allocation-sync logic previously in
 * src/lib/planning/available-stock-allocation.ts (auto-matching "remaining"/
 * "mistake" available stock to a container item's target qty), and the
 * manual allocate/deallocate logic previously left untouched inside
 * src/app/api/container-available-stock/route.ts pending this refactor.
 *
 * Methods accept an optional `executor` (defaults to the shared pool) so the
 * Service can compose multiple calls into one transaction via
 * `withTransaction()`.
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

// ─── Types ──────────────────────────────────────────────────────────────

export interface ContainerListFilters {
  warehouseCode: string;
  warehouseName: string;
  city: string;
  includeReceived: boolean;
  includeDetails: boolean;
  timelineView: boolean;
  categoryCode: "FM" | "CC" | "SC" | null;
}

export interface ContainerListItemAllocation {
  id: string;
  stockId: string;
  sourceType: string;
  referenceNo: string;
  qty: number;
  cbm: number;
}

export interface ContainerListItemRow {
  id: string;
  sku: string;
  qty: number;
  cbm: number;
  skuMemo: string | null;
  remainingStockQty: number;
  categoryCode?: string | null;
  allocations?: ContainerListItemAllocation[];
}

export interface ContainerListRow {
  id: string;
  containerNumber: string;
  etaDate: string | null;
  actualArrivalDate: string | null;
  estLoadingDate: string | null;
  etdNgbDate: string | null;
  etaLaxLgbDate: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
  status: string;
  cbmCapacity: number;
  factoryName: string | null;
  origin: string | null;
  destWarehouse: string | null;
  note: string | null;
  itemCount: number;
  totalQty: number;
  totalCbm: number;
  items?: ContainerListItemRow[];
}

export interface ContainerSaveInput {
  number: string;
  eta: string;
  status?: "draft" | "final-list-sent" | "packing-list-received" | "complete";
  cbmCapacity: number;
  factory?: string;
  origin?: string;
  destination?: string;
  note?: string;
  estLoading?: string;
  etdNgb?: string;
  etaLaxLgb?: string;
  items: Array<{ sku: string; qty: number; cbm: number; skuMemo?: string }>;
}

export interface ContainerDetailsInput {
  number: string;
  eta: string;
  cbmCapacity: number;
  factory?: string;
  destination?: string;
  note?: string;
  estLoading?: string;
  etdNgb?: string;
  etaLaxLgb?: string;
}

export interface ExistingContainerRow {
  status: string;
  containerNumber: string;
  eta: string | null;
  cbmCapacity: number;
  factoryName: string | null;
  destWarehouse: string | null;
  note: string | null;
  estLoading: string | null;
  etdNgb: string | null;
  etaLaxLgb: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
}

export interface ContainerForDeleteRow {
  id: string;
  status: string;
  containerNumber: string;
  eta: string | null;
}

export interface AuditHistoryFilters {
  user?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditHistoryRow {
  id: string;
  containerId: string;
  containerNumber: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  ip: string | null;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ContainerItemRow {
  id: number;
  containerId: number;
  masterSku: string;
  cbmUnit: number;
  totalCbm: number;
}

export interface AllocateStockRow {
  id: string;
  masterSku: string;
  cbm: number;
  availableQty: number;
}

export interface DeallocateAllocationRow {
  id: string;
  containerId: string;
  masterSku: string;
  qty: number;
  status: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function serializeTime(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 5);
}

export const AUDIT_ACTIONS = new Set([
  "status_change",
  "details_update",
  "eta_change",
  "eta_lax_lgb_change",
  "confirmed_change",
  "items_update",
  "note_added",
  "create",
  "delete",
]);

export const ContainerPlanningRepository = {
  // ─── Container list (GET /api/containers) ──────────────────────────

  async listContainers(filters: ContainerListFilters): Promise<ContainerListRow[]> {
    const dbFilters: string[] = [];
    const params: unknown[] = [];
    const categoryParamIndex = filters.categoryCode
      ? (() => {
          params.push(filters.categoryCode);
          return params.length;
        })()
      : null;

    if (!filters.includeReceived) {
      dbFilters.push("c.status <> 'received'");
    }

    const destinationTerms = [filters.warehouseCode, filters.warehouseName, filters.city].filter(Boolean);
    if (destinationTerms.length > 0) {
      const destinationFilters = destinationTerms.map((term) => {
        params.push(`%${term}%`);
        return `COALESCE(c.dest_warehouse, '') ILIKE $${params.length}`;
      });
      dbFilters.push(`(${destinationFilters.join(" OR ")})`);
    }

    if (categoryParamIndex) {
      dbFilters.push(`(
        NOT EXISTS (
          SELECT 1
          FROM shipcore.fc_container_items ci_any
          WHERE ci_any.container_id = c.id
        )
        OR EXISTS (
          SELECT 1
          FROM shipcore.fc_container_items ci_filter
          JOIN shipcore.fc_products p_filter ON p_filter.master_sku = ci_filter.master_sku
          WHERE ci_filter.container_id = c.id
            AND p_filter.category_code = $${categoryParamIndex}
        )
      )`);
    }

    const where = dbFilters.length > 0 ? `WHERE ${dbFilters.join(" AND ")}` : "";
    const itemCategoryJoin = categoryParamIndex
      ? `JOIN shipcore.fc_products p_item ON p_item.master_sku = fc_container_items.master_sku
         AND p_item.category_code = $${categoryParamIndex}`
      : "";

    const result = await pool().query(
      `SELECT
         c.id::text AS id,
         c.container_number,
         c.eta_date,
         c.actual_arrival_date,
         c.status::text AS status,
         c.cbm_capacity::text AS cbm_capacity,
         c.factory_name,
         c.origin,
         c.dest_warehouse,
         c.note,
         c.est_loading_date,
         c.etd_ngb_date,
         c.eta_lax_lgb_date,
         c.confirmed_date,
         c.confirmed_time::text AS confirmed_time,
         COALESCE(item_summary.item_count, 0)::int AS item_count,
         COALESCE(item_summary.total_qty, 0)::int AS total_qty,
         COALESCE(item_summary.total_cbm, 0)::text AS total_cbm,
         COALESCE(item_summary.items, '[]'::json) AS items
       FROM shipcore.fc_containers c
       LEFT JOIN (
         SELECT
           fc_container_items.container_id,
           COUNT(*)::int AS item_count,
           COALESCE(SUM(fc_container_items.qty), 0)::int AS total_qty,
           COALESCE(SUM(fc_container_items.total_cbm), 0)::numeric AS total_cbm,
           json_agg(
             json_build_object(
               'id', fc_container_items.id::text,
               'sku', fc_container_items.master_sku,
               'qty', fc_container_items.qty,
               'cbm', COALESCE(
                 fc_container_items.cbm_unit,
                 CASE WHEN fc_container_items.qty > 0 THEN fc_container_items.total_cbm / fc_container_items.qty ELSE 0 END,
                 0
               ),
               'sku_memo', fc_container_items.sku_memo,
               'remaining_stock_qty', COALESCE((
                 SELECT SUM(s.total_qty)::int
                 FROM shipcore.fc_available_stock s
                 WHERE s.master_sku = fc_container_items.master_sku
                   AND s.source_type = 'remaining'
               ), 0),
               ${filters.timelineView ? `'categoryCode', p_item.category_code` : `'allocations', COALESCE((
                 SELECT json_agg(
                   json_build_object(
                     'id', allocation.id::text,
                     'stockId', stock.id::text,
                     'sourceType', stock.source_type,
                     'referenceNo', stock.reference_no,
                     'qty', allocation.qty,
                     'cbm', stock.cbm_unit
                   )
                   ORDER BY allocation.id
                 )
                 FROM shipcore.fc_container_item_allocations allocation
                 JOIN shipcore.fc_available_stock stock ON stock.id = allocation.source_stock_id
                 WHERE allocation.container_id = fc_container_items.container_id
                   AND stock.master_sku = fc_container_items.master_sku
               ), '[]'::json)`}
             )
             ORDER BY fc_container_items.id
           ) AS items
         FROM shipcore.fc_container_items
         ${itemCategoryJoin || "LEFT JOIN shipcore.fc_products p_item ON p_item.master_sku = fc_container_items.master_sku"}
         GROUP BY fc_container_items.container_id
       ) item_summary ON item_summary.container_id = c.id
       ${where}
       ORDER BY c.eta_date NULLS LAST, c.id DESC`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      containerNumber: row.container_number as string,
      etaDate: serializeDate(row.eta_date),
      actualArrivalDate: serializeDate(row.actual_arrival_date),
      estLoadingDate: serializeDate(row.est_loading_date),
      etdNgbDate: serializeDate(row.etd_ngb_date),
      etaLaxLgbDate: serializeDate(row.eta_lax_lgb_date),
      confirmedDate: serializeDate(row.confirmed_date),
      confirmedTime: serializeTime(row.confirmed_time),
      status: row.status as string,
      cbmCapacity: Number(row.cbm_capacity ?? 0),
      factoryName: row.factory_name as string | null,
      origin: row.origin as string | null,
      destWarehouse: row.dest_warehouse as string | null,
      note: row.note as string | null,
      itemCount: Number(row.item_count ?? 0),
      totalQty: Number(row.total_qty ?? 0),
      totalCbm: Number(row.total_cbm ?? 0),
      ...(filters.includeDetails
        ? {
            items: ((row.items ?? []) as Array<{
              id?: string;
              sku?: string;
              qty?: number;
              cbm?: string | number;
              sku_memo?: string | null;
              remaining_stock_qty?: number | null;
              categoryCode?: string | null;
              allocations?: Array<{
                id: string;
                stockId: string;
                sourceType: string;
                referenceNo: string;
                qty: number;
                cbm: string | number;
              }>;
            }>).map((item) => ({
              id: item.id ?? "",
              sku: item.sku ?? "",
              qty: Number(item.qty ?? 0),
              cbm: Number(item.cbm ?? 0),
              skuMemo: item.sku_memo ?? null,
              remainingStockQty: Number(item.remaining_stock_qty ?? 0),
              ...(filters.timelineView ? { categoryCode: item.categoryCode ?? null } : {}),
              ...(!filters.timelineView
                ? {
                    allocations: (item.allocations ?? []).map((allocation) => ({
                      ...allocation,
                      qty: Number(allocation.qty ?? 0),
                      cbm: Number(allocation.cbm ?? 0),
                    })),
                  }
                : {}),
            })),
          }
        : {}),
    }));
  },

  // ─── Container CRUD ─────────────────────────────────────────────────

  async findMissingSkus(skus: string[], executor: SqlExecutor = pool()): Promise<string[]> {
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    const existing = new Set(result.rows.map((row) => row.master_sku));
    return skus.filter((sku) => !existing.has(sku));
  },

  async insertContainer(input: ContainerSaveInput, dbStatus: string, executor: SqlExecutor = pool()): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO shipcore.fc_containers
         (container_number, eta_date, status, cbm_capacity, factory_name, origin, dest_warehouse, note, est_loading_date, etd_ngb_date, eta_lax_lgb_date, created_at, updated_at)
       VALUES ($1, $2::date, $3::shipcore.fc_container_status, $4::numeric, $5, $6, $7, $8, $9::date, $10::date, $11::date, NOW(), NOW())
       RETURNING id::text`,
      [
        input.number.trim(),
        input.eta,
        dbStatus,
        input.cbmCapacity,
        input.factory?.trim() || null,
        input.origin?.trim() || null,
        input.destination?.trim() || null,
        input.note?.trim() || null,
        input.estLoading?.trim() || null,
        input.etdNgb?.trim() || null,
        input.etaLaxLgb?.trim() || null,
      ],
    );
    return result.rows[0].id;
  },

  async insertContainerItems(
    containerId: string,
    items: Array<{ sku: string; qty: number; cbm: number; skuMemo?: string }>,
    executor: SqlExecutor = pool(),
  ): Promise<void> {
    for (const item of items) {
      await executor.query(
        `INSERT INTO shipcore.fc_container_items
           (container_id, master_sku, qty, cbm_unit, sku_memo, created_at, updated_at)
         VALUES ($1::bigint, $2, $3::int, $4::numeric(14,6), $5, NOW(), NOW())`,
        [containerId, item.sku.trim().toUpperCase(), item.qty, item.cbm, item.skuMemo || null],
      );
    }
  },

  async getContainer(id: string, executor: SqlExecutor = pool()): Promise<ExistingContainerRow | null> {
    const result = await executor.query(
      `SELECT status::text AS status,
              container_number,
              eta_date::text AS eta,
              cbm_capacity,
              factory_name,
              dest_warehouse,
              note,
              est_loading_date::text AS est_loading,
              etd_ngb_date::text AS etd_ngb,
              eta_lax_lgb_date::text AS eta_lax_lgb,
              confirmed_date::text AS confirmed_date,
              confirmed_time::text AS confirmed_time
       FROM shipcore.fc_containers WHERE id = $1::bigint`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      status: row.status,
      containerNumber: row.container_number,
      eta: row.eta,
      cbmCapacity: row.cbm_capacity,
      factoryName: row.factory_name,
      destWarehouse: row.dest_warehouse,
      note: row.note,
      estLoading: row.est_loading,
      etdNgb: row.etd_ngb,
      etaLaxLgb: row.eta_lax_lgb,
      confirmedDate: row.confirmed_date,
      confirmedTime: row.confirmed_time,
    };
  },

  async lockContainer(id: string, executor: SqlExecutor): Promise<boolean> {
    const result = await executor.query(`SELECT id FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`, [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async updateStatus(id: string, dbStatus: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_containers
       SET status = $2::shipcore.fc_container_status,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, dbStatus],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async updateConfirmed(
    id: string,
    confirmedDate: string | null,
    confirmedTime: string | null,
    executor: SqlExecutor = pool(),
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_containers
       SET confirmed_date = $2::date,
           confirmed_time = $3::time,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, confirmedDate, confirmedTime],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async updateDetails(id: string, details: ContainerDetailsInput, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_containers
       SET container_number = $2,
           eta_date = $3::date,
           cbm_capacity = $4::numeric,
           factory_name = $5,
           dest_warehouse = $6,
           note = $7,
           est_loading_date = $8::date,
           etd_ngb_date = $9::date,
           eta_lax_lgb_date = $10::date,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [
        id,
        details.number,
        details.eta,
        details.cbmCapacity,
        details.factory || null,
        details.destination || null,
        details.note || null,
        details.estLoading?.trim() || null,
        details.etdNgb?.trim() || null,
        details.etaLaxLgb?.trim() || null,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async updateEta(id: string, eta: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_containers
       SET eta_date = $2::date,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, eta],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async updateEtaLaxLgb(id: string, etaLaxLgbDate: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_containers
       SET eta_lax_lgb_date = $2::date,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id`,
      [id, etaLaxLgbDate],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getItemSummary(containerId: string, executor: SqlExecutor): Promise<{ skuCount: number; totalQty: number }> {
    const result = await executor.query<{ sku_count: number; total_qty: number }>(
      `SELECT COUNT(id)::int AS sku_count,
              COALESCE(SUM(qty), 0)::int AS total_qty
       FROM shipcore.fc_container_items
       WHERE container_id = $1::bigint`,
      [containerId],
    );
    return { skuCount: result.rows[0]!.sku_count, totalQty: result.rows[0]!.total_qty };
  },

  async replaceContainerFull(id: string, validated: ContainerSaveInput, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_containers
       SET container_number = $2,
           eta_date = $3::date,
           cbm_capacity = $4::numeric,
           factory_name = $5,
           origin = $6,
           dest_warehouse = $7,
           note = $8,
           est_loading_date = $9::date,
           etd_ngb_date = $10::date,
           eta_lax_lgb_date = $11::date,
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [
        id,
        validated.number.trim(),
        validated.eta,
        validated.cbmCapacity,
        validated.factory?.trim() || null,
        validated.origin?.trim() || null,
        validated.destination?.trim() || null,
        validated.note?.trim() || null,
        validated.estLoading?.trim() || null,
        validated.etdNgb?.trim() || null,
        validated.etaLaxLgb?.trim() || null,
      ],
    );

    if (validated.items.length > 0) {
      await executor.query(`DELETE FROM shipcore.fc_container_items WHERE container_id = $1::bigint`, [id]);
      await this.insertContainerItems(id, validated.items, executor);
    }

    await executor.query(`DELETE FROM shipcore.fc_container_po_links WHERE container_id = $1::bigint`, [id]);
  },

  async getContainerForDelete(id: string, executor: SqlExecutor): Promise<ContainerForDeleteRow | null> {
    const result = await executor.query<{ id: string; status: string; container_number: string; eta: string | null }>(
      `SELECT id, status::text AS status, container_number,
              eta_date::text AS eta
       FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0]!;
    return { id: row.id, status: row.status, containerNumber: row.container_number, eta: row.eta };
  },

  async deleteContainerCascade(id: string, executor: SqlExecutor): Promise<string> {
    await executor.query(`DELETE FROM shipcore.fc_container_item_allocations WHERE container_id = $1::bigint`, [id]);
    await executor.query(`DELETE FROM shipcore.fc_container_items WHERE container_id = $1::bigint`, [id]);
    await executor.query(`DELETE FROM shipcore.fc_container_po_links WHERE container_id = $1::bigint`, [id]);
    const result = await executor.query<{ id: string }>(
      `DELETE FROM shipcore.fc_containers WHERE id = $1::bigint RETURNING id`,
      [id],
    );
    return String(result.rows[0]?.id ?? id);
  },

  // ─── Audit history ──────────────────────────────────────────────────

  async listAuditLog(containerId: string, filters: AuditHistoryFilters): Promise<AuditHistoryRow[]> {
    const dbFilters = ["container_id = $1::bigint", "deleted_at IS NULL"];
    const values: unknown[] = [containerId];
    let idx = 2;

    if (filters.user) {
      values.push(`%${filters.user}%`);
      dbFilters.push(`(
        COALESCE(user_name, '') ILIKE $${idx}
        OR COALESCE(user_email, '') ILIKE $${idx}
        OR COALESCE(user_id, '') ILIKE $${idx}
      )`);
      idx++;
    }

    if (filters.action && AUDIT_ACTIONS.has(filters.action)) {
      values.push(filters.action);
      dbFilters.push(`action = $${idx++}`);
    }

    if (filters.startDate) {
      values.push(filters.startDate);
      dbFilters.push(`created_at >= $${idx++}::date`);
    }

    if (filters.endDate) {
      values.push(filters.endDate);
      dbFilters.push(`created_at < ($${idx++}::date + INTERVAL '1 day')`);
    }

    const result = await pool().query(
      `SELECT id, container_id, container_number,
              user_id, user_name, user_email,
              action, before, after, note, ip, created_at, updated_at, updated_by
       FROM shipcore.fc_container_audit_log
       WHERE ${dbFilters.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 200`,
      values,
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      containerId: String(row.container_id),
      containerNumber: row.container_number as string | null,
      userId: row.user_id as string | null,
      userName: row.user_name as string | null,
      userEmail: row.user_email as string | null,
      action: row.action as string,
      before: row.before as Record<string, unknown> | null,
      after: row.after as Record<string, unknown> | null,
      note: row.note as string | null,
      ip: row.ip as string | null,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : null,
      updatedBy: row.updated_by as string | null,
    }));
  },

  async getContainerNumber(id: string, executor: SqlExecutor = pool()): Promise<string | null> {
    const result = await executor.query<{ container_number: string }>(
      `SELECT container_number FROM shipcore.fc_containers WHERE id = $1::bigint`,
      [id],
    );
    return result.rows[0]?.container_number ?? null;
  },

  async updateNote(noteId: string, containerId: string, note: string, userId: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_container_audit_log
       SET note = $3,
           updated_at = NOW(),
           updated_by = $4
       WHERE id = $1::bigint
         AND container_id = $2::bigint
         AND action = 'note_added'
         AND deleted_at IS NULL
       RETURNING id`,
      [noteId, containerId, note, userId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async softDeleteNote(noteId: string, containerId: string, userId: string, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query(
      `UPDATE shipcore.fc_container_audit_log
       SET deleted_at = NOW(),
           deleted_by = $3
       WHERE id = $1::bigint
         AND container_id = $2::bigint
         AND action = 'note_added'
         AND deleted_at IS NULL
       RETURNING id`,
      [noteId, containerId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  // ─── Container items ────────────────────────────────────────────────

  async getProductCbm(masterSku: string, executor: SqlExecutor = pool()): Promise<number | null> {
    const result = await executor.query<{ cbm_per_unit: string }>(
      `SELECT cbm_per_unit::float8 FROM shipcore.fc_products WHERE master_sku = $1 LIMIT 1`,
      [masterSku],
    );
    return result.rows[0] ? parseFloat(result.rows[0].cbm_per_unit) : null;
  },

  async getProductCbmMap(skus: string[], executor: SqlExecutor = pool()): Promise<Map<string, number>> {
    const result = await executor.query<{ master_sku: string; cbm_per_unit: string }>(
      `SELECT master_sku, cbm_per_unit::float8 FROM shipcore.fc_products WHERE master_sku = ANY($1)`,
      [skus],
    );
    return new Map(result.rows.map((row) => [row.master_sku, parseFloat(row.cbm_per_unit)]));
  },

  async upsertItem(
    containerId: number,
    masterSku: string,
    qty: number,
    cbmUnit: number,
    skuMemo: string | null,
    executor: SqlExecutor,
  ): Promise<{ id: number; cbmUnit: number; totalCbm: number; skuMemo: string | null }> {
    const result = await executor.query<{ id: number; cbm_unit: string; total_cbm: string; sku_memo: string | null }>(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, sku_memo, created_at, updated_at)
       VALUES ($1, $2, $3::int, $4::numeric(14,6), $5, NOW(), NOW())
       ON CONFLICT (container_id, master_sku) DO UPDATE
         SET qty = EXCLUDED.qty,
             cbm_unit = EXCLUDED.cbm_unit,
             sku_memo = EXCLUDED.sku_memo,
             updated_at = NOW()
       RETURNING id, cbm_unit::float8, total_cbm::float8, sku_memo`,
      [containerId, masterSku, qty, cbmUnit, skuMemo],
    );
    const row = result.rows[0];
    return { id: row.id, cbmUnit: parseFloat(row.cbm_unit), totalCbm: parseFloat(row.total_cbm), skuMemo: row.sku_memo };
  },

  async upsertItemForAutoFill(
    containerId: number,
    masterSku: string,
    qty: number,
    cbmUnit: number,
    executor: SqlExecutor,
  ): Promise<{ id: number; cbmUnit: number; totalCbm: number }> {
    const result = await executor.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       VALUES ($1, $2, $3::int, $4::numeric(14,6), NOW(), NOW())
       ON CONFLICT (container_id, master_sku) DO UPDATE
         SET qty        = EXCLUDED.qty,
             updated_at = NOW()
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [containerId, masterSku, qty, cbmUnit],
    );
    const row = result.rows[0];
    return { id: row.id, cbmUnit: parseFloat(row.cbm_unit), totalCbm: parseFloat(row.total_cbm) };
  },

  async getItemForUpdate(itemId: number, executor: SqlExecutor): Promise<ContainerItemRow | null> {
    const result = await executor.query<{ id: number; container_id: number; master_sku: string; cbm_unit: string; total_cbm: string }>(
      `SELECT id, container_id::int, master_sku, cbm_unit::float8, total_cbm::float8
       FROM shipcore.fc_container_items
       WHERE id = $1
       FOR UPDATE`,
      [itemId],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { id: row.id, containerId: row.container_id, masterSku: row.master_sku, cbmUnit: parseFloat(row.cbm_unit), totalCbm: parseFloat(row.total_cbm) };
  },

  async updateItemQty(itemId: number, qty: number, skuMemo: string | null, executor: SqlExecutor): Promise<{ cbmUnit: number; totalCbm: number }> {
    const result = await executor.query<{ id: number; cbm_unit: string; total_cbm: string }>(
      `UPDATE shipcore.fc_container_items
       SET qty = $1,
           sku_memo = $3,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, cbm_unit::float8, total_cbm::float8`,
      [qty, itemId, skuMemo],
    );
    const row = result.rows[0];
    return { cbmUnit: parseFloat(row.cbm_unit), totalCbm: parseFloat(row.total_cbm) };
  },

  async deleteItem(itemId: number, executor: SqlExecutor): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_container_items WHERE id = $1`, [itemId]);
  },

  // ─── Remaining/mistake stock allocation sync ────────────────────────
  // Auto-matches "remaining"/"mistake" available stock to a container
  // item's target qty. Used by the items and auto-fill routes (not the
  // manual allocate/deallocate flow below, which is user-driven).

  async syncRemainingAllocationForContainerItem(
    executor: SqlExecutor,
    input: { containerId: number; masterSku: string; targetQty: number },
  ): Promise<number> {
    const masterSku = input.masterSku.trim().toUpperCase();
    const targetQty = Math.max(0, Math.trunc(input.targetQty));

    const lockedStocks = await executor.query<{ id: string }>(
      `SELECT id::text
       FROM shipcore.fc_available_stock
       WHERE source_type IN ('remaining', 'mistake')
         AND master_sku = $1
       ORDER BY CASE source_type WHEN 'remaining' THEN 0 ELSE 1 END, id
       FOR UPDATE`,
      [masterSku],
    );

    if (lockedStocks.rowCount === 0) {
      return 0;
    }

    const stockIds = lockedStocks.rows.map((row) => row.id);
    const stockResult = await executor.query<{ id: string; total_qty: number; allocated_total: number; allocated_here: number }>(
      `SELECT
         s.id::text,
         s.total_qty::int,
         COALESCE(SUM(a.qty), 0)::int AS allocated_total,
         COALESCE(SUM(a.qty) FILTER (WHERE a.container_id = $1::bigint), 0)::int AS allocated_here
       FROM shipcore.fc_available_stock s
       LEFT JOIN shipcore.fc_container_item_allocations a ON a.source_stock_id = s.id
       WHERE s.id = ANY($2::bigint[])
       GROUP BY s.id
       ORDER BY s.id`,
      [input.containerId, stockIds],
    );

    await executor.query(
      `SELECT a.id
       FROM shipcore.fc_container_item_allocations a
       JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
       WHERE a.container_id = $1::bigint
         AND s.master_sku = $2
         AND s.source_type IN ('remaining', 'mistake')
       FOR UPDATE OF a`,
      [input.containerId, masterSku],
    );

    let qtyLeft = targetQty;
    let allocatedQty = 0;

    for (const stock of stockResult.rows) {
      const totalQty = Number(stock.total_qty);
      const allocatedTotal = Number(stock.allocated_total);
      const allocatedHere = Number(stock.allocated_here);
      const maxForThisContainer = Math.max(0, totalQty - (allocatedTotal - allocatedHere));
      const nextQty = Math.min(qtyLeft, maxForThisContainer);
      qtyLeft -= nextQty;
      allocatedQty += nextQty;

      if (nextQty > 0) {
        await executor.query(
          `INSERT INTO shipcore.fc_container_item_allocations
             (container_id, source_stock_id, qty, created_at, updated_at)
           VALUES ($1::bigint, $2::bigint, $3::int, NOW(), NOW())
           ON CONFLICT (container_id, source_stock_id) DO UPDATE SET
             qty = EXCLUDED.qty,
             updated_at = NOW()`,
          [input.containerId, stock.id, nextQty],
        );
      } else if (allocatedHere > 0) {
        await executor.query(
          `DELETE FROM shipcore.fc_container_item_allocations
           WHERE container_id = $1::bigint
             AND source_stock_id = $2::bigint`,
          [input.containerId, stock.id],
        );
      }
    }

    return allocatedQty;
  },

  async deleteRemainingAllocationsForContainerItem(
    executor: SqlExecutor,
    input: { containerId: number; masterSku: string },
  ): Promise<void> {
    await executor.query(
      `DELETE FROM shipcore.fc_container_item_allocations a
       USING shipcore.fc_available_stock s
       WHERE s.id = a.source_stock_id
         AND a.container_id = $1::bigint
         AND s.master_sku = $2
         AND s.source_type IN ('remaining', 'mistake')`,
      [input.containerId, input.masterSku.trim().toUpperCase()],
    );
  },

  // ─── Manual allocate / deallocate ───────────────────────────────────
  // User-driven: picking specific available-stock rows to allocate into a
  // (draft-only) container, or removing specific allocations.

  async lockContainerStatus(containerId: string, executor: SqlExecutor): Promise<string | null> {
    const result = await executor.query<{ status: string }>(
      `SELECT status::text FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`,
      [containerId],
    );
    return result.rows[0]?.status ?? null;
  },

  async lockAvailableStockForAllocate(stockIds: string[], executor: SqlExecutor): Promise<AllocateStockRow[]> {
    const result = await executor.query<{ id: string; master_sku: string; cbm: number; available_qty: number }>(
      `SELECT
         s.id::text,
         s.master_sku,
         s.cbm_unit::float8 AS cbm,
         (s.total_qty - COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0))::int AS available_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = ANY($1::bigint[])
       FOR UPDATE OF s`,
      [stockIds],
    );
    return result.rows.map((row) => ({ id: row.id, masterSku: row.master_sku, cbm: row.cbm, availableQty: row.available_qty }));
  },

  async bulkIncrementAllocations(containerId: string, stockIds: string[], qtys: number[], executor: SqlExecutor): Promise<void> {
    await executor.query(
      `INSERT INTO shipcore.fc_container_item_allocations (container_id, source_stock_id, qty)
       SELECT $1::bigint, stock_id, qty
       FROM unnest($2::bigint[], $3::int[]) AS allocation(stock_id, qty)
       ON CONFLICT (container_id, source_stock_id) DO UPDATE SET
         qty = shipcore.fc_container_item_allocations.qty + EXCLUDED.qty,
         updated_at = NOW()`,
      [containerId, stockIds, qtys],
    );
  },

  async bulkIncrementItems(containerId: string, skus: string[], qtys: number[], cbms: number[], executor: SqlExecutor): Promise<void> {
    await executor.query(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       SELECT $1::bigint, master_sku, qty, cbm, NOW(), NOW()
       FROM unnest($2::text[], $3::int[], $4::numeric[]) AS item(master_sku, qty, cbm)
       ON CONFLICT (container_id, master_sku) DO UPDATE SET
         qty = shipcore.fc_container_items.qty + EXCLUDED.qty,
         cbm_unit = EXCLUDED.cbm_unit,
         updated_at = NOW()`,
      [containerId, skus, qtys, cbms],
    );
  },

  async lockAllocationsForDeallocate(allocationIds: string[], executor: SqlExecutor): Promise<DeallocateAllocationRow[]> {
    const result = await executor.query<{ id: string; container_id: string; master_sku: string; qty: number; status: string }>(
      `SELECT
         a.id::text,
         a.container_id::text,
         s.master_sku,
         a.qty::int,
         c.status::text
       FROM shipcore.fc_container_item_allocations a
       JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
       JOIN shipcore.fc_containers c ON c.id = a.container_id
       WHERE a.id = ANY($1::bigint[])
       FOR UPDATE OF a, c`,
      [allocationIds],
    );
    return result.rows.map((row) => ({ id: row.id, containerId: row.container_id, masterSku: row.master_sku, qty: row.qty, status: row.status }));
  },

  async getItemQtysBySku(containerId: string, skus: string[], executor: SqlExecutor): Promise<Map<string, number>> {
    const result = await executor.query<{ master_sku: string; qty: number }>(
      `SELECT master_sku, qty::int
       FROM shipcore.fc_container_items
       WHERE container_id = $1::bigint
         AND master_sku = ANY($2::text[])
       FOR UPDATE`,
      [containerId, skus],
    );
    return new Map(result.rows.map((row) => [row.master_sku, row.qty]));
  },

  async deleteAllocationsByIds(allocationIds: string[], executor: SqlExecutor): Promise<void> {
    await executor.query(`DELETE FROM shipcore.fc_container_item_allocations WHERE id = ANY($1::bigint[])`, [allocationIds]);
  },

  async decrementOrDeleteItemsBySku(containerId: string, skus: string[], removeQtys: number[], executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_container_items ci
       SET qty = ci.qty - removed.remove_qty,
           updated_at = NOW()
       FROM (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty > removed.remove_qty`,
      [containerId, skus, removeQtys],
    );

    await executor.query(
      `DELETE FROM shipcore.fc_container_items ci
       USING (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty = removed.remove_qty`,
      [containerId, skus, removeQtys],
    );
  },
};
