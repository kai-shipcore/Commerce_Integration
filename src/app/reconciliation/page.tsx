"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createChannelColumns,
  createSalesSalesColumns,
  createTtmColumns,
  createPreOrderColumns,
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { Download, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const SALES_COL_TO_SORT: Record<string, string> = {
  masterSku: "masterSku",
  qty_0: "qty90d",
  qty_1: "qty60d",
  qty_2: "qty30d",
  qty_3: "qty15d",
  qty_4: "qty7d",
};

interface VelocityTotals {
  qty90d: number;
  qty60d: number;
  qty30d: number;
  qty15d: number;
  qty7d: number;
  skuCount: number;
}

interface PaneProps {
  apiParams: Record<string, string>;
}

type PaginationState = { page: number; pageSize: number };
type SortState = { sortBy: string; sortOrder: "asc" | "desc" };
type FetchOverrides = {
  pagination?: PaginationState;
  sorting?: SortState;
  search?: string;
};

const DEFAULT_CHANNELS = [
  "AMAZON",
  "EBAY",
  "EBAY_AUTOARMOR",
  "SHOPIFY_COVERLAND",
  "SHOPIFY_ICARCOVER",
  "WALMART",
];

function getChannelLabel(channel: string) {
  const label = channel === "EBAY" ? "EBAY_ADVANCE_PARTS" : channel;
  return label
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ChannelVelocityPane({ apiParams }: PaneProps) {
  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [totals, setTotals] = useState<VelocityTotals | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<SortState>({
    sortBy: "qty90d",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async (overrides: FetchOverrides = {}) => {
    const fetchId = ++fetchIdRef.current;
    const nextPagination = overrides.pagination ?? pagination;
    const nextSorting = overrides.sorting ?? sorting;
    const nextSearch = overrides.search ?? search;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        ...apiParams,
        page: String(nextPagination.page),
        limit: String(nextPagination.pageSize),
        sortBy: nextSorting.sortBy,
        sortOrder: nextSorting.sortOrder,
      });
      if (nextSearch) params.set("search", nextSearch);

      const res = await fetch(`/api/reconciliation/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to load");
      }
      if (fetchId !== fetchIdRef.current) return;

      setRows(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result.data as any[]).map((r) => ({
          masterSku: r.masterSku,
          qtys: [r.qty90d, r.qty60d, r.qty30d, r.qty15d, r.qty7d],
        }))
      );
      setTotals(result.totals);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);
      setHasFetched(true);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [apiParams, pagination, sorting, search]);

  const handlePaginationChange = useCallback((page: number, pageSize: number) => {
    const nextPagination = { page, pageSize };
    setPagination(nextPagination);
    if (hasFetched) void fetchData({ pagination: nextPagination });
  }, [fetchData, hasFetched]);

  const handleSortingChange = useCallback((sortBy: string, sortOrder: "asc" | "desc") => {
    const nextSorting = { sortBy, sortOrder };
    const nextPagination = { ...pagination, page: 1 };
    setSorting(nextSorting);
    setPagination(nextPagination);
    if (hasFetched) void fetchData({ sorting: nextSorting, pagination: nextPagination });
  }, [fetchData, hasFetched, pagination]);

  const handleSearchChange = useCallback((value: string) => {
    const nextPagination = { ...pagination, page: 1 };
    setSearch(value);
    setPagination(nextPagination);
    if (hasFetched) void fetchData({ search: value, pagination: nextPagination });
  }, [fetchData, hasFetched, pagination]);

  const tableData = useMemo(() => {
    if (!totals) return rows;

    const totalsRow: VelocityRow = {
      masterSku: "Total",
      qtys: [totals.qty90d, totals.qty60d, totals.qty30d, totals.qty15d, totals.qty7d],
      isTotal: true,
    };

    return [totalsRow, ...rows];
  }, [totals, rows]);

  const columns = useMemo(() => createChannelColumns(["90D", "60D", "30D", "15D", "7D"]), []);

  const getRowClassName = useCallback(
    (row: VelocityRow) => (row.isTotal ? "bg-muted/60 font-semibold" : undefined),
    []
  );

  const handleExport = useCallback(async () => {
    setExporting(true);

    try {
      const params = new URLSearchParams({
        ...apiParams,
        export: "1",
        page: "1",
        limit: "10000",
        sortBy: sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/reconciliation/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Export failed");

      const headers = ["Master SKU", "90D", "60D", "30D", "15D", "7D"];
      const escape = (v: string | number | null | undefined) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const csvRows = [
        headers,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(result.data as any[]).map((row) => [
          row.masterSku,
          row.qty90d,
          row.qty60d,
          row.qty30d,
          row.qty15d,
          row.qty7d,
        ]),
      ];

      const csv = csvRows.map((r) => r.map(escape).join(",")).join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `velocity_channel_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[velocity channel export] error:", err);
    } finally {
      setExporting(false);
    }
  }, [apiParams, sorting, search]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[32px] items-center justify-between gap-2">
        {!hasFetched && !loading && !error && (
          <span className="text-sm text-muted-foreground">
            Select Refresh to load channel velocity.
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </button>
          {!loading && rows.length > 0 && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export Excel
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="flex items-center justify-center py-16 text-sm text-destructive">
              {error}
            </div>
          ) : !hasFetched && !loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              No data loaded.
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={tableData}
              totalRows={totalRows}
              pageCount={pageCount}
              pagination={pagination}
              onPaginationChange={handlePaginationChange}
              onSortingChange={handleSortingChange}
              onSearchChange={handleSearchChange}
              searchPlaceholder="Search Master SKU..."
              isLoading={loading}
              getRowClassName={getRowClassName}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sales Data Pane ──────────────────────────────────────────────────────────

function SalesDataPane() {
  const [mode, setMode] = useState<"sales" | "ttm" | "preorder">("sales");
  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<SortState>({ sortBy: "qty_0", sortOrder: "desc" });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchIdRef = useRef(0);

  const source = mode === "ttm" ? "link-ttm" : mode === "preorder" ? "link-preorder" : "link";
  const enrichPath =
    mode === "ttm"
      ? "/api/velocity/ttm-enrich"
      : mode === "preorder"
      ? "/api/velocity/preorder-enrich"
      : "/api/velocity/custom-enrich";

  const fetchData = useCallback(async (overrides: FetchOverrides = {}) => {
    const fetchId = ++fetchIdRef.current;
    const nextPagination = overrides.pagination ?? pagination;
    const nextSorting = overrides.sorting ?? sorting;
    const nextSearch = overrides.search ?? search;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        source,
        page: String(nextPagination.page),
        limit: String(nextPagination.pageSize),
        sortBy: SALES_COL_TO_SORT[nextSorting.sortBy] ?? "qty90d",
        sortOrder: nextSorting.sortOrder,
      });
      if (nextSearch) params.set("search", nextSearch);

      const res = await fetch(`/api/velocity?${params}`, { cache: "no-store" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed to load");
      if (fetchId !== fetchIdRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainRows: any[] = result.data;
      const skus: string[] = mainRows.map((r) => r.masterSku);

      const enrichRes = await fetch(enrichPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus, search: nextSearch }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichResult: any = await enrichRes.json();
      if (fetchId !== fetchIdRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichMap: Record<string, any> = enrichResult.success ? enrichResult.data : {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ct: any = enrichResult.customTotals ?? {};

      let mappedRows: VelocityRow[];
      if (mode === "preorder") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mappedRows = mainRows.map((r: any) => {
          const e = enrichMap[r.masterSku] ?? {};
          return {
            masterSku: r.masterSku,
            qtys: [r.qty90d],
            customMasterSku: e.customMasterSku ?? null,
            customQtys: [e.customQty90d ?? null],
            ttmCount: e.ttmCount ?? null,
            ttmMasterSku: e.ttmMasterSku ?? null,
          };
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mappedRows = mainRows.map((r: any) => {
          const e = enrichMap[r.masterSku] ?? {};
          return {
            masterSku: r.masterSku,
            qtys: [r.qty90d, r.qty60d, r.qty30d, r.qty15d, r.qty7d],
            customMasterSku: e.customMasterSku ?? null,
            customQtys: [
              e.customQty90d ?? null,
              e.customQty60d ?? null,
              e.customQty30d ?? null,
              e.customQty15d ?? null,
              e.customQty7d ?? null,
            ],
          };
        });
      }

      const t = result.totals;
      const totalsRow: VelocityRow =
        mode === "preorder"
          ? {
              masterSku: "Total",
              qtys: [t.qty90d],
              customQtys: [ct.customQty90d ?? null],
              ttmCount: ct.ttmQty90d ?? null,
              isTotal: true,
            }
          : {
              masterSku: "Total",
              qtys: [t.qty90d, t.qty60d, t.qty30d, t.qty15d, t.qty7d],
              customQtys: [
                ct.customQty90d ?? null,
                ct.customQty60d ?? null,
                ct.customQty30d ?? null,
                ct.customQty15d ?? null,
                ct.customQty7d ?? null,
              ],
              isTotal: true,
            };

      setRows([totalsRow, ...mappedRows]);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);
      setHasFetched(true);
    } catch (err) {
      console.error("[SalesDataPane] fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [mode, source, enrichPath, pagination, sorting, search]);

  const handleModeChange = useCallback((newMode: "sales" | "ttm" | "preorder") => {
    setMode(newMode);
    setRows([]);
    setTotalRows(0);
    setPageCount(0);
    setHasFetched(false);
    setPagination({ page: 1, pageSize: 100 });
  }, []);

  const columns = useMemo(() => {
    if (mode === "preorder") return createPreOrderColumns();
    if (mode === "ttm") return createTtmColumns(["90D", "60D", "30D", "15D", "7D"]);
    return createSalesSalesColumns(["90D", "60D", "30D", "15D", "7D"]);
  }, [mode]);

  const getRowClassName = useCallback(
    (row: VelocityRow) => (row.isTotal ? "bg-muted/60 font-semibold" : undefined),
    []
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/velocity/sales-export", { cache: "no-store" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sales-velocity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[SalesDataPane] export error:", err);
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["sales", "ttm", "preorder"] as const).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-foreground hover:bg-muted"
              )}
            >
              {m === "sales" ? "Sales" : m === "ttm" ? "TTM" : "Pre Order"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export Sales CSV
              </>
            )}
          </button>
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {!hasFetched && !loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Refresh를 눌러 데이터를 로드하세요
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              totalRows={totalRows}
              pageCount={pageCount}
              pagination={pagination}
              onPaginationChange={(page, pageSize) => {
                const nextPagination = { page, pageSize };
                setPagination(nextPagination);
                if (hasFetched) void fetchData({ pagination: nextPagination });
              }}
              onSortingChange={(sortBy, sortOrder) => {
                const nextSorting = { sortBy, sortOrder };
                const nextPagination = { ...pagination, page: 1 };
                setSorting(nextSorting);
                setPagination(nextPagination);
                if (hasFetched) void fetchData({ sorting: nextSorting, pagination: nextPagination });
              }}
              onSearchChange={(s) => {
                const nextPagination = { ...pagination, page: 1 };
                setSearch(s);
                setPagination(nextPagination);
                if (hasFetched) void fetchData({ search: s, pagination: nextPagination });
              }}
              searchPlaceholder="Search Master SKU..."
              isLoading={loading}
              getRowClassName={getRowClassName}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const [view, setView] = useState<"channel" | "sales">("channel");
  const [channels] = useState<string[]>(DEFAULT_CHANNELS);
  const [channelTab, setChannelTab] = useState<string>(DEFAULT_CHANNELS[0]);
  const [subChannels] = useState<Record<string, string[]>>({});
  const [ebaySubTab, setEbaySubTab] = useState<string>("Total");

  const handleChannelTabChange = useCallback((value: string) => {
    setChannelTab(value);
    setEbaySubTab("Total");
  }, []);

  const channelParams = useMemo<Record<string, string>>(() => {
    if (!channelTab) return {};
    const params: Record<string, string> = { platformSource: channelTab };
    const subs = subChannels[channelTab];
    if (subs?.length && ebaySubTab !== "Total") {
      params.fulfillmentChannel = ebaySubTab;
    }
    return params;
  }, [channelTab, subChannels, ebaySubTab]);

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Reconciliation</h1>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
            <button
              onClick={() => setView("channel")}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                view === "channel"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Channel
            </button>
            <button
              onClick={() => setView("sales")}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                view === "sales"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Sales
            </button>
          </div>
        </div>

        {view === "sales" ? (
          <SalesDataPane />
        ) : channels.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
              Loading channels...
            </CardContent>
          </Card>
        ) : (
          <Tabs value={channelTab} onValueChange={handleChannelTabChange}>
            <TabsList>
              {channels.map((channel) => (
                <TabsTrigger key={channel} value={channel}>
                  {getChannelLabel(channel)}
                </TabsTrigger>
              ))}
            </TabsList>
            {channels.map((channel) => {
              const subs = subChannels[channel];
              return (
                <TabsContent key={channel} value={channel}>
                  {channelTab === channel && (
                    subs?.length ? (
                      <Tabs value={ebaySubTab} onValueChange={setEbaySubTab}>
                        <TabsList>
                          <TabsTrigger value="Total">Total</TabsTrigger>
                          {subs.map((subChannel) => (
                            <TabsTrigger key={subChannel} value={subChannel}>
                              {subChannel}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        <TabsContent value={ebaySubTab}>
                          <ChannelVelocityPane
                            key={JSON.stringify(channelParams)}
                            apiParams={channelParams}
                          />
                        </TabsContent>
                      </Tabs>
                    ) : (
                      <ChannelVelocityPane
                        key={JSON.stringify(channelParams)}
                        apiParams={channelParams}
                      />
                    )
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
