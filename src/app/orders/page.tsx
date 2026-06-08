"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { endOfDay, format, startOfDay, startOfYear, subDays, subMonths, subYears } from "date-fns";
import type { DateRange } from "react-day-picker";
import { AppLayout } from "@/components/layout/app-layout";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createOrderColumns,
  type OrderTableRow,
} from "@/components/orders/order-table-columns";
import {
  OrderDetailDialog,
  type OrderDetail,
} from "@/components/orders/order-detail-dialog";
import { ChevronDown, ChevronUp, Download, Loader2, ShoppingCart } from "lucide-react";

type OrderDatePreset = "today" | "yesterday" | "last7" | "last30" | "last90" | "last6m" | "last1y" | "ytd" | "custom";

function getPresetRange(preset: OrderDatePreset): DateRange | undefined {
  const now = new Date();

  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case "last7":   return { from: startOfDay(subDays(now, 6)),   to: endOfDay(now) };
    case "last30":  return { from: startOfDay(subDays(now, 29)),  to: endOfDay(now) };
    case "last90":  return { from: startOfDay(subDays(now, 89)),  to: endOfDay(now) };
    case "last6m":  return { from: startOfDay(subMonths(now, 6)), to: endOfDay(now) };
    case "last1y":  return { from: startOfDay(subYears(now, 1)),  to: endOfDay(now) };
    case "ytd":     return { from: startOfYear(now),              to: endOfDay(now) };
    case "custom":  return undefined;
  }
}

interface OrdersSummary {
  totalOrders: number;
  totalRevenue: number;
  totalUnits: number;
  totalPlatforms: number;
}

interface PaginationState {
  page: number;
  pageSize: number;
}

interface SortingState {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

function OrdersPageContent() {
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<OrderTableRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<OrderTableRow[]>([]);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [platformSources, setPlatformSources] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [orderStatuses, setOrderStatuses] = useState<string[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<OrderDatePreset>("today");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined);

  // Apply URL preset params — runs on mount and whenever URL searchParams change.
  // Using useEffect (not useState initializer) is the reliable pattern for useSearchParams.
  useEffect(() => {
    const p = searchParams.get("preset") as OrderDatePreset | null;
    if (!p) return;
    const knownPresets: OrderDatePreset[] = ["today", "yesterday", "last7", "last30", "last90", "last6m", "last1y", "ytd", "custom"];
    if (knownPresets.includes(p)) {
      setDatePreset(p);
    }
  }, [searchParams]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 20,
  });
  const [sorting, setSorting] = useState<SortingState>({
    sortBy: "orderDate",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasLoadedMeta, setHasLoadedMeta] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const orderDetailCache = useRef<Map<number, { data: OrderDetail; ts: number }>>(new Map());
  const preloadingRef = useRef<Set<number>>(new Set());

  const columns = useMemo(() => createOrderColumns(), []);
  const activeDateRange = useMemo(
    () => (datePreset === "custom" ? customDateRange : getPresetRange(datePreset)),
    [datePreset, customDateRange]
  );

  const fetchOrders = useCallback(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("page", pagination.page.toString());
    params.set("limit", pagination.pageSize.toString());
    params.set("sortBy", sorting.sortBy);
    params.set("sortOrder", sorting.sortOrder);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (platformFilter !== "all") params.set("platformSource", platformFilter);
    if (orderStatusFilter !== "all") params.set("orderStatus", orderStatusFilter);
    if (hasLoadedMeta) params.set("skipMeta", "true");
    const hasSearch = debouncedSearch.trim().length > 0;
    if (!hasSearch && activeDateRange?.from) {
      params.set("startDate", format(activeDateRange.from, "yyyy-MM-dd"));
    }
    if (!hasSearch && activeDateRange?.to) {
      params.set("endDate", format(activeDateRange.to, "yyyy-MM-dd"));
    }

    fetch(`/api/orders?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setRows(result.data);
          setFilteredRows(result.data);
          setSummary(result.summary);
          if (!hasLoadedMeta && result.platformSources?.length) {
            setPlatformSources(result.platformSources);
            setOrderStatuses(result.orderStatuses || []);
            setHasLoadedMeta(true);
          }
          setTotalRows(result.pagination.total);
          setPageCount(result.pagination.totalPages);
        } else {
          setError(result.error || "Failed to load orders");
        }
        setHasLoadedOnce(true);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load orders");
        setHasLoadedOnce(true);
        setLoading(false);
      });
  }, [pagination, sorting, debouncedSearch, platformFilter, orderStatusFilter, activeDateRange, hasLoadedMeta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial API load is intentionally started after filter changes.
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!selectedOrderId || !detailOpen) {
      return;
    }

    const cached = orderDetailCache.current.get(selectedOrderId);
    if (cached && Date.now() - cached.ts < 30_000) {
      setSelectedOrder(cached.data);
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    fetch(`/api/orders/${selectedOrderId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          orderDetailCache.current.set(selectedOrderId, { data: result.data as OrderDetail, ts: Date.now() });
          setSelectedOrder(result.data);
        } else {
          setSelectedOrder(null);
          setError(result.error || "Failed to load order detail");
        }
        setDetailLoading(false);
      })
      .catch(() => {
        setSelectedOrder(null);
        setError("Failed to load order detail");
        setDetailLoading(false);
      });
  }, [selectedOrderId, detailOpen]);

  const handlePaginationChange = (page: number, pageSize: number) => {
    setPagination((current) =>
      current.page === page && current.pageSize === pageSize
        ? current
        : { page, pageSize }
    );
  };

  const handleSortingChange = (sortBy: string, sortOrder: "asc" | "desc") => {
    setSorting((current) =>
      current.sortBy === sortBy && current.sortOrder === sortOrder
        ? current
        : { sortBy, sortOrder }
    );
    setPagination((current) =>
      current.page === 1 ? current : { ...current, page: 1 }
    );
  };

  const handleSearchChange = (searchValue: string) => {
    setSearch(searchValue);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchValue);
      setPagination((current) =>
        current.page === 1 ? current : { ...current, page: 1 }
      );
    }, 300);
  };

  const openOrderDetail = (row: OrderTableRow) => {
    setSelectedOrderId(row.id);
    setSelectedOrder(null);
    setDetailOpen(true);
  };

  const preloadOrderDetail = useCallback((row: OrderTableRow) => {
    const id = row.id;
    const cached = orderDetailCache.current.get(id);
    if ((cached && Date.now() - cached.ts < 30_000) || preloadingRef.current.has(id)) return;
    preloadingRef.current.add(id);
    fetch(`/api/orders/${id}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          orderDetailCache.current.set(id, { data: result.data as OrderDetail, ts: Date.now() });
        }
      })
      .catch(() => {})
      .finally(() => preloadingRef.current.delete(id));
  }, []);

  const handleExportCsv = async () => {
    if (totalRows === 0) {
      return;
    }

    setExporting(true);

    try {
      const params = new URLSearchParams();
      params.set("exportAll", "true");
      params.set("sortBy", sorting.sortBy);
      params.set("sortOrder", sorting.sortOrder);
      if (search) params.set("search", search);
      if (platformFilter !== "all") params.set("platformSource", platformFilter);
      if (orderStatusFilter !== "all") params.set("orderStatus", orderStatusFilter);
      const hasSearch = search.trim().length > 0;
      if (!hasSearch && activeDateRange?.from) {
        params.set("startDate", format(activeDateRange.from, "yyyy-MM-dd"));
      }
      if (!hasSearch && activeDateRange?.to) {
        params.set("endDate", format(activeDateRange.to, "yyyy-MM-dd"));
      }

      const response = await fetch(`/api/orders?${params.toString()}`, {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to export orders");
      }

      const exportRows = result.data as OrderTableRow[];
      const headers = [
        "Order ID",
        "Platform Source",
        "Order Number",
        "External Order ID",
        "Order Date",
        "Order Status",
        "Line Count",
        "Unit Count",
        "Currency",
        "Total Price",
      ];

      const csvRows = exportRows.map((row) => [
        row.id.toString(),
        row.platformSource,
        row.orderNumber || "",
        row.externalOrderId || "",
        row.orderDate ? new Date(row.orderDate).toISOString() : "",
        row.orderStatus || "",
        row.lineCount.toString(),
        row.unitCount.toString(),
        row.currency || "",
        row.totalPrice.toFixed(2),
      ]);

      const csvContent = [
        headers.join(","),
        ...csvRows.map((row) =>
          row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `orders-export-${new Date().toISOString().split("T")[0]}.csv`
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Failed to export orders"
      );
    } finally {
      setExporting(false);
    }
  };

  const handleDatePresetChange = (value: OrderDatePreset) => {
    setDatePreset(value);
    if (value !== "custom") {
      setCustomDateRange(undefined);
    }
    setPagination((current) =>
      current.page === 1 ? current : { ...current, page: 1 }
    );
  };

  return (
    <AppLayout>
      <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4">
          <div>
            <h1 className="text-lg font-semibold">Orders</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Channel order feed from external sales orders and line item tables
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={datePreset} onValueChange={handleDatePresetChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Order date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="last30">Last 30 days</SelectItem>
                <SelectItem value="last90">Last 90 days</SelectItem>
                <SelectItem value="last6m">Last 6 months</SelectItem>
                <SelectItem value="last1y">Last 1 year</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {datePreset === "custom" && (
              <DateRangePicker
                dateRange={customDateRange}
                onDateRangeChange={(range) => {
                  setCustomDateRange(range);
                  setPagination((current) =>
                    current.page === 1 ? current : { ...current, page: 1 }
                  );
                }}
                className="min-w-[280px]"
              />
            )}
            <Select
              value={platformFilter}
              onValueChange={(value) => {
                setPlatformFilter((current) =>
                  current === value ? current : value
                );
                setPagination((current) =>
                  current.page === 1 ? current : { ...current, page: 1 }
                );
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                {platformSources.map((platform) => (
                  <SelectItem key={platform} value={platform}>
                    {platform}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={orderStatusFilter}
              onValueChange={(value) => {
                setOrderStatusFilter((current) =>
                  current === value ? current : value
                );
                setPagination((current) =>
                  current.page === 1 ? current : { ...current, page: 1 }
                );
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {orderStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={handleExportCsv}
              disabled={totalRows === 0 || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
            <Button type="button" variant="outline" onClick={fetchOrders} disabled={loading}>
              Refresh
            </Button>
          </div>
        </header>

        <div className="border-b border-[#e2dfd8] bg-[#f0eee9]">
          <button
            type="button"
            onClick={() => setSummaryCollapsed((current) => !current)}
            className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-2 text-left transition-colors hover:bg-[#ebe8df]"
            aria-expanded={!summaryCollapsed}
          >
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-[#1a1917]">Summary</span>
              <span className="text-muted-foreground">
                Orders{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.totalOrders.toLocaleString() ?? "-"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Revenue{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatOrdersCurrency(summary?.totalRevenue)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Page Units{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatOrderUnits(rows, summary)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Platforms{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.totalPlatforms.toLocaleString() ?? "-"}
                </span>
              </span>
            </span>
            {summaryCollapsed ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
          {!summaryCollapsed ? (
            <div className="grid grid-cols-2 border-t border-[#e2dfd8] md:grid-cols-4">
              <OrdersStat
                label="Total Orders"
                value={summary?.totalOrders.toLocaleString() ?? "-"}
                sub={platformFilter === "all" ? "All platform sources" : platformFilter}
              />
              <OrdersStat
                label="Revenue"
                value={formatOrdersCurrency(summary?.totalRevenue)}
                sub="Gross order value in filtered result set"
              />
              <OrdersStat
                label="Units"
                value={formatOrderUnits(rows, summary)}
                sub="Net quantity on this page"
              />
              <OrdersStat
                label="Platforms"
                value={summary?.totalPlatforms.toLocaleString() ?? "-"}
                sub="Distinct platform sources in current filter"
              />
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {!loading && !error ? (
              <div className="mb-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <span>
                  Showing {filteredRows.length.toLocaleString()} of{" "}
                  {totalRows.toLocaleString()} orders
                </span>
                <span>
                  Platform: {platformFilter === "all" ? "All" : platformFilter} | Date:{" "}
                  {search.trim()
                    ? "All dates while searching"
                    : datePreset === "custom"
                    ? activeDateRange?.from && activeDateRange?.to
                      ? `${format(activeDateRange.from, "MMM d, yyyy")} - ${format(activeDateRange.to, "MMM d, yyyy")}`
                      : "Custom range"
                    : datePreset === "today"    ? "Today"
                    : datePreset === "yesterday" ? "Yesterday"
                    : datePreset === "last7"     ? "Last 7 days"
                    : datePreset === "last30"    ? "Last 30 days"
                    : datePreset === "last90"    ? "Last 90 days"
                    : datePreset === "last6m"    ? "Last 6 months"
                    : datePreset === "last1y"    ? "Last 1 year"
                    : datePreset === "ytd"       ? "Year to date"
                    : "Last 30 days"}
                </span>
              </div>
            ) : null}
            {!hasLoadedOnce && loading ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="font-medium">Loading orders...</p>
                <p className="text-sm text-muted-foreground">
                  Fetching the latest order data from the external sales feed.
                </p>
              </div>
            ) : error ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <ShoppingCart className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">{error}</p>
                <p className="text-sm text-muted-foreground">
                  Check the lookup database connection and the sales order source tables.
                </p>
              </div>
            ) : (
              <div className="min-w-[1180px]">
                <DataTable
                  columns={columns}
                  data={rows}
                  totalRows={totalRows}
                  pageCount={pageCount}
                  pagination={pagination}
                  searchPlaceholder="Search order ID, order number, buyer, master SKU, or web SKU..."
                  onPaginationChange={handlePaginationChange}
                  onSortingChange={handleSortingChange}
                  onSearchChange={handleSearchChange}
                  onFilteredRowsChange={setFilteredRows}
                  onRowClick={openOrderDetail}
                  onRowMouseEnter={preloadOrderDetail}
                  isLoading={loading}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <OrderDetailDialog
        open={detailOpen}
        order={selectedOrder}
        loading={detailLoading}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedOrderId(null);
            setSelectedOrder(null);
          }
        }}
      />
    </AppLayout>
  );
}

function formatOrdersCurrency(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatOrderUnits(rows: OrderTableRow[], summary: OrdersSummary | null) {
  if (rows.length > 0) {
    return rows.reduce((sum, row) => sum + row.unitCount, 0).toLocaleString();
  }
  return summary ? "0" : "-";
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersPageContent />
    </Suspense>
  );
}

function OrdersStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
