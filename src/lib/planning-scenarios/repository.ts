/**
 * Data access for Demand Planning scenario tabs
 * (shipcore.fc_planning_scenarios and its two overlay tables).
 *
 * Raw SQL only — the planning tables are not Prisma models. Kept separate from
 * `src/lib/planning/`, which is DB-free calculation helpers.
 */

import type { PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";

export type ScenarioVisibility = "private" | "shared";

export interface ScenarioRow {
  id: string;
  name: string;
  owner_user_id: string;
  visibility: ScenarioVisibility;
  locked_by: string | null;
  locked_at: Date | null;
  sort_order: number;
  color: string | null;
  view_state: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ScenarioItemRow {
  container_id: string;
  master_sku: string;
  qty: number;
}

export interface ScenarioContainerRow {
  container_id: string;
  eta_date: string | null;
}

/** One cell's worth of scenario quantity, as the grid addresses it. */
export interface ScenarioItemInput {
  container_id: number;
  master_sku: string;
  qty: number;
}

/** The container statuses the demand grid treats as inbound, matching
 *  `DemandPlanningService`'s own filter. */
export function inboundStatuses(includeDrafts: boolean): string[] {
  return includeDrafts
    ? ["shipped", "packing_received", "draft"]
    : ["shipped", "packing_received"];
}

const SCENARIO_COLUMNS = `
  id::text AS id,
  name,
  owner_user_id,
  visibility,
  locked_by,
  locked_at,
  sort_order,
  color,
  view_state,
  created_at,
  updated_at
`;

type Queryable = Pick<PoolClient, "query">;

function db(client?: Queryable): Queryable {
  return client ?? getPrimaryPool();
}

export const PlanningScenarioRepository = {
  /** Every tab the user is allowed to see: their own, plus shared ones. */
  async listVisible(userId: string): Promise<ScenarioRow[]> {
    const result = await getPrimaryPool().query<ScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS}
         FROM shipcore.fc_planning_scenarios
        WHERE owner_user_id = $1 OR visibility = 'shared'
        ORDER BY sort_order, id`,
      [userId],
    );
    return result.rows;
  },

  async getById(id: number, client?: Queryable): Promise<ScenarioRow | null> {
    const result = await db(client).query<ScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS} FROM shipcore.fc_planning_scenarios WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async insert(input: {
    name: string;
    ownerUserId: string;
    visibility: ScenarioVisibility;
    color: string | null;
    viewState: Record<string, unknown>;
  }, client?: Queryable): Promise<ScenarioRow> {
    const result = await db(client).query<ScenarioRow>(
      `INSERT INTO shipcore.fc_planning_scenarios
         (name, owner_user_id, visibility, color, view_state, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb,
         COALESCE((SELECT MAX(sort_order) + 1 FROM shipcore.fc_planning_scenarios), 0))
       RETURNING ${SCENARIO_COLUMNS}`,
      [input.name, input.ownerUserId, input.visibility, input.color, JSON.stringify(input.viewState)],
    );
    return result.rows[0];
  },

  /** Partial update. Undefined fields are left alone; `color` accepts null. */
  async update(id: number, patch: {
    name?: string;
    visibility?: ScenarioVisibility;
    color?: string | null;
    viewState?: Record<string, unknown>;
  }): Promise<ScenarioRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];

    if (patch.name !== undefined) {
      params.push(patch.name);
      sets.push(`name = $${params.length}`);
    }
    if (patch.visibility !== undefined) {
      params.push(patch.visibility);
      sets.push(`visibility = $${params.length}`);
    }
    if (patch.color !== undefined) {
      params.push(patch.color);
      sets.push(`color = $${params.length}`);
    }
    if (patch.viewState !== undefined) {
      params.push(JSON.stringify(patch.viewState));
      sets.push(`view_state = $${params.length}::jsonb`);
    }
    if (sets.length === 0) return PlanningScenarioRepository.getById(id);

    const result = await getPrimaryPool().query<ScenarioRow>(
      `UPDATE shipcore.fc_planning_scenarios
          SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $1
        RETURNING ${SCENARIO_COLUMNS}`,
      params,
    );
    return result.rows[0] ?? null;
  },

  async setLock(id: number, lockedBy: string | null): Promise<ScenarioRow | null> {
    const result = await getPrimaryPool().query<ScenarioRow>(
      `UPDATE shipcore.fc_planning_scenarios
          SET locked_by = $2,
              locked_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
              updated_at = now()
        WHERE id = $1
        RETURNING ${SCENARIO_COLUMNS}`,
      [id, lockedBy],
    );
    return result.rows[0] ?? null;
  },

  async delete(id: number): Promise<boolean> {
    const result = await getPrimaryPool().query(
      `DELETE FROM shipcore.fc_planning_scenarios WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Writes the given order as sort_order 0..n-1, ignoring unknown ids. */
  async reorder(orderedIds: number[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await getPrimaryPool().query(
      `UPDATE shipcore.fc_planning_scenarios AS s
          SET sort_order = o.ord - 1, updated_at = now()
         FROM UNNEST($1::bigint[]) WITH ORDINALITY AS o(id, ord)
        WHERE s.id = o.id`,
      [orderedIds],
    );
  },

  // ─── Overlay: quantities ─────────────────────────────────────────────

  async getItems(scenarioId: number, client?: Queryable): Promise<ScenarioItemRow[]> {
    const result = await db(client).query<ScenarioItemRow>(
      `SELECT container_id::text AS container_id, master_sku, qty
         FROM shipcore.fc_planning_scenario_items
        WHERE scenario_id = $1
        ORDER BY container_id, master_sku`,
      [scenarioId],
    );
    return result.rows;
  },

  async upsertItems(scenarioId: number, items: ScenarioItemInput[], client?: Queryable): Promise<void> {
    if (items.length === 0) return;

    const params: unknown[] = [scenarioId];
    const tuples = items.map((item) => {
      params.push(item.container_id, item.master_sku, item.qty);
      return `($1, $${params.length - 2}, $${params.length - 1}, $${params.length})`;
    });

    await db(client).query(
      `INSERT INTO shipcore.fc_planning_scenario_items
         (scenario_id, container_id, master_sku, qty)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (scenario_id, container_id, master_sku) DO UPDATE
         SET qty = EXCLUDED.qty, updated_at = now()`,
      params,
    );
  },

  /** Drops overlay rows so those cells fall back to the Live quantity. */
  async deleteItems(
    scenarioId: number,
    cells: Array<{ container_id: number; master_sku: string }>,
    client?: Queryable,
  ): Promise<void> {
    if (cells.length === 0) return;

    const params: unknown[] = [scenarioId];
    const tuples = cells.map((cell) => {
      params.push(cell.container_id, cell.master_sku);
      return `($${params.length - 1}::bigint, $${params.length}::text)`;
    });

    await db(client).query(
      `DELETE FROM shipcore.fc_planning_scenario_items
        WHERE scenario_id = $1
          AND (container_id, master_sku) IN (${tuples.join(", ")})`,
      params,
    );
  },

  // ─── Overlay: container-level (ETA) ──────────────────────────────────

  async getContainerOverrides(scenarioId: number, client?: Queryable): Promise<ScenarioContainerRow[]> {
    const result = await db(client).query<ScenarioContainerRow>(
      `SELECT container_id::text AS container_id,
              to_char(eta_date, 'YYYY-MM-DD') AS eta_date
         FROM shipcore.fc_planning_scenario_containers
        WHERE scenario_id = $1
        ORDER BY container_id`,
      [scenarioId],
    );
    return result.rows;
  },

  async upsertContainerOverride(
    scenarioId: number,
    containerId: number,
    etaDate: string | null,
    client?: Queryable,
  ): Promise<void> {
    await db(client).query(
      `INSERT INTO shipcore.fc_planning_scenario_containers
         (scenario_id, container_id, eta_date)
       VALUES ($1, $2, $3::date)
       ON CONFLICT (scenario_id, container_id) DO UPDATE
         SET eta_date = EXCLUDED.eta_date, updated_at = now()`,
      [scenarioId, containerId, etaDate],
    );
  },

  // ─── Copy ────────────────────────────────────────────────────────────

  /** Copies one scenario's whole overlay onto another. */
  async copyOverlay(fromScenarioId: number, toScenarioId: number, client?: Queryable): Promise<void> {
    await db(client).query(
      `INSERT INTO shipcore.fc_planning_scenario_items
         (scenario_id, container_id, master_sku, qty)
       SELECT $2, container_id, master_sku, qty
         FROM shipcore.fc_planning_scenario_items
        WHERE scenario_id = $1
       ON CONFLICT (scenario_id, container_id, master_sku) DO UPDATE
         SET qty = EXCLUDED.qty, updated_at = now()`,
      [fromScenarioId, toScenarioId],
    );
    await db(client).query(
      `INSERT INTO shipcore.fc_planning_scenario_containers
         (scenario_id, container_id, eta_date)
       SELECT $2, container_id, eta_date
         FROM shipcore.fc_planning_scenario_containers
        WHERE scenario_id = $1
       ON CONFLICT (scenario_id, container_id) DO UPDATE
         SET eta_date = EXCLUDED.eta_date, updated_at = now()`,
      [fromScenarioId, toScenarioId],
    );
  },

  /**
   * Snapshots the Live plan into a scenario's overlay — how "duplicate the
   * Live tab" gets its starting numbers. Only containers still in the inbound
   * set are copied, matching what the grid shows as columns.
   */
  async snapshotLiveIntoScenario(
    toScenarioId: number,
    includeDrafts: boolean,
    client?: Queryable,
  ): Promise<void> {
    await db(client).query(
      `INSERT INTO shipcore.fc_planning_scenario_items
         (scenario_id, container_id, master_sku, qty)
       SELECT $1, i.container_id, i.master_sku, SUM(i.qty)::int
         FROM shipcore.fc_container_items i
         JOIN shipcore.fc_containers c ON c.id = i.container_id
        WHERE c.status::text = ANY($2::text[])
        GROUP BY i.container_id, i.master_sku
       ON CONFLICT (scenario_id, container_id, master_sku) DO UPDATE
         SET qty = EXCLUDED.qty, updated_at = now()`,
      [toScenarioId, inboundStatuses(includeDrafts)],
    );
  },

  // ─── Apply ───────────────────────────────────────────────────────────

  /**
   * The Live quantities a scenario would be applied against, for the same
   * inbound containers the grid shows. `fc_container_items` has no unique key
   * on (container_id, master_sku), so duplicates are summed here the same way
   * the dashboard's cross-data query does, and every underlying row id is
   * carried along so an apply can delete all of them.
   */
  async getLiveQuantities(includeDrafts: boolean, client?: Queryable): Promise<Array<{
    container_id: string;
    master_sku: string;
    qty: number;
    item_ids: number[];
  }>> {
    const result = await db(client).query<{
      container_id: string;
      master_sku: string;
      qty: number;
      item_ids: number[];
    }>(
      `SELECT i.container_id::text AS container_id,
              i.master_sku,
              SUM(i.qty)::int AS qty,
              ARRAY_AGG(i.id ORDER BY i.id) AS item_ids
         FROM shipcore.fc_container_items i
         JOIN shipcore.fc_containers c ON c.id = i.container_id
        WHERE c.status::text = ANY($1::text[])
        GROUP BY i.container_id, i.master_sku`,
      [inboundStatuses(includeDrafts)],
    );
    return result.rows;
  },

  /** ETA dates of the inbound containers, for diffing a scenario's overrides. */
  async getLiveEtas(includeDrafts: boolean, client?: Queryable): Promise<Array<{
    container_id: string;
    eta_date: string | null;
  }>> {
    const result = await db(client).query<{ container_id: string; eta_date: string | null }>(
      `SELECT id::text AS container_id, to_char(eta_date, 'YYYY-MM-DD') AS eta_date
         FROM shipcore.fc_containers
        WHERE status::text = ANY($1::text[])`,
      [inboundStatuses(includeDrafts)],
    );
    return result.rows;
  },
};
