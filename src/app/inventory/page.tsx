"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Boxes, Download, Loader2 } from "lucide-react";

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

  const fetchInventory = useCallback(() => {
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

    fetch(`/api/inventory?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setRows(result.data);
          setSummary(result.summary);
          setTotalRows(result.pagination.total);
          setPageCount(result.pagination.totalPages);
          setFilteredRows(result.data);
          setWarehouseOptions(result.warehouses || []);
        } else {
          setError(result.error || "Failed to load inventory");
        }
        setHasLoadedOnce(true);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load inventory");
        setHasLoadedOnce(true);
        setLoading(false);
      });
  }, [pagination, sorting, search, warehouseFilter, groupBy]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([]);

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
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
            <p className="text-muted-foreground">
              Live inventory snapshot from the external coverland inventory feed
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Total Products</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.totalProducts.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {summary?.totalRows.toLocaleString() ?? "-"}{" "}
              {groupBy === "product" ? "grouped product rows" : "warehouse rows"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>On Hand</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.onHand.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Across all warehouses
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Available</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.available.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Sellable inventory from source feed
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Warehouses</CardDescription>
              <CardTitle className="text-3xl">
                {summary?.totalWarehouses.toLocaleString() ?? "-"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Distinct warehouse values in source feed
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Rows</CardTitle>
            <CardDescription>
              Source table fields available today are on hand, allocated, available,
              backorder, warehouse, and created timestamp.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
