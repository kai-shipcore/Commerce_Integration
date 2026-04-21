"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Download, Loader2, ShoppingCart } from "lucide-react";

type OrderDatePreset = "today" | "yesterday" | "last7" | "last30" | "custom";

function getPresetRange(preset: OrderDatePreset): DateRange | undefined {
  const now = new Date();

  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case "last7":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "last30":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "custom":
      return undefined;
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

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderTableRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<OrderTableRow[]>([]);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [platformSources, setPlatformSources] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<OrderDatePreset>("today");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(
    undefined
  );
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 20,
  });
  const [sorting, setSorting] = useState<SortingState>({
    sortBy: "orderDate",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
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
    if (search) params.set("search", search);
    if (platformFilter !== "all") params.set("platformSource", platformFilter);
    if (activeDateRange?.from) {
      params.set("startDate", format(activeDateRange.from, "yyyy-MM-dd"));
    }
    if (activeDateRange?.to) {
      params.set("endDate", format(activeDateRange.to, "yyyy-MM-dd"));
    }

    fetch(`/api/orders?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setRows(result.data);
          setFilteredRows(result.data);
          setSummary(result.summary);
          setPlatformSources(result.platformSources || []);
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
  }, [pagination, sorting, search, platformFilter, activeDateRange]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!selectedOrderId || !detailOpen) {
      return;
    }

    setDetailLoading(true);
    fetch(`/api/orders/${selectedOrderId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
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
    let changed = false;

    setSearch((current) => {
      changed = current !== searchValue;
      return changed ? searchValue : current;
    });
    if (changed) {
      setPagination((current) =>
        current.page === 1 ? current : { ...current, page: 1 }
      );
    }
  };

  const openOrderDetail = (row: OrderTableRow) => {
    setSelectedOrderId(row.id);
    setSelectedOrder(null);
    setDetailOpen(true);
  };

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
      if (activeDateRange?.from) {
        params.set("startDate", format(activeDateRange.from, "yyyy-MM-dd"));
      }
      if (activeDateRange?.to) {
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
        "Financial Status",
        "Sales Channel",
        "Buyer Email",
        "Shipping Country",
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
        row.financialStatus || "",
        row.salesChannel || "",
        row.buyerEmail || "",
        row.shippingCountry || "",
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
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
            <p className="text-muted-foreground">
              Channel order feed from external sales orders and line item tables
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={datePreset} onValueChange={handleDatePresetChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Order date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="last30">Last 30 days</SelectItem>
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
              <SelectTrigger className="w-[220px]">
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
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Total Orders</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.totalOrders.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {platformFilter === "all" ? "All platform sources" : platformFilter}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Revenue</CardDescription>
              <CardTitle className="text-3xl">
                {summary
                  ? new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }).format(summary.totalRevenue)
                  : "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Gross order value in filtered result set
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Units</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.totalUnits.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Net quantity from order items
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Platforms</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.totalPlatforms.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Distinct platform sources in current filter
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Orders Grid</CardTitle>
            <CardDescription>
              Click an order row to inspect its order items and channel metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!loading && !error ? (
              <div className="mb-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <span>
                  Showing {filteredRows.length.toLocaleString()} of{" "}
                  {totalRows.toLocaleString()} orders
                </span>
                <span>
                  Platform: {platformFilter === "all" ? "All" : platformFilter} | Date:{" "}
                  {datePreset === "custom"
                    ? activeDateRange?.from && activeDateRange?.to
                      ? `${format(activeDateRange.from, "MMM d, yyyy")} - ${format(activeDateRange.to, "MMM d, yyyy")}`
                      : "Custom range"
                    : datePreset === "today"
                      ? "Today"
                      : datePreset === "yesterday"
                        ? "Yesterday"
                        : datePreset === "last7"
                          ? "Last 7 days"
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
              <DataTable
                columns={columns}
                data={rows}
                totalRows={totalRows}
                pageCount={pageCount}
                pagination={pagination}
                searchPlaceholder="Search by order number, external id, or buyer..."
                onPaginationChange={handlePaginationChange}
                onSortingChange={handleSortingChange}
                onSearchChange={handleSearchChange}
                onFilteredRowsChange={setFilteredRows}
                onRowClick={openOrderDetail}
                isLoading={loading}
              />
            )}
          </CardContent>
        </Card>
      </div>

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
