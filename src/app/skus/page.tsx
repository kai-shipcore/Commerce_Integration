"use client";

/**
 * Code Guide:
 * This page renders the skus screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { SKUFormDialog } from "@/components/sku/sku-form-dialog";
import { BulkActionsBar } from "@/components/sku/bulk-actions-bar";
import { MasterSkuBackfillBanner } from "@/components/sku/master-sku-backfill-banner";
import { DataTable } from "@/components/ui/data-table/data-table";
import { createSkuColumns, SKUTableData } from "@/components/sku/sku-table-columns";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface PaginationState {
  page: number;
  pageSize: number;
}

interface SortingState {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export default function SKUsPage() {
  const [skus, setSKUs] = useState<SKUTableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 50,
  });
  const [sorting, setSorting] = useState<SortingState>({
    sortBy: "masterSkuCode",
    sortOrder: "asc",
  });
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [selectedRows, setSelectedRows] = useState<SKUTableData[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const [salesPeriod, setSalesPeriod] = useState("30");

  const fetchSKUs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    params.set("page", pagination.page.toString());
    params.set("limit", pagination.pageSize.toString());
    params.set("sortBy", sorting.sortBy);
    params.set("sortOrder", sorting.sortOrder);
    params.set("salesPeriod", salesPeriod);

    fetch(`/api/skus?${params}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setSKUs(result.data);
          setTotalRows(result.pagination.total);
          setPageCount(result.pagination.totalPages);

          // Extract unique categories for filtering
          const uniqueCategories = Array.from(
            new Set(
              result.data
                .map((sku: SKUTableData) => sku.category)
                .filter((cat: string | null) => cat !== null)
            )
          ) as string[];
          setCategories(uniqueCategories);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [search, pagination, sorting, salesPeriod]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSKUs();
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchSKUs]);

  // Create columns with period selectors
  const columns = useMemo(
    () =>
      createSkuColumns({
        salesPeriod,
        onSalesPeriodChange: setSalesPeriod,
      }),
    [salesPeriod]
  );

  const handlePaginationChange = (page: number, pageSize: number) => {
    setPagination({ page, pageSize });
  };

  const handleSortingChange = (sortBy: string, sortOrder: "asc" | "desc") => {
    setSorting({ sortBy, sortOrder });
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

  const handleRowSelectionChange = (rows: SKUTableData[]) => {
    setSelectedRows(rows);
  };

  const handleExportCSV = () => {
    const dataToExport = selectedRows.length > 0 ? selectedRows : skus;

    // CSV headers
    const headers = [
      "Master SKU",
      "Name",
      "Description",
      "Category",
      "Available",
      "On Hand",
      "Reserved",
      "Backorder",
      "Inbound",
      "Reorder Point",
      "Unit Cost",
      "Retail Price",
      `Sales (${salesPeriod}d)`,
    ];

    // CSV rows
    const rows = dataToExport.map((sku) => [
      sku.masterSkuCode || sku.skuCode,
      sku.name,
      sku.description || "",
      sku.category || "",
      sku.inventory.available.toString(),
      sku.inventory.onHand.toString(),
      sku.inventory.reserved.toString(),
      sku.inventory.backorder.toString(),
      sku.inventory.inbound.toString(),
      sku.reorderPoint?.toString() || "",
      sku.unitCost || "",
      sku.retailPrice || "",
      sku.salesSummary.totalQuantity.toString(),
    ]);

    // Create CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    // Download CSV
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `skus-export-${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Prepare category filter options
  const categoryFilterOptions = categories.map((cat) => ({
    label: cat,
    value: cat,
  }));

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* Master SKU Backfill Banner - auto-triggers if needed */}
        <MasterSkuBackfillBanner />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Products</h1>
            <p className="text-muted-foreground">
              Manage your product catalog ({totalRows} total)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportCSV}
              disabled={skus.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export {selectedRows.length > 0 ? `(${selectedRows.length})` : "All"}
            </Button>
            <SKUFormDialog onSuccess={fetchSKUs} />
          </div>
        </div>

        {/* Bulk Actions Bar */}
        <BulkActionsBar
          selectedRows={selectedRows}
          onDelete={() => {
            setSelectedRows([]);
            fetchSKUs();
          }}
          onExport={handleExportCSV}
        />

        {/* Data Table */}
        <DataTable
          columns={columns}
          data={skus}
          totalRows={totalRows}
          pageCount={pageCount}
          pagination={pagination}
          onPaginationChange={handlePaginationChange}
          onSortingChange={handleSortingChange}
          onSearchChange={handleSearchChange}
          onRowSelectionChange={handleRowSelectionChange}
          searchPlaceholder="Search products by code, name, or description..."
          isLoading={loading}
          filterableColumns={
            categoryFilterOptions.length > 0
              ? [
                  {
                    id: "category",
                    title: "Category",
                    options: categoryFilterOptions,
                  },
                ]
              : []
          }
        />
      </div>
    </AppLayout>
  );
}
