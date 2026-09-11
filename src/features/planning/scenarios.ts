/**
 * Client for the Demand Planning tab (scenario) API.
 *
 * The Live tab is represented as `null` throughout the UI — it has no row in
 * fc_planning_scenarios, because it *is* the real container plan.
 */

import { apiPath } from "@/lib/api-path";

export type ScenarioVisibility = "private" | "shared";

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

export interface ScenarioOverlay {
  items: Array<{ container_id: string; master_sku: string; qty: number }>;
  containers: Array<{ container_id: string; eta_date: string | null }>;
}

export interface ScenarioItemPatch {
  container_id: number;
  master_sku: string;
  /** null clears the override; 0 means "ship none of this here". */
  qty: number | null;
}

export interface ScenarioApplyDiff {
  added: Array<{ container_id: number; master_sku: string; qty: number }>;
  changed: Array<{ container_id: number; master_sku: string; from: number; to: number }>;
  removed: Array<{ container_id: number; master_sku: string; from: number; item_ids: number[] }>;
  eta_changes: Array<{ container_id: number; from: string | null; to: string }>;
  applied: number;
  preview: boolean;
}

/** Container mutations from this page are checked against demand-planning.edit,
 *  the same contract the grid's own writes already use. */
const PLANNING_HEADERS = {
  "Content-Type": "application/json",
  "X-Planning-Permission-Context": "demand-planning",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), init);
  const json = await response.json().catch(() => null) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  if (!response.ok || !json?.success) {
    throw new Error(json?.error ?? `Request failed (${response.status})`);
  }
  return json.data as T;
}

export const ScenarioApi = {
  list(): Promise<ScenarioSummary[]> {
    return request<ScenarioSummary[]>("/api/planning/scenarios");
  },

  get(id: string): Promise<ScenarioDetail> {
    return request<ScenarioDetail>(`/api/planning/scenarios/${id}`);
  },

  create(input: {
    name: string;
    view_state?: Record<string, unknown>;
    copy_from?: "live" | null;
    include_drafts?: boolean;
  }): Promise<ScenarioDetail> {
    return request<ScenarioDetail>("/api/planning/scenarios", {
      method: "POST",
      headers: PLANNING_HEADERS,
      body: JSON.stringify(input),
    });
  },

  duplicate(id: string, name: string): Promise<ScenarioDetail> {
    return request<ScenarioDetail>(`/api/planning/scenarios/${id}/duplicate`, {
      method: "POST",
      headers: PLANNING_HEADERS,
      body: JSON.stringify({ name }),
    });
  },

  update(id: string, patch: {
    name?: string;
    visibility?: ScenarioVisibility;
    color?: string | null;
    view_state?: Record<string, unknown>;
  }): Promise<ScenarioDetail> {
    return request<ScenarioDetail>(`/api/planning/scenarios/${id}`, {
      method: "PATCH",
      headers: PLANNING_HEADERS,
      body: JSON.stringify(patch),
    });
  },

  remove(id: string): Promise<void> {
    return request<void>(`/api/planning/scenarios/${id}`, {
      method: "DELETE",
      headers: PLANNING_HEADERS,
    });
  },

  reorder(order: string[]): Promise<void> {
    return request<void>("/api/planning/scenarios", {
      method: "PATCH",
      headers: PLANNING_HEADERS,
      body: JSON.stringify({ order }),
    });
  },

  lock(id: string): Promise<ScenarioSummary> {
    return request<ScenarioSummary>(`/api/planning/scenarios/${id}/lock`, {
      method: "POST",
      headers: PLANNING_HEADERS,
    });
  },

  unlock(id: string): Promise<ScenarioSummary> {
    return request<ScenarioSummary>(`/api/planning/scenarios/${id}/lock`, {
      method: "DELETE",
      headers: PLANNING_HEADERS,
    });
  },

  overlay(id: string): Promise<ScenarioOverlay> {
    return request<ScenarioOverlay>(`/api/planning/scenarios/${id}/items`);
  },

  saveItems(id: string, items: ScenarioItemPatch[]): Promise<void> {
    return request<void>(`/api/planning/scenarios/${id}/items`, {
      method: "PUT",
      headers: PLANNING_HEADERS,
      body: JSON.stringify({ items }),
    });
  },

  saveContainerEta(id: string, containerId: number, etaDate: string | null): Promise<void> {
    return request<void>(`/api/planning/scenarios/${id}/items`, {
      method: "PUT",
      headers: PLANNING_HEADERS,
      body: JSON.stringify({ containers: [{ container_id: containerId, eta_date: etaDate }] }),
    });
  },

  apply(id: string, options: { confirm: boolean; includeDrafts: boolean }): Promise<ScenarioApplyDiff> {
    return request<ScenarioApplyDiff>(`/api/planning/scenarios/${id}/apply`, {
      method: "POST",
      headers: PLANNING_HEADERS,
      body: JSON.stringify({ confirm: options.confirm, include_drafts: options.includeDrafts }),
    });
  },
};
