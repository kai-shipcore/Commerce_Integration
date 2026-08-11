/**
 * Pure data access for the pieces of the Demand Planning dashboard
 * (`/planning/dashboard-ag-grid`) that this app owns outright: shared
 * master-SKU notes (fc_planning_sku_notes), short workflow labels
 * (fc_planning_sku_work_notes), the CBM-per-unit inline editor (fc_products,
 * cascading to fc_container_items), and the read-only OOS lost-demand-weight
 * preview (fc_velocity_link_snapshot).
 *
 * The dashboard also calls several container-planning-owned endpoints
 * (containers/items*, containers/[id]/auto-fill, and the PATCH branch of
 * /api/containers) — those are NOT part of this repository; they're left
 * untouched for the future container-planning domain, same as the
 * allocate/deallocate split in src/lib/available-stock/repository.ts.
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

// Field names intentionally match the original route's DB column aliases
// (snake_case) rather than the codebase's usual camelCase mapping — the
// frontend already consumes this exact shape.
export interface ContainerItemCbmRow {
  item_id: number;
  container_name: string;
  cbm_unit: number;
  total_cbm: number;
}

export const PlanningDashboardRepository = {
  async listSkuNotes(): Promise<Array<{ masterSku: string; note: string }>> {
    const result = await pool().query<{ master_sku: string; note: string }>(
      `SELECT master_sku, note
       FROM shipcore.fc_planning_sku_notes
       WHERE NULLIF(BTRIM(note), '') IS NOT NULL
       ORDER BY master_sku`,
    );
    return result.rows.map((row) => ({ masterSku: row.master_sku, note: row.note }));
  },

  async deleteSkuNote(sku: string): Promise<void> {
    await pool().query(`DELETE FROM shipcore.fc_planning_sku_notes WHERE master_sku = $1`, [sku]);
  },

  async upsertSkuNote(sku: string, note: string, updatedBy: string | null): Promise<void> {
    await pool().query(
      `INSERT INTO shipcore.fc_planning_sku_notes (master_sku, note, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (master_sku) DO UPDATE
         SET note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [sku, note, updatedBy],
    );
  },

  async listSkuWorkNotes(): Promise<Array<{ masterSku: string; note: string }>> {
    const result = await pool().query<{ master_sku: string; note: string }>(
      `SELECT master_sku, note
       FROM shipcore.fc_planning_sku_work_notes
       WHERE NULLIF(BTRIM(note), '') IS NOT NULL
       ORDER BY master_sku`,
    );
    return result.rows.map((row) => ({ masterSku: row.master_sku, note: row.note }));
  },

  async deleteSkuWorkNote(sku: string): Promise<void> {
    await pool().query(`DELETE FROM shipcore.fc_planning_sku_work_notes WHERE master_sku = $1`, [sku]);
  },

  async upsertSkuWorkNote(sku: string, note: string, updatedBy: string | null): Promise<void> {
    await pool().query(
      `INSERT INTO shipcore.fc_planning_sku_work_notes (master_sku, note, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (master_sku) DO UPDATE
         SET note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [sku, note, updatedBy],
    );
  },

  async getProductCbmForUpdate(sku: string, executor: SqlExecutor): Promise<number | null> {
    const result = await executor.query<{ cbm_per_unit: number | null }>(
      `SELECT cbm_per_unit::float8 AS cbm_per_unit
       FROM shipcore.fc_products
       WHERE master_sku = $1
       FOR UPDATE`,
      [sku],
    );
    return result.rows[0]?.cbm_per_unit ?? null;
  },

  async updateProductCbm(sku: string, cbm: number, executor: SqlExecutor): Promise<void> {
    await executor.query(
      `UPDATE shipcore.fc_products SET cbm_per_unit = $2::numeric(14,6), updated_at = NOW() WHERE master_sku = $1`,
      [sku, cbm],
    );
  },

  async cascadeContainerItemsCbm(sku: string, cbm: number, executor: SqlExecutor): Promise<ContainerItemCbmRow[]> {
    const result = await executor.query<{ item_id: number; container_name: string; cbm_unit: number; total_cbm: number }>(
      `UPDATE shipcore.fc_container_items ci
       SET cbm_unit   = $2::numeric(14,6),
           updated_at = NOW()
       FROM shipcore.fc_containers c
       WHERE ci.container_id = c.id
         AND ci.master_sku = $1
       RETURNING
         ci.id::int              AS item_id,
         c.container_number      AS container_name,
         ci.cbm_unit::float8     AS cbm_unit,
         ci.total_cbm::float8    AS total_cbm`,
      [sku, cbm],
    );
    return result.rows;
  },

  async getOosLostDemandChannelTotals(): Promise<Array<{
    category_code: string;
    shopify_90d: string;
    amazon_90d: string;
    ebay_90d: string;
    walmart_90d: string;
  }>> {
    const SHOPIFY_CHANNELS = `'Coverland B2C','Coverland B2B','Icarcover'`;
    const AMAZON_CHANNELS = `'Amazon FBA','Amazon FBM'`;
    const EBAY_CHANNELS = `'Auto_Armor','Advance_Parts'`;

    const result = await pool().query<{
      category_code: string;
      shopify_90d: string;
      amazon_90d: string;
      ebay_90d: string;
      walmart_90d: string;
    }>(`
      SELECT
        COALESCE(p.category_code, 'SC') AS category_code,
        SUM(CASE WHEN v.channel IN (${SHOPIFY_CHANNELS}) AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS shopify_90d,
        SUM(CASE WHEN v.channel IN (${AMAZON_CHANNELS})  AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS amazon_90d,
        SUM(CASE WHEN v.channel IN (${EBAY_CHANNELS})    AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS ebay_90d,
        SUM(CASE WHEN v.channel = 'Walmart'              AND v.order_date >= CURRENT_DATE - 91 AND v.order_date <= CURRENT_DATE - 2 THEN v.link_qty ELSE 0 END)::numeric AS walmart_90d
      FROM shipcore.fc_velocity_link_snapshot v
      LEFT JOIN shipcore.fc_products p ON p.master_sku = v.link_master_sku
      GROUP BY COALESCE(p.category_code, 'SC')
    `);
    return result.rows;
  },
};
