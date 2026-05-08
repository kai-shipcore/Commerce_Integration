"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createSalesSalesColumns,
  createChannelColumns,
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { Download, TrendingUp } from "lucide-react";

// ─── shared data-fetching pane ────────────────────────────────────────────────

interface VelocityTotals {
  qty90d: number; qty60d: number; qty30d: number; qty15d: number; qty7d: number;
  skuCount: number;
  customQty90d?: number; customQty60d?: number; customQty30d?: number;
  customQty15d?: number; customQty7d?: number;
}

interface PaneProps {
  apiParams: Record<string, string>;
  grouped?: boolean;
  autoLoad?: boolean; // true → fetch on mount (channel tabs); false → wait for user action
}

function VelocityPane({ apiParams, grouped = false, autoLoad = false }: PaneProps) {
  const [everLoaded, setEverLoaded] = useState(autoLoad);
  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [totals, setTotals] = useState<VelocityTotals | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({ sortBy: "qty90d", sortOrder: "desc" });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(autoLoad);
  const [enrichDone, setEnrichDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setEnrichDone(false);
    setError(null);
    try {
      const params = new URLSearchParams({
        ...apiParams,
        page: String(pagination.page),
        limit: String(pagination.pageSize),
        sortBy: sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed to load");
      if (fetchId !== fetchIdRef.current) return;

      setRows(result.data);
      setTotals(result.totals);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);

      if (!grouped) setEnrichDone(true);

      // Phase 2: async custom enrichment for Sales > Sales tab
      if (grouped && result.data.length > 0) {
        const skus = (result.data as VelocityRow[]).map((r) => r.masterSku).join(",");
        const enrichParams = new URLSearchParams({ skus });
        if (search) enrichParams.set("search", search);
        fetch(`/api/velocity/custom-enrich?${enrichParams}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((enrichResult) => {
            if (fetchId !== fetchIdRef.current) return;
            if (!enrichResult.success) {
              console.error("[custom-enrich] API error:", enrichResult.error);
              setEnrichDone(true);
              return;
            }
            setRows((prev) =>
              prev.map((row) => {
                if (row.isTotal) return row;
                const c = enrichResult.data[row.masterSku];
                return c ? { ...row, ...c } : row;
              })
            );
            setTotals((prev) =>
              prev ? { ...prev, ...enrichResult.customTotals } : prev
            );
            setEnrichDone(true);
          })
          .catch((err) => {
            console.error("[custom-enrich] fetch error:", err);
            setEnrichDone(true);
          });
      }
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [apiParams, pagination, sorting, search, grouped]);

  useEffect(() => {
    if (!everLoaded) return;
    void fetchData();
  }, [fetchData, everLoaded]);

  const handlePaginationChange = useCallback((page: number, pageSize: number) => {
    setPagination({ page, pageSize });
  }, []);

  const handleSortingChange = useCallback((sortBy: string, sortOrder: "asc" | "desc") => {
    setSorting({ sortBy, sortOrder });
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const totalsRow: VelocityRow | null = totals
    ? {
        masterSku: "Total",
        qty90d: totals.qty90d, qty60d: totals.qty60d, qty30d: totals.qty30d,
        qty15d: totals.qty15d, qty7d: totals.qty7d,
        customQty90d: totals.customQty90d ?? null,
        customQty60d: totals.customQty60d ?? null,
        customQty30d: totals.customQty30d ?? null,
        customQty15d: totals.customQty15d ?? null,
        customQty7d:  totals.customQty7d  ?? null,
        isTotal: true,
      }
    : null;

  const tableData = useMemo(
    () => (totalsRow ? [totalsRow, ...rows] : rows),
    [totalsRow, rows]
  );

  const columns = useMemo(
    () => (grouped ? createSalesSalesColumns() : createChannelColumns()),
    [grouped]
  );

  const getRowClassName = useCallback(
    (row: VelocityRow) => (row.isTotal ? "bg-muted/60 font-semibold" : undefined),
    []
  );

  const [exporting, setExporting] = useState(false);

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

      const res = await fetch(`/api/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Export failed");

      let allRows: VelocityRow[] = result.data;

      if (grouped && allRows.length > 0) {
        const skus = allRows.map((r) => r.masterSku);
        const enrichRes = await fetch("/api/velocity/custom-enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skus, search }),
          cache: "no-store",
        });
        const enrichResult = await enrichRes.json();
        if (enrichResult.success) {
          allRows = allRows.map((row) => {
            const c = enrichResult.data[row.masterSku];
            return c ? { ...row, ...c } : row;
          });
        }
      }

      const headers = grouped
        ? ["Master SKU", "Link 90D", "Link 60D", "Link 30D", "Link 15D", "Link 7D",
           "Custom SKU", "Custom 90D", "Custom 60D", "Custom 30D", "Custom 15D", "Custom 7D"]
        : ["Master SKU", "90D", "60D", "30D", "15D", "7D"];

      const escape = (v: string | number | null | undefined) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const csvRows = [
        headers,
        ...allRows.map((row) =>
          grouped
            ? [row.masterSku, row.qty90d, row.qty60d, row.qty30d, row.qty15d, row.qty7d,
               row.customMasterSku ?? "", row.customQty90d ?? "", row.customQty60d ?? "",
               row.customQty30d ?? "", row.customQty15d ?? "", row.customQty7d ?? ""]
            : [row.masterSku, row.qty90d, row.qty60d, row.qty30d, row.qty15d, row.qty7d]
        ),
      ];

      const csv = csvRows.map((r) => r.map(escape).join(",")).join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `velocity_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[export] error:", err);
    } finally {
      setExporting(false);
    }
  }, [apiParams, grouped, sorting, search]);

  const fullyLoaded = !loading && enrichDone && rows.length > 0;

  if (!everLoaded) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex justify-end min-h-[32px]">
          <button
            onClick={() => setEverLoaded(true)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            데이터 불러오기
          </button>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            No data loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between min-h-[32px]">
        {grouped && !enrichDone && !loading && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Custom Sales 데이터 로딩 중...
          </span>
        )}
        {fullyLoaded && (
          <div className="ml-auto">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          </div>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
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
        </CardContent>
      </Card>
    </div>
  );
}

// ─── placeholder for future tabs ─────────────────────────────────────────────

function ComingSoon({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
        {label} — coming soon
      </CardContent>
    </Card>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

const LINK_SALES_PARAMS: Record<string, string> = { source: "link" };

export default function VelocityPage() {
  const [channels, setChannels] = useState<string[]>([]);
  const [channelTab, setChannelTab] = useState<string>("");
  const [subChannels, setSubChannels] = useState<Record<string, string[]>>({});
  const [ebaySubTab, setEbaySubTab] = useState<string>("Total");

  useEffect(() => {
    fetch("/api/velocity/channels", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (result.success && result.channels.length > 0) {
          setChannels(result.channels);
          setChannelTab(result.channels[0]);
          setSubChannels(result.subChannels ?? {});
        }
      })
      .catch(() => {});
  }, []);

  const handleChannelTabChange = useCallback((v: string) => {
    setChannelTab(v);
    setEbaySubTab("Total");
  }, []);

  const channelParams = useMemo<Record<string, string>>(() => {
    if (!channelTab) return {};
    const p: Record<string, string> = { platformSource: channelTab };
    const subs = subChannels[channelTab];
    if (subs?.length && ebaySubTab !== "Total") {
      p.fulfillmentChannel = ebaySubTab;
    }
    return p;
  }, [channelTab, subChannels, ebaySubTab]);

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Velocity</h1>
        </div>

        {/* Master tabs */}
        <Tabs defaultValue="sales">
          <TabsList>
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="channel">Channel</TabsTrigger>
          </TabsList>

          {/* ── Sales master tab ── */}
          <TabsContent value="sales">
            <Tabs defaultValue="sales-sales">
              <TabsList>
                <TabsTrigger value="sales-sales">Sales</TabsTrigger>
                <TabsTrigger value="ttm">TTM</TabsTrigger>
                <TabsTrigger value="preorder">Pre Order</TabsTrigger>
              </TabsList>

              <TabsContent value="sales-sales">
                <VelocityPane apiParams={LINK_SALES_PARAMS} grouped />
              </TabsContent>

              <TabsContent value="ttm">
                <ComingSoon label="TTM" />
              </TabsContent>

              <TabsContent value="preorder">
                <ComingSoon label="Pre Order" />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Channel master tab ── */}
          <TabsContent value="channel">
            {channels.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
                  Loading channels...
                </CardContent>
              </Card>
            ) : (
              <Tabs value={channelTab} onValueChange={handleChannelTabChange}>
                <TabsList>
                  {channels.map((ch) => (
                    <TabsTrigger key={ch} value={ch}>
                      {ch}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {channels.map((ch) => {
                  const subs = subChannels[ch];
                  return (
                    <TabsContent key={ch} value={ch}>
                      {channelTab === ch && (
                        subs?.length ? (
                          <Tabs value={ebaySubTab} onValueChange={setEbaySubTab}>
                            <TabsList>
                              <TabsTrigger value="Total">Total</TabsTrigger>
                              {subs.map((s) => (
                                <TabsTrigger key={s} value={s}>{s}</TabsTrigger>
                              ))}
                            </TabsList>
                            <TabsContent value={ebaySubTab}>
                              <VelocityPane apiParams={channelParams} autoLoad />
                            </TabsContent>
                          </Tabs>
                        ) : (
                          <VelocityPane apiParams={channelParams} autoLoad />
                        )
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
