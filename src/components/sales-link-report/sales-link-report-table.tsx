"use client";

/**
 * Code Guide:
 * Isolated client table for the Sales Link Report page.
 * This does not import Velocity page components, keeping the new report independent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";

type SortBy = "masterSku" | "qty90d" | "qty60d" | "qty30d" | "qty15d" | "qty7d";
type SortOrder = "asc" | "desc";

type SalesLinkRow = {
  masterSku: string;
  qty90d: number;
  qty60d: number;
  qty30d: number;
  qty15d: number;
  qty7d: number;
};

type SalesLinkResponse = {
  success: boolean;
  data: SalesLinkRow[];
  totals: SalesLinkRow & { skuCount: number };
  meta: {
    asOfDate: string | null;
    sourceView: string;
    timezone: string;
    excludesRecentDays: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: string;
};

const columns: Array<{ key: SortBy; label: string; align?: "left" | "right" }> = [
  { key: "masterSku", label: "Master SKU", align: "left" },
  { key: "qty90d", label: "90 D", align: "right" },
  { key: "qty60d", label: "60 D", align: "right" },
  { key: "qty30d", label: "30 D", align: "right" },
  { key: "qty15d", label: "15 D", align: "right" },
  { key: "qty7d", label: "7 D", align: "right" },
];

function getTodayLosAngeles() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

function QtyCell({ value, total = false }: { value: number; total?: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        total && "font-semibold",
        !total && value === 0 && "text-muted-foreground",
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

function HeaderButton({
  column,
  activeSort,
  sortOrder,
  onSort,
}: {
  column: (typeof columns)[number];
  activeSort: SortBy;
  sortOrder: SortOrder;
  onSort: (key: SortBy) => void;
}) {
  const active = activeSort === column.key;
  const Icon = active ? (sortOrder === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
        column.align === "right" && "ml-auto",
      )}
    >
      {column.label}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function SalesLinkReportTable() {
  const [rows, setRows] = useState<SalesLinkRow[]>([]);
  const [totals, setTotals] = useState<(SalesLinkRow & { skuCount: number }) | null>(null);
  const [meta, setMeta] = useState<SalesLinkResponse["meta"] | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [asOfDate, setAsOfDate] = useState(getTodayLosAngeles());
  const [sortBy, setSortBy] = useState<SortBy>("masterSku");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRequestedData, setHasRequestedData] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sortBy,
      sortOrder,
    });

    if (search) params.set("search", search);
    if (asOfDate) params.set("asOfDate", asOfDate);

    return params.toString();
  }, [asOfDate, limit, page, search, sortBy, sortOrder]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(apiPath(`/api/sales-link-report?${queryString}`), {
        cache: "no-store",
      });
      const result = (await response.json()) as SalesLinkResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load sales link report");
      }

      setRows(result.data);
      setTotals(result.totals);
      setMeta(result.meta);
      setTotalRows(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
      setTotals(null);
      setMeta(null);
      setTotalRows(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (!hasRequestedData) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows();
  }, [fetchRows, hasRequestedData]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(id);
  }, [searchInput]);

  const handleSort = useCallback((key: SortBy) => {
    setPage(1);
    setSortBy((current) => {
      if (current === key) {
        setSortOrder((order) => (order === "asc" ? "desc" : "asc"));
        return current;
      }

      setSortOrder(key === "masterSku" ? "asc" : "desc");
      return key;
    });
  }, []);

  const handleLoadData = useCallback(() => {
    const nextSearch = searchInput.trim();
    setPage(1);
    setSearch(nextSearch);
    setHasRequestedData(true);

    if (hasRequestedData && page === 1 && search === nextSearch) {
      void fetchRows();
    }
  }, [fetchRows, hasRequestedData, page, search, searchInput]);

  const handleResetSearch = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }, []);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLoadData();
    }
  }, [handleLoadData]);

  const exportCsv = useCallback(() => {
    const header = ["Master SKU", "90 D", "60 D", "30 D", "15 D", "7 D"];
    const lines = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.masterSku,
          row.qty90d,
          row.qty60d,
          row.qty30d,
          row.qty15d,
          row.qty7d,
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-link-report-${asOfDate || "current"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [asOfDate, rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Search Master SKU
              </label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="CA-SC-10-F-10-BK-1TO"
                    className="pl-8"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResetSearch}
                  disabled={!searchInput && !search}
                >
                  Reset
                </Button>
              </div>
            </div>
            <div className="w-full lg:w-44">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                As Of Date
              </label>
              <Input
                type="date"
                value={asOfDate}
                onChange={(event) => {
                  setPage(1);
                  setAsOfDate(event.target.value);
                }}
              />
            </div>
            <div className="w-full lg:w-32">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Page Size
              </label>
              <Input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(event) => {
                  setPage(1);
                  setLimit(Math.min(500, Math.max(1, Number(event.target.value) || 100)));
                }}
              />
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button onClick={handleLoadData} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {loading ? "Loading" : hasRequestedData ? "Refresh" : "Load Data"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Source: {meta?.sourceView ?? "ecommerce_data.vw_sales_order_items_link_new"}</span>
            <span>Timezone: {meta?.timezone ?? "America/Los_Angeles"}</span>
            <span>Recent lag: {meta?.excludesRecentDays ?? 2} days</span>
            <span>SKUs: {totals?.skuCount.toLocaleString() ?? "0"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={cn(column.align === "right" && "text-right")}
                    >
                      <HeaderButton
                        column={column}
                        activeSort={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals && (
                  <TableRow className="bg-muted/60">
                    <TableCell className="font-semibold">
                      Total
                    </TableCell>
                    <TableCell className="text-right">
                      <QtyCell value={totals.qty90d} total />
                    </TableCell>
                    <TableCell className="text-right">
                      <QtyCell value={totals.qty60d} total />
                    </TableCell>
                    <TableCell className="text-right">
                      <QtyCell value={totals.qty30d} total />
                    </TableCell>
                    <TableCell className="text-right">
                      <QtyCell value={totals.qty15d} total />
                    </TableCell>
                    <TableCell className="text-right">
                      <QtyCell value={totals.qty7d} total />
                    </TableCell>
                  </TableRow>
                )}

                {loading ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      <span className="text-sm text-muted-foreground">Loading...</span>
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      <span className="text-sm text-destructive">{error}</span>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      <span className="text-sm text-muted-foreground">
                        {hasRequestedData
                          ? "No sales rows found."
                          : "Load Data ë²„íŠ¼ì„ ëˆŒëŸ¬ Sales ë°ì´í„°ë¥¼ ê°€ì ¸ì˜¤ì„¸ìš”."}
                      </span>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.masterSku}>
                      <TableCell className="font-mono text-xs">{row.masterSku}</TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={row.qty90d} />
                      </TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={row.qty60d} />
                      </TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={row.qty30d} />
                      </TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={row.qty15d} />
                      </TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={row.qty7d} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Page {totalRows === 0 ? 0 : page} of {totalPages} Â· {totalRows.toLocaleString()} rows
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading || totalPages === 0}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
