"use client";

import { useEffect, useState } from "react";
import type { DemandPlanningData } from "@/types/demand-planning";

const EMPTY: DemandPlanningData = { containers: [], rows: [] };

export type VelocityMode = "link" | "custom";

export interface DemandPlanningDataState {
  data: DemandPlanningData;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDemandPlanningData(mode: VelocityMode = "link"): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchDashboard(withRefresh: boolean) {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const dashUrl = `/api/planning/dashboard?mode=${mode}`;
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
        if (json.success && json.data) setData(json.data);
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

  // Auto-load on mount using existing stats (no refresh)
  useEffect(() => fetchDashboard(false), [mode]);

  // Sync button: refresh stats first, then load
  function reload() { fetchDashboard(true); }

  return { data, loading, error, reload };
}
