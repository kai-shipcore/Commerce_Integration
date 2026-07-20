"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryFilter, DemandPlanningData } from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";
import { DEFAULT_SALES_WINDOW_WEIGHTS, salesWindowWeightsParam, type SalesWindowWeights } from "@/lib/planning/sales-window-weights";

const EMPTY: DemandPlanningData = { containers: [], rows: [], pinned_rows: [], last_sync: null };
const dashboardMemoryCache = new Map<string, DemandPlanningData>();

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

export function useDemandPlanningData(
  mode: VelocityMode = "link",
  asOfDate?: string,
  includeDrafts = false,
  category?: CategoryFilter,
  salesWindowWeights: SalesWindowWeights = DEFAULT_SALES_WINDOW_WEIGHTS,
): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [containerDetailsLoading, setContainerDetailsLoading] = useState(false);
  const [containerDetailsLoaded, setContainerDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataScopeRef = useRef<string>("");
  const containerDetailsInFlightRef = useRef<string | null>(null);

  const scopeKey = () => `${mode}|${asOfDate ?? "current"}|${includeDrafts ? "drafts" : "active"}|${category ?? "all"}|${JSON.stringify(salesWindowWeights)}`;

  function fetchDashboard(withRefresh: boolean) {
    let cancelled = false;
    const requestScopeKey = scopeKey();
    const cachedData = dashboardMemoryCache.get(requestScopeKey);
    if (!withRefresh && cachedData) {
      setData(cachedData);
      dataScopeRef.current = requestScopeKey;
      setContainerDetailsLoaded(false);
      setLoading(false);
      setError(null);
    }

    if (!cachedData) setLoading(true);
    setError(null);

    const asOfSuffix = asOfDate ? `&asOf=${asOfDate}` : "";
    const draftSuffix = includeDrafts ? "&includeDrafts=1" : "";
    const categorySuffix = category ? `&product=${category}` : "";
    const salesWeightsSuffix = `&salesWeights=${salesWindowWeightsParam(salesWindowWeights)}`;
    const dashUrl = apiPath(`/api/planning/dashboard?mode=${mode}${asOfSuffix}${draftSuffix}${categorySuffix}${salesWeightsSuffix}`);
    const dashFetch = withRefresh
      ? fetch(apiPath("/api/planning/stats/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salesWindowWeights }),
        }).then((res) => {
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
        ? fetch(apiPath("/api/planning/dashboard/part-rows"))
          .then((res) => res.json() as Promise<{ success: boolean; rows: { sku: string; cbm_per_unit: number; back: number; west_stock: number; east_stock: number; total_stock: number; west_avail: number; east_avail: number }[] }>)
          .catch(() => ({ success: false, rows: [] as { sku: string; cbm_per_unit: number; back: number; west_stock: number; east_stock: number; total_stock: number; west_avail: number; east_avail: number }[] }))
        : Promise.resolve({ success: false, rows: [] as { sku: string; cbm_per_unit: number; back: number; west_stock: number; east_stock: number; total_stock: number; west_avail: number; east_avail: number }[] }),
    ])
      .then(([json, partJson]) => {
        if (cancelled) return;
        if (json.success && json.data) {
          const partRows: DemandPlanningData["rows"] = (partJson.rows ?? []).map((p) => ({
            sku:               p.sku,
            category_code:     "SC" as const,
            sales_status:      "Part" as const,
            back:              p.back,
            cbm_per_unit:      p.cbm_per_unit ?? 0,
            container_info: "", cbm: 0, seat: "", no: 0, color: "", tone: "",
            west_stock:               p.west_stock  ?? 0,
            east_stock:               p.east_stock  ?? 0,
            total_stock:              p.total_stock ?? 0,
            west_available_stock:     p.west_avail  ?? 0,
            east_available_stock:     p.east_avail  ?? 0,
            transit_stock: 0,
            west_90d: 0, west_60d: 0, west_30d: 0, west_15d: 0, west_7d: 0, west_30d_pre: 0,
            east_90d: 0, east_60d: 0, east_30d: 0, east_15d: 0, east_7d: 0, east_30d_pre: 0,
            avg_daily_prev: 0, avg_daily_real: 0, avg_daily_curr: 0,
            east_avg_prev: 0, east_avg_real: 0, east_avg_curr: 0,
            fba_avg_prev: 0, fba_avg_real: 0, fba_avg_curr: 0,
            west_fbm_30d: 0, east_fbm_30d: 0, fba_30d: 0, total_30d: 0,
            total_avg_prev: 0, total_avg_real: 0, total_avg_curr: 0,
            total_inbound_qty: null, containers_list: null, next_eta: null, sod: null,
            containers: {},
          }));
          // Part SKU가 fc_stats에 'Original'로 있을 경우 중복 제거
          const partSkuSet = new Set(partRows.map((r) => r.sku));
          const mainRows = json.data.rows.filter((r) => !partSkuSet.has(r.sku));
          setData((current) => {
            const d = json.data!;
            const next: DemandPlanningData = {
              containers:  d.containers  ?? current.containers,
              last_sync:   d.last_sync   ?? current.last_sync,
              rows:        [...mainRows, ...partRows],
              pinned_rows: d.pinned_rows ?? current.pinned_rows,
            };
            dashboardMemoryCache.set(requestScopeKey, next);
            dataScopeRef.current = requestScopeKey;
            return next;
          });
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
  }, [mode, asOfDate, includeDrafts, category, salesWindowWeights]);

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
    const salesWeightsSuffix = `&salesWeights=${salesWindowWeightsParam(salesWindowWeights)}`;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 60_000);
    fetch(apiPath(`/api/planning/dashboard?mode=${mode}&includeContainers=1&rawContainers=1${asOfSuffix}${draftSuffix}${categorySuffix}${salesWeightsSuffix}`), {
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
          ...current,
          containers: json.data?.containers ?? current.containers,
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
