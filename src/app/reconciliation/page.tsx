"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createChannelColumns,
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { Download, RefreshCw, TrendingUp } from "lucide-react";

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
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({
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

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
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

      const res = await fetch(`/api/reconciliation/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to load");
      }
      if (fetchId !== fetchIdRef.current) return;

      setRows(result.data);
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

  const tableData = useMemo(() => {
    if (!totals) return rows;

    const totalsRow: VelocityRow = {
      masterSku: "Total",
      qty90d: totals.qty90d,
      qty60d: totals.qty60d,
      qty30d: totals.qty30d,
      qty15d: totals.qty15d,
      qty7d: totals.qty7d,
      isTotal: true,
    };

    return [totalsRow, ...rows];
  }, [totals, rows]);

  const columns = useMemo(() => createChannelColumns(), []);

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
        ...(result.data as VelocityRow[]).map((row) => [
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
            onClick={fetchData}
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

export default function ReconciliationPage() {
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
        </div>

        {channels.length === 0 ? (
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
