"use client";

import { useEffect, useState } from "react";
import type { DemandPlanningData } from "@/types/demand-planning";

const EMPTY: DemandPlanningData = { containers: [], rows: [] };

export interface DemandPlanningDataState {
  data: DemandPlanningData;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDemandPlanningData(): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/planning/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ success: boolean; data?: DemandPlanningData; error?: string }>;
      })
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) {
          setData(json.data);
        } else {
          setError(json.error ?? "Failed to load data");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tick]);

  return {
    data,
    loading,
    error,
    reload: () => setTick((t) => t + 1),
  };
}
