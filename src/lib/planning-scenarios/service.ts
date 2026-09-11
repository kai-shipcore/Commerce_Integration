/**
 * Business rules for Demand Planning scenario tabs.
 *
 * A scenario is a what-if copy of the plan: its container quantities and ETAs
 * live in overlay tables and never reach `fc_container_items` /
 * `fc_containers` until someone explicitly applies them to Live. The grid
 * already treats its own `qtyOverrides` map as the source of displayed
 * quantities, so a scenario is just that map seeded from the server.
 */

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { ContainerPlanningService } from "@/lib/container-planning/service";
import {
  PlanningScenarioRepository,
  type ScenarioItemInput,
  type ScenarioRow,
  type ScenarioVisibility,
} from "@/lib/planning-scenarios/repository";

export interface ScenarioActor {
  userId: string;
  role: string;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
}

/** What the client needs to render a tab. `view_state` is omitted from the
 *  list response — it is large and only the active tab's is needed. */
export interface ScenarioSummary {
  id: string;
  name: string;
  owner_user_id: string;
  is_owner: boolean;
  visibility: ScenarioVisibility;
  locked_by: string | null;
  locked_at: string | null;
  can_edit: boolean;
  sort_order: number;
  color: string | null;
}

export interface ScenarioDetail extends ScenarioSummary {
  view_state: Record<string, unknown>;
}

/** One cell as the grid sends it. A null qty clears the override so the cell
 *  falls back to the Live quantity — distinct from qty 0, which means "this
 *  scenario deliberately ships none of this SKU in that container". */
export interface ScenarioItemPatch {
  container_id: number;
  master_sku: string;
  qty: number | null;
}

export interface ApplyDiff {
  added: Array<{ container_id: number; master_sku: string; qty: number }>;
  changed: Array<{ container_id: number; master_sku: string; from: number; to: number }>;
  removed: Array<{ container_id: number; master_sku: string; from: number; item_ids: number[] }>;
  eta_changes: Array<{ container_id: number; from: string | null; to: string }>;
}

function isAdmin(actor: ScenarioActor): boolean {
  return actor.role === "admin" || actor.role === "dev";
}

function canView(scenario: ScenarioRow, actor: ScenarioActor): boolean {
  return scenario.owner_user_id === actor.userId || scenario.visibility === "shared";
}

/** Locked tabs stay editable for the lock holder, the owner, and admins —
 *  otherwise a colleague could lock an owner out of their own tab. */
function canEdit(scenario: ScenarioRow, actor: ScenarioActor): boolean {
  if (!canView(scenario, actor)) return false;
  if (!scenario.locked_by) return true;
  return scenario.locked_by === actor.userId
    || scenario.owner_user_id === actor.userId
    || isAdmin(actor);
}

function toSummary(scenario: ScenarioRow, actor: ScenarioActor): ScenarioSummary {
  return {
    id: scenario.id,
    name: scenario.name,
    owner_user_id: scenario.owner_user_id,
    is_owner: scenario.owner_user_id === actor.userId,
    visibility: scenario.visibility,
    locked_by: scenario.locked_by,
    locked_at: scenario.locked_at ? scenario.locked_at.toISOString() : null,
    can_edit: canEdit(scenario, actor),
    sort_order: scenario.sort_order,
    color: scenario.color,
  };
}

function toDetail(scenario: ScenarioRow, actor: ScenarioActor): ScenarioDetail {
  return { ...toSummary(scenario, actor), view_state: scenario.view_state ?? {} };
}

function parseId(raw: string | number): number {
  const id = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("Invalid scenario id");
  return id;
}

async function loadViewable(rawId: string | number, actor: ScenarioActor): Promise<ScenarioRow> {
  const scenario = await PlanningScenarioRepository.getById(parseId(rawId));
  // A tab the user may not see is reported as missing rather than forbidden,
  // so the response does not confirm that someone else's tab exists.
  if (!scenario || !canView(scenario, actor)) throw new NotFoundError("Scenario not found");
  return scenario;
}

async function loadEditable(rawId: string | number, actor: ScenarioActor): Promise<ScenarioRow> {
  const scenario = await loadViewable(rawId, actor);
  if (!canEdit(scenario, actor)) {
    throw new ForbiddenError(
      scenario.locked_by ? "This tab is locked for editing." : "You cannot edit this tab.",
    );
  }
  return scenario;
}

export const PlanningScenarioService = {
  async list(actor: ScenarioActor): Promise<ScenarioSummary[]> {
    const rows = await PlanningScenarioRepository.listVisible(actor.userId);
    return rows.map((row) => toSummary(row, actor));
  },

  async get(rawId: string | number, actor: ScenarioActor): Promise<ScenarioDetail> {
    return toDetail(await loadViewable(rawId, actor), actor);
  },

  async create(actor: ScenarioActor, input: {
    name: string;
    visibility?: ScenarioVisibility;
    color?: string | null;
    viewState?: Record<string, unknown>;
  }): Promise<ScenarioDetail> {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Tab name is required");

    const row = await PlanningScenarioRepository.insert({
      name,
      ownerUserId: actor.userId,
      visibility: input.visibility ?? "private",
      color: input.color ?? null,
      viewState: input.viewState ?? {},
    });
    return toDetail(row, actor);
  },

  /**
   * Copies a tab. `fromId` of null means "copy the Live tab", which snapshots
   * the current real container quantities into the new scenario's overlay so
   * the copy opens showing exactly what Live shows.
   */
  async duplicate(actor: ScenarioActor, input: {
    fromId: string | number | null;
    name: string;
    includeDrafts?: boolean;
    viewState?: Record<string, unknown>;
  }): Promise<ScenarioDetail> {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Tab name is required");

    let viewState = input.viewState ?? {};
    let source: ScenarioRow | null = null;
    if (input.fromId !== null) {
      source = await loadViewable(input.fromId, actor);
      viewState = input.viewState ?? source.view_state ?? {};
    }

    const created = await PlanningScenarioRepository.insert({
      name,
      ownerUserId: actor.userId,
      visibility: "private",
      color: source?.color ?? null,
      viewState,
    });

    const newId = parseId(created.id);
    if (source) {
      await PlanningScenarioRepository.copyOverlay(parseId(source.id), newId);
    } else {
      await PlanningScenarioRepository.snapshotLiveIntoScenario(newId, input.includeDrafts ?? false);
    }

    return toDetail(created, actor);
  },

  async update(rawId: string | number, actor: ScenarioActor, patch: {
    name?: string;
    visibility?: ScenarioVisibility;
    color?: string | null;
    viewState?: Record<string, unknown>;
  }): Promise<ScenarioDetail> {
    const scenario = await loadEditable(rawId, actor);

    // Who the tab is visible to is the owner's call, not any editor's.
    if (patch.visibility !== undefined
      && scenario.owner_user_id !== actor.userId
      && !isAdmin(actor)) {
      throw new ForbiddenError("Only the tab owner can change who it is shared with.");
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new ValidationError("Tab name is required");
    }

    const updated = await PlanningScenarioRepository.update(parseId(scenario.id), {
      ...patch,
      name: patch.name?.trim(),
    });
    if (!updated) throw new NotFoundError("Scenario not found");
    return toDetail(updated, actor);
  },

  async remove(rawId: string | number, actor: ScenarioActor): Promise<void> {
    const scenario = await loadViewable(rawId, actor);
    if (scenario.owner_user_id !== actor.userId && !isAdmin(actor)) {
      throw new ForbiddenError("Only the tab owner can delete it.");
    }
    await PlanningScenarioRepository.delete(parseId(scenario.id));
  },

  /** Reorders the tabs the caller can see. Ids they cannot see are dropped. */
  async reorder(actor: ScenarioActor, rawIds: Array<string | number>): Promise<void> {
    const visible = await PlanningScenarioRepository.listVisible(actor.userId);
    const allowed = new Set(visible.map((row) => row.id));
    const ordered = rawIds
      .map((raw) => String(raw))
      .filter((id) => allowed.has(id))
      .map((id) => parseId(id));
    await PlanningScenarioRepository.reorder(ordered);
  },

  async lock(rawId: string | number, actor: ScenarioActor): Promise<ScenarioSummary> {
    const scenario = await loadEditable(rawId, actor);
    const updated = await PlanningScenarioRepository.setLock(parseId(scenario.id), actor.userId);
    if (!updated) throw new NotFoundError("Scenario not found");
    return toSummary(updated, actor);
  },

  async unlock(rawId: string | number, actor: ScenarioActor): Promise<ScenarioSummary> {
    const scenario = await loadViewable(rawId, actor);
    const mayUnlock = scenario.locked_by === actor.userId
      || scenario.owner_user_id === actor.userId
      || isAdmin(actor);
    if (!mayUnlock) throw new ForbiddenError("Only the tab owner or whoever locked it can unlock it.");

    const updated = await PlanningScenarioRepository.setLock(parseId(scenario.id), null);
    if (!updated) throw new NotFoundError("Scenario not found");
    return toSummary(updated, actor);
  },

  // ─── Overlay ─────────────────────────────────────────────────────────

  async getOverlay(rawId: string | number, actor: ScenarioActor): Promise<{
    items: Array<{ container_id: string; master_sku: string; qty: number }>;
    containers: Array<{ container_id: string; eta_date: string | null }>;
  }> {
    const scenario = await loadViewable(rawId, actor);
    const id = parseId(scenario.id);
    const [items, containers] = await Promise.all([
      PlanningScenarioRepository.getItems(id),
      PlanningScenarioRepository.getContainerOverrides(id),
    ]);
    return { items, containers };
  },

  async saveItems(
    rawId: string | number,
    actor: ScenarioActor,
    patches: ScenarioItemPatch[],
  ): Promise<void> {
    const scenario = await loadEditable(rawId, actor);
    const id = parseId(scenario.id);

    const upserts: ScenarioItemInput[] = [];
    const deletes: Array<{ container_id: number; master_sku: string }> = [];
    for (const patch of patches) {
      const master_sku = patch.master_sku.trim().toUpperCase();
      if (!master_sku) continue;
      if (patch.qty === null) deletes.push({ container_id: patch.container_id, master_sku });
      else upserts.push({ container_id: patch.container_id, master_sku, qty: patch.qty });
    }

    await PlanningScenarioRepository.upsertItems(id, upserts);
    await PlanningScenarioRepository.deleteItems(id, deletes);
  },

  async saveContainerOverride(
    rawId: string | number,
    actor: ScenarioActor,
    containerId: number,
    etaDate: string | null,
  ): Promise<void> {
    const scenario = await loadEditable(rawId, actor);
    await PlanningScenarioRepository.upsertContainerOverride(
      parseId(scenario.id),
      containerId,
      etaDate,
    );
  },

  // ─── Apply to Live ───────────────────────────────────────────────────

  /**
   * What applying this scenario would do to the real plan. Cells the scenario
   * has no row for are untouched: an absent row means "this scenario does not
   * have an opinion", which is why a removal has to be stored as qty 0.
   */
  async previewApply(
    rawId: string | number,
    actor: ScenarioActor,
    includeDrafts: boolean,
  ): Promise<ApplyDiff> {
    const scenario = await loadViewable(rawId, actor);
    const id = parseId(scenario.id);

    const [items, overrides, live, liveEtas] = await Promise.all([
      PlanningScenarioRepository.getItems(id),
      PlanningScenarioRepository.getContainerOverrides(id),
      PlanningScenarioRepository.getLiveQuantities(includeDrafts),
      PlanningScenarioRepository.getLiveEtas(includeDrafts),
    ]);

    const liveByCell = new Map(live.map((row) => [`${row.container_id}::${row.master_sku}`, row]));
    const liveContainers = new Set(liveEtas.map((row) => row.container_id));
    const liveEtaById = new Map(liveEtas.map((row) => [row.container_id, row.eta_date]));

    const diff: ApplyDiff = { added: [], changed: [], removed: [], eta_changes: [] };

    for (const item of items) {
      // A container that has left the inbound set keeps its overlay row but is
      // not something the grid still shows, so it is not applied either.
      if (!liveContainers.has(item.container_id)) continue;

      const container_id = Number(item.container_id);
      const current = liveByCell.get(`${item.container_id}::${item.master_sku}`);
      const currentQty = current?.qty ?? 0;

      if (item.qty === currentQty) continue;
      if (item.qty === 0) {
        if (current) {
          diff.removed.push({
            container_id,
            master_sku: item.master_sku,
            from: currentQty,
            item_ids: current.item_ids,
          });
        }
      } else if (!current) {
        diff.added.push({ container_id, master_sku: item.master_sku, qty: item.qty });
      } else {
        diff.changed.push({
          container_id,
          master_sku: item.master_sku,
          from: currentQty,
          to: item.qty,
        });
      }
    }

    for (const override of overrides) {
      if (!override.eta_date) continue;
      if (!liveContainers.has(override.container_id)) continue;
      const currentEta = liveEtaById.get(override.container_id) ?? null;
      if (currentEta === override.eta_date) continue;
      diff.eta_changes.push({
        container_id: Number(override.container_id),
        from: currentEta,
        to: override.eta_date,
      });
    }

    return diff;
  },

  /**
   * Writes the scenario onto the real plan. Deliberately goes through
   * `ContainerPlanningService` rather than raw SQL: allocation syncing and the
   * container audit log hang off those methods, and a hand-rolled UPDATE here
   * would silently skip both.
   */
  async applyToLive(
    rawId: string | number,
    actor: ScenarioActor,
    includeDrafts: boolean,
  ): Promise<ApplyDiff & { applied: number }> {
    // Reading the tab is enough to apply it — the write lands on Live, which
    // the route guards with demand-planning.edit, and a locked tab is not
    // itself modified here.
    await loadViewable(rawId, actor);
    const diff = await PlanningScenarioService.previewApply(rawId, actor, includeDrafts);

    const writes = [...diff.added, ...diff.changed];
    // upsertItem refuses a SKU with no CBM on file. Checking first means an
    // apply either goes through or changes nothing, instead of stopping
    // halfway with part of the plan written.
    const skus = [...new Set(writes.map((write) => write.master_sku))];
    const missing = await ContainerPlanningService.findSkusMissingCbm(skus);
    if (missing.length > 0) {
      throw new ValidationError(
        `No CBM per unit on file for: ${missing.join(", ")}. Set it in SKU Master first.`,
      );
    }

    const who = {
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
      ip: actor.ip,
    };

    for (const add of diff.added) {
      await ContainerPlanningService.upsertItem(add.container_id, add.master_sku, add.qty, 0, null);
    }
    for (const change of diff.changed) {
      await ContainerPlanningService.upsertItem(change.container_id, change.master_sku, change.to, 0, null);
    }
    for (const removal of diff.removed) {
      for (const itemId of removal.item_ids) {
        await ContainerPlanningService.deleteItem(itemId);
      }
    }
    for (const etaChange of diff.eta_changes) {
      const id = String(etaChange.container_id);
      const existing = await ContainerPlanningService.getExistingOrThrow(id);
      await ContainerPlanningService.updateEta(id, existing, etaChange.to, who);
    }

    return {
      ...diff,
      applied: diff.added.length + diff.changed.length + diff.removed.length + diff.eta_changes.length,
    };
  },
};
