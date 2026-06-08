"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInventoryColumns,
  type InventoryTableRow,
} from "@/components/inventory/inventory-table-columns";
import { Boxes, ChevronDown, ChevronUp, Download, Loader2, Warehouse } from "lucide-react";

interface InventoryRow {
  masterSku: string;
  onHand: number;
  allocated: number;
  available: number;
  backorder: number;
  warehouse: string | null;
  createdAt: string | null;
}

interface InventorySummary {
  totalRows: number;
  totalProducts: number;
  totalWarehouses: number;
  onHand: number;
  allocated: number;
  available: number;
  backorder: number;
}

interface PaginationState {
  page: number;
  pageSize: number;
}

interface SortingState {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<InventoryTableRow[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 20,
  });
  const [sorting, setSorting] = useState<SortingState>({
    sortBy: "masterSku",
    sortOrder: "asc",
  });
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<"warehouse" | "product">("warehouse");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([]);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("page", pagination.page.toString());
    params.set("limit", pagination.pageSize.toString());
    params.set("sortBy", sorting.sortBy);
    params.set("sortOrder", sorting.sortOrder);
    params.set("groupBy", groupBy);
    if (search) params.set("search", search);
    if (groupBy === "warehouse" && warehouseFilter !== "all") {
      params.set("warehouse", warehouseFilter);
    }

    try {
      const response = await fetch(`/api/inventory?${params.toString()}`, {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || "Failed to load inventory");
        return;
      }

      setRows(result.data);
      setSummary(result.summary);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);
      setFilteredRows(result.data);
      setWarehouseOptions(result.warehouses || []);
    } catch {
      setError("Failed to load inventory");
    } finally {
      setHasLoadedOnce(true);
      setLoading(false);
    }
  }, [pagination, sorting, search, warehouseFilter, groupBy]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInventory();
  }, [fetchInventory]);

  const columns = useMemo(
    () => createInventoryColumns({ groupedByProduct: groupBy === "product" }),
    [groupBy]
  );

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
      params.set("groupBy", groupBy);
      if (search) params.set("search", search);
      if (groupBy === "warehouse" && warehouseFilter !== "all") {
        params.set("warehouse", warehouseFilter);
      }

      const response = await fetch(`/api/inventory?${params.toString()}`, {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to export inventory");
      }

      const exportRows = result.data as InventoryTableRow[];

      const headers = [
        "Master SKU",
        "Warehouse",
        "On Hand",
        "Allocated",
        "Available",
        "Backorder",
        "Snapshot Time",
      ];

      const csvRows = exportRows.map((row) => [
        row.masterSku,
        row.warehouse || "Unspecified",
        row.onHand.toString(),
        row.allocated.toString(),
        row.available.toString(),
        row.backorder.toString(),
        row.createdAt ? new Date(row.createdAt).toISOString() : "",
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
        `inventory-export-${new Date().toISOString().split("T")[0]}.csv`
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
          : "Failed to export inventory"
      );
    } finally {
      setExporting(false);
    }
  };

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

  return (
    <AppLayout>
      <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <Warehouse className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">Inventory</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Live inventory snapshot from the external coverland inventory feed
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={groupBy === "product" ? "default" : "outline"}
              onClick={() => {
                setGroupBy((current) =>
                  current === "product" ? "warehouse" : "product"
                );
                setPagination((current) =>
                  current.page === 1 ? current : { ...current, page: 1 }
                );
              }}
            >
              Grouped by Product
            </Button>
            <Select
              value={warehouseFilter}
              disabled={groupBy === "product"}
              onValueChange={(value) => {
                setWarehouseFilter((current) => (current === value ? current : value));
                setPagination((current) =>
                  current.page === 1 ? current : { ...current, page: 1 }
                );
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouseOptions.map((warehouse) => (
                  <SelectItem key={warehouse} value={warehouse}>
                    {warehouse}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={totalRows === 0 || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </header>

        <div className="border-b border-[#e2dfd8] bg-[#f0eee9] dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSummaryCollapsed((current) => !current)}
            className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-2 text-left transition-colors hover:bg-[#ebe8df] dark:hover:bg-slate-800"
            aria-expanded={!summaryCollapsed}
          >
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-[#1a1917] dark:text-slate-50">Summary</span>
              <span className="text-muted-foreground">
                Products{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.totalProducts.toLocaleString() ?? "-"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Rows{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.totalRows.toLocaleString() ?? "-"}
                </span>
              </span>
              <span className="text-muted-foreground">
                On Hand{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.onHand.toLocaleString() ?? "-"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Available{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.available.toLocaleString() ?? "-"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Warehouses{" "}
                <span className="font-mono font-semibold text-foreground">
                  {summary?.totalWarehouses.toLocaleString() ?? "-"}
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
            <div className="grid grid-cols-2 border-t border-[#e2dfd8] dark:border-slate-700 md:grid-cols-4">
              <InventoryStat
                label="Total Products"
                value={summary?.totalProducts.toLocaleString() ?? "-"}
                sub={groupBy === "product"
                  ? `${summary?.totalRows.toLocaleString() ?? "-"} source warehouse rows`
                  : `${summary?.totalRows.toLocaleString() ?? "-"} warehouse rows`}
              />
              <InventoryStat
                label="On Hand"
                value={summary?.onHand.toLocaleString() ?? "-"}
                sub="Across all warehouses"
              />
              <InventoryStat
                label="Available"
                value={summary?.available.toLocaleString() ?? "-"}
                sub="Sellable inventory from source feed"
              />
              <InventoryStat
                label="Warehouses"
                value={summary?.totalWarehouses.toLocaleString() ?? "-"}
                sub="Distinct warehouse values in source feed"
              />
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {groupBy === "product" && (
              <p className="mb-4 text-sm text-muted-foreground">
                Grouped by product rolls all warehouse rows into one master SKU total.
              </p>
            )}
            {!loading && !error ? (
              <div className="mb-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <span>
                  Showing {filteredRows.length.toLocaleString()} of{" "}
                  {totalRows.toLocaleString()} {groupBy === "product" ? "products" : "warehouse rows"}
                </span>
                <span>
                  {groupBy === "product"
                    ? "Grouped by product"
                    : `Warehouse filter: ${warehouseFilter === "all" ? "All" : warehouseFilter}`}
                </span>
              </div>
            ) : null}
            {!hasLoadedOnce && loading ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="font-medium">Loading inventory...</p>
                <p className="text-sm text-muted-foreground">
                  Fetching the latest inventory snapshot from the external feed.
                </p>
              </div>
            ) : error ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <Boxes className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">{error}</p>
                <p className="text-sm text-muted-foreground">
                  Check the lookup database connection and the `coverland_inventory`
                  source table.
                </p>
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={rows}
                totalRows={totalRows}
                pageCount={pageCount}
                pagination={pagination}
                searchPlaceholder="Search inventory by master SKU or warehouse..."
                onPaginationChange={handlePaginationChange}
                onSortingChange={handleSortingChange}
                onSearchChange={handleSearchChange}
                onFilteredRowsChange={setFilteredRows}
                isLoading={loading}
              />
            )}
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

function InventoryStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
