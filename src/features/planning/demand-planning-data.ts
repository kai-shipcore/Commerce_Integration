"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CategoryFilter, DemandPlanningContainerDetails, DemandPlanningData } from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";
import { DEFAULT_SALES_WINDOW_WEIGHTS, type SalesWindowWeights } from "@/lib/planning/sales-window-weights";
import { DEFAULT_OOS_LOST_DEMAND_WEIGHTS, type OosLostDemandWeights } from "@/lib/planning/oos-lost-demand-weights";
import { runPlanningStatsRefresh } from "@/features/planning/planning-stats-refresh";
import { DashboardRequestLane } from "./dashboard-requests";

const EMPTY: DemandPlanningData = { containers: [], rows: [], pinned_rows: [], last_sync: null };
const dashboardMemoryCache = new Map<string, DemandPlanningData>();
const CATEGORY_CODES: CategoryFilter[] = ["sc", "cc", "fm", "ac", "swc"];
export type VelocityMode = "link" | "custom";
type RefreshSettings = { salesWindowWeights: SalesWindowWeights; oosLostDemandWeights: OosLostDemandWeights };

export interface DemandPlanningDataState {
  data: DemandPlanningData;
  loading: boolean;
  containerDetailsLoading: boolean;
  containerDetailsLoaded: boolean;
  error: string | null;
  reload: (settings?: RefreshSettings) => void;
  loadContainerDetails: () => void;
}

// Compare setting values, not object identity or property insertion order.
function weightsKey(weights: SalesWindowWeights): string {
  return JSON.stringify({
    d90: weights.d90, d60: weights.d60, d30: weights.d30,
    d15: weights.d15, d7: weights.d7, pre: weights.pre,
  });
}

export function useDemandPlanningData(
  mode: VelocityMode = "link",
  asOfDate?: string,
  includeDrafts = false,
  category?: CategoryFilter[],
  salesWindowWeights: SalesWindowWeights = DEFAULT_SALES_WINDOW_WEIGHTS,
  oosLostDemandWeights: OosLostDemandWeights = DEFAULT_OOS_LOST_DEMAND_WEIGHTS,
): DemandPlanningDataState {
  const [data, setData] = useState<DemandPlanningData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [containerDetailsLoading, setContainerDetailsLoading] = useState(false);
  const [containerDetailsLoaded, setContainerDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ scope: string } | null>(null);
  const summaryLane = useRef(new DashboardRequestLane());
  const detailLane = useRef(new DashboardRequestLane());
  const dataScopeRef = useRef("");
  const detailsLoadedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const refreshSettingsRef = useRef({ salesWindowWeights, oosLostDemandWeights });
  useEffect(() => {
    refreshSettingsRef.current = { salesWindowWeights, oosLostDemandWeights };
  }, [salesWindowWeights, oosLostDemandWeights]);

  const categoryScope = [...new Set((category ?? []).filter(value => CATEGORY_CODES.includes(value)))].sort().join(",");
  const salesKey = weightsKey(salesWindowWeights);
  const baseParams = useMemo(() => {
    const params = new URLSearchParams({ mode });
    if (asOfDate) params.set("asOf", asOfDate);
    if (includeDrafts) params.set("includeDrafts", "1");
    if (categoryScope) params.set("product", categoryScope);
    return params.toString();
  }, [mode, asOfDate, includeDrafts, categoryScope]);
  const scope = baseParams + "&salesWeights=" + encodeURIComponent(salesKey);

  const fetchDashboard = useCallback((withRefresh: boolean, settings?: RefreshSettings) => {
    const effectiveSettings = settings ?? refreshSettingsRef.current;
    const requestScope = baseParams + "&salesWeights=" + encodeURIComponent(
      settings ? weightsKey(settings.salesWindowWeights) : salesKey,
    );
    const request = summaryLane.current.start();
    detailLane.current.cancel();
    dataScopeRef.current = "";
    detailsLoadedRef.current = false;
    setReady(null);
    setContainerDetailsLoaded(false);
    setContainerDetailsLoading(false);
    setError(null);
    const cached = !withRefresh ? dashboardMemoryCache.get(requestScope) : undefined;
    if (cached) setData(cached);
    setLoading(!cached || withRefresh);

    void (async () => {
      try {
        // Let effect cleanup cancel Strict Mode's discarded mount before it
        // sends an otherwise identical request to the server.
        await Promise.resolve();
        if (!summaryLane.current.isCurrent(request)) return;
        if (withRefresh) {
          await runPlanningStatsRefresh(effectiveSettings, { isCancelled: () => request.signal.aborted });
        }
        if (!summaryLane.current.isCurrent(request)) return;
        const response = await fetch(apiPath("/api/planning/dashboard?" + requestScope), { signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json() as { success: boolean; data?: DemandPlanningData; error?: string };
        if (!summaryLane.current.isCurrent(request)) return;
        if (!json.success || !json.data) throw new Error(json.error ?? "Failed to load data");
        const incoming = json.data;
        dataScopeRef.current = requestScope;
        setData(current => {
          const next = {
            containers: incoming.containers ?? current.containers,
            last_sync: incoming.last_sync ?? current.last_sync,
            rows: incoming.rows,
            pinned_rows: incoming.pinned_rows ?? current.pinned_rows,
          };
          dashboardMemoryCache.set(requestScope, next);
          return next;
        });
        // Also distinguishes refreshes of the same scope.
        setReady({ scope: requestScope });
      } catch (err) {
        if (summaryLane.current.isCurrent(request)) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (summaryLane.current.finish(request)) {
          syncInFlightRef.current = false;
          setLoading(false);
        }
      }
    })();
  }, [baseParams, salesKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the scoped API read after commit.
    fetchDashboard(false);
    const summaries = summaryLane.current;
    const details = detailLane.current;
    return () => {
      summaries.cancel();
      details.cancel();
      syncInFlightRef.current = false;
    };
  }, [fetchDashboard]);

  const reload = useCallback((settings?: RefreshSettings) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    fetchDashboard(true, settings);
  }, [fetchDashboard]);

  const loadContainerDetails = useCallback(() => {
    if (!ready || ready.scope !== scope || dataScopeRef.current !== scope
      || detailsLoadedRef.current || detailLane.current.isPending()) return;
    const request = detailLane.current.start();
    setContainerDetailsLoading(true);
    setError(null);
    const timeoutId = window.setTimeout(() => request.abort(), 60_000);
    void (async () => {
      try {
        const response = await fetch(apiPath("/api/planning/dashboard/container-details?" + scope), { signal: request.signal });
        if (!response.ok) throw new Error(`Container details failed: HTTP ${response.status}`);
        const json = await response.json() as { success: boolean; data?: DemandPlanningContainerDetails; error?: string };
        if (!detailLane.current.isCurrent(request) || dataScopeRef.current !== scope) return;
        if (!json.success || !json.data) throw new Error(json.error ?? "Failed to load container details");
        const detail = json.data;
        const bySku = new Map(detail.rows.map(row => [row.sku, row.containers]));
        setData(current => ({
          ...current,
          containers: detail.containers,
          // Summary determines row membership. Missing raw details are {}.
          rows: current.rows.map(row => ({ ...row, containers: bySku.get(row.sku) ?? {} })),
        }));
        detailsLoadedRef.current = true;
        setContainerDetailsLoaded(true);
      } catch (err) {
        // Obsolete requests stay silent; current failures/timeouts are shown.
        if (detailLane.current.finish(request)) {
          setError(err instanceof Error ? err.message : "Network error");
          setContainerDetailsLoading(false);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (detailLane.current.finish(request)) setContainerDetailsLoading(false);
      }
    })();
  }, [ready, scope]);

  return { data, loading, containerDetailsLoading, containerDetailsLoaded, error, reload, loadContainerDetails };
}
