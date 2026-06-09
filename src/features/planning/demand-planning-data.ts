"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryFilter, DemandPlanningData } from "@/types/demand-planning";

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

export function useDemandPlanningData(mode: VelocityMode = "link", asOfDate?: string, includeDrafts = false, category?: CategoryFilter): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [containerDetailsLoading, setContainerDetailsLoading] = useState(false);
  const [containerDetailsLoaded, setContainerDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataScopeRef = useRef<string>("");
  const containerDetailsInFlightRef = useRef<string | null>(null);

  const scopeKey = () => `${mode}|${asOfDate ?? "current"}|${includeDrafts ? "drafts" : "active"}|${category ?? "all"}`;

  function fetchDashboard(withRefresh: boolean) {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const asOfSuffix = asOfDate ? `&asOf=${asOfDate}` : "";
    const draftSuffix = includeDrafts ? "&includeDrafts=1" : "";
    const categorySuffix = category ? `&product=${category}` : "";
    const dashUrl = `/api/planning/dashboard?mode=${mode}${asOfSuffix}${draftSuffix}${categorySuffix}`;
    const dashFetch = withRefresh
      ? fetch("/api/planning/stats/refresh", { method: "POST" }).then((res) => {
          if (!res.ok) throw new Error(`Stats refresh failed: HTTP ${res.status}`);
          return fetch(dashUrl);
        })
      : fetch(dashUrl);

    Promise.all([
      dashFetch.then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ success: boolean; data?: DemandPlanningData; error?: string }>;
      }),
      category === "sc"
        ? fetch("/api/planning/dashboard/part-rows")
          .then((res) => res.json() as Promise<{ success: boolean; rows: { sku: string; back: number }[] }>)
          .catch(() => ({ success: false, rows: [] as { sku: string; back: number }[] }))
        : Promise.resolve({ success: false, rows: [] as { sku: string; back: number }[] }),
    ])
      .then(([json, partJson]) => {
        if (cancelled) return;
        if (json.success && json.data) {
          const partRows: DemandPlanningData["rows"] = (partJson.rows ?? []).map((p) => ({
            sku:               p.sku,
            category_code:     "SC" as const,
            sales_status:      "Part" as const,
            back:              p.back,
            container_info: "", cbm: 0, seat: "", no: 0, color: "", tone: "",
            west_stock: 0, east_stock: 0, total_stock: 0,
            west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
            east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
            avg_daily_prev: 0, avg_daily_real: 0, avg_daily_curr: 0,
            east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
            fba_avg_real: 0, fba_avg_curr: 0,
            west_fbm_30d: 0, east_fbm_30d: 0, fba_30d: 0, total_30d: 0,
            total_avg_prev: 0, total_avg_real: 0, total_avg_curr: 0,
            total_inbound_qty: null, containers_list: null, next_eta: null, sod: null,
            containers: {},
          }));
          setData({ ...json.data, rows: [...json.data.rows, ...partRows] });
          dataScopeRef.current = scopeKey();
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
  }, [mode, asOfDate, includeDrafts, category]);

  // Sync button: refresh stats first, then load
  function reload() { fetchDashboard(true); }

  function loadContainerDetails() {
    const requestKey = scopeKey();
    if (containerDetailsLoaded || containerDetailsInFlightRef.current === requestKey) return;
    containerDetailsInFlightRef.current = requestKey;
    setContainerDetailsLoading(true);
    setError(null);

    const asOfSuffix = asOfDate ? `&asOf=${asOfDate}` : "";
    const draftSuffix = includeDrafts ? "&includeDrafts=1" : "";
    const categorySuffix = category ? `&product=${category}` : "";
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 60_000);
    fetch(`/api/planning/dashboard?mode=${mode}&includeContainers=1&rawContainers=1${asOfSuffix}${draftSuffix}${categorySuffix}`, {
      signal: abortController.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Container details failed: HTTP ${res.status}`);
        return res.json() as Promise<{ success: boolean; data?: DemandPlanningData; error?: string }>;
      })
      .then((json) => {
        if (!json.success || !json.data) {
          throw new Error(json.error ?? "Failed to load container details");
        }
        if (dataScopeRef.current !== requestKey) return;
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
        if (dataScopeRef.current === requestKey) {
          setError(err instanceof Error ? err.message : "Network error");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (containerDetailsInFlightRef.current === requestKey) {
          containerDetailsInFlightRef.current = null;
          setContainerDetailsLoading(false);
        }
      });
  }

  return { data, loading, containerDetailsLoading, containerDetailsLoaded, error, reload, loadContainerDetails };
}
