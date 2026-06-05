"use client";

import { useEffect, useState } from "react";
import type { DemandPlanningData } from "@/types/demand-planning";

const EMPTY: DemandPlanningData = { containers: [], rows: [], last_sync: null };

export type VelocityMode = "link" | "custom";

export interface DemandPlanningDataState {
  data: DemandPlanningData;
  loading: boolean;
  containerDetailsLoading: boolean;
  containerDetailsLoaded: boolean;
  error: string | null;
  reload: () => void;
  loadContainerDetails: () => void;
}

export function useDemandPlanningData(mode: VelocityMode = "link", asOfDate?: string, includeDrafts = false): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [containerDetailsLoading, setContainerDetailsLoading] = useState(false);
  const [containerDetailsLoaded, setContainerDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchDashboard(withRefresh: boolean) {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const asOfSuffix = asOfDate ? `&asOf=${asOfDate}` : "";
    const draftSuffix = includeDrafts ? "&includeDrafts=1" : "";
    const dashUrl = `/api/planning/dashboard?mode=${mode}${asOfSuffix}${draftSuffix}`;
    const pipeline = withRefresh
      ? fetch("/api/planning/stats/refresh", { method: "POST" }).then((res) => {
          if (!res.ok) throw new Error(`Stats refresh failed: HTTP ${res.status}`);
          return fetch(dashUrl);
        })
      : fetch(dashUrl);

    pipeline
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ success: boolean; data?: DemandPlanningData; error?: string }>;
      })
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) {
          setData(json.data);
          setContainerDetailsLoaded(false);
        }
        else setError(json.error ?? "Failed to load data");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }

  // Auto-load on mount and whenever mode, date, or inbound scope changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial API load is intentionally started after mode/date changes.
    return fetchDashboard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDashboard closes over the active mode, date, and inbound scope.
  }, [mode, asOfDate, includeDrafts]);

  // Sync button: refresh stats first, then load
  function reload() { fetchDashboard(true); }

  function loadContainerDetails() {
    if (containerDetailsLoading || containerDetailsLoaded) return;
    setContainerDetailsLoading(true);
    setError(null);

    const asOfSuffix = asOfDate ? `&asOf=${asOfDate}` : "";
    const draftSuffix = includeDrafts ? "&includeDrafts=1" : "";
    fetch(`/api/planning/dashboard?mode=${mode}&includeContainers=1${asOfSuffix}${draftSuffix}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Container details failed: HTTP ${res.status}`);
        return res.json() as Promise<{ success: boolean; data?: DemandPlanningData; error?: string }>;
      })
      .then((json) => {
        if (!json.success || !json.data) {
          throw new Error(json.error ?? "Failed to load container details");
        }
        const detailBySku = new Map(json.data.rows.map((row) => [row.sku, row.containers]));
        setData((current) => ({
          containers: json.data?.containers ?? current.containers,
          last_sync: current.last_sync,
          rows: current.rows.map((row) => ({
            ...row,
            containers: detailBySku.get(row.sku) ?? row.containers,
          })),
        }));
        setContainerDetailsLoaded(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => setContainerDetailsLoading(false));
  }

  return { data, loading, containerDetailsLoading, containerDetailsLoaded, error, reload, loadContainerDetails };
}
