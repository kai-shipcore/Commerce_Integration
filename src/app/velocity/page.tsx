"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createSalesSalesColumns,
  createChannelColumns,
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { TrendingUp } from "lucide-react";

// ─── shared data-fetching pane ────────────────────────────────────────────────

interface VelocityTotals {
  qty90d: number; qty60d: number; qty30d: number; qty15d: number; qty7d: number;
  skuCount: number;
}

interface PaneProps {
  apiParams: Record<string, string>;
  grouped?: boolean;
}

function VelocityPane({ apiParams, grouped = false }: PaneProps) {
  const [rows, setRows] = useState<VelocityRow[]>([]);
  const [totals, setTotals] = useState<VelocityTotals | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({ sortBy: "qty90d", sortOrder: "desc" });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
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

      const res = await fetch(`/api/velocity?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed to load");

      setRows(result.data);
      setTotals(result.totals);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [apiParams, pagination, sorting, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
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

const LINK_SALES_PARAMS: Record<string, string> = { platformSource: "shopify" };

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
                              <VelocityPane apiParams={channelParams} />
                            </TabsContent>
                          </Tabs>
                        ) : (
                          <VelocityPane apiParams={channelParams} />
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
