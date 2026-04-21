"use client";

/**
 * Code Guide:
 * Reusable data-table helper component: data-table.
 * These files wrap TanStack Table behavior so list screens can share consistent filtering, sorting, and pagination UI.
 */
import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  RowSelectionState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  totalRows?: number;
  pageCount?: number;
  pagination?: {
    page: number;
    pageSize: number;
  };
  onPaginationChange?: (page: number, pageSize: number) => void;
  onSortingChange?: (sortBy: string, sortOrder: "asc" | "desc") => void;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  isLoading?: boolean;
  onRowSelectionChange?: (selectedRows: TData[]) => void;
  onFilteredRowsChange?: (filteredRows: TData[]) => void;
  onRowClick?: (row: TData) => void;
  filterableColumns?: {
    id: string;
    title: string;
    options: { label: string; value: string }[];
  }[];
}

export function DataTable<TData, TValue>({
  columns,
  data,
  totalRows,
  pageCount,
  pagination,
  onPaginationChange,
  onSortingChange,
  onSearchChange,
  searchPlaceholder = "Search...",
  isLoading = false,
  onRowSelectionChange,
  onFilteredRowsChange,
  onRowClick,
  filterableColumns = [],
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const hasInitializedSearch = React.useRef(false);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      ...(pagination
        ? {
            pagination: {
              pageIndex: Math.max(0, pagination.page - 1),
              pageSize: pagination.pageSize,
            },
          }
        : {}),
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    manualPagination: !!pageCount,
    manualSorting: !!onSortingChange,
    pageCount,
  });

  // Notify parent of row selection changes
  React.useEffect(() => {
    if (onRowSelectionChange) {
      const selectedRows = table
        .getFilteredSelectedRowModel()
        .rows.map((row) => row.original);
      onRowSelectionChange(selectedRows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  React.useEffect(() => {
    if (onFilteredRowsChange) {
      onFilteredRowsChange(
        table.getFilteredRowModel().rows.map((row) => row.original)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters, globalFilter, data]);

  // Handle sorting changes
  React.useEffect(() => {
    if (onSortingChange && sorting.length > 0) {
      const sort = sorting[0];
      onSortingChange(sort.id, sort.desc ? "desc" : "asc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  // Handle search changes
  React.useEffect(() => {
    if (onSearchChange) {
      if (!hasInitializedSearch.current) {
        hasInitializedSearch.current = true;
        return;
      }

      const timeoutId = setTimeout(() => {
        onSearchChange(globalFilter);
      }, 300); // Debounce search

      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter]);

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        filterableColumns={filterableColumns}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  <div className="flex items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <span className="ml-2 text-muted-foreground">
                      Loading...
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        table={table}
        totalRows={totalRows}
        onPaginationChange={onPaginationChange}
      />
    </div>
  );
}
