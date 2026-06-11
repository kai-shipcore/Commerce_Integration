"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  createCompareColumns,
  getCompareRowClassName,
  type CompareRow,
} from "@/components/compare/compare-table-columns";
import { Download, GitCompareArrows, RefreshCw, CalendarIcon, AlertCircle } from "lucide-react";
import type { CompareStatus } from "@/app/api/compare/route";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";

type DatePreset = "last7" | "last30" | "last60" | "last90" | "custom";

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "last7",  label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last60", label: "Last 60 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

function getPresetRange(preset: DatePreset): DateRange | undefined {
  const now = new Date();
  switch (preset) {
    case "last7":  return { from: startOfDay(subDays(now, 6)),  to: endOfDay(now) };
    case "last30": return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "last60": return { from: startOfDay(subDays(now, 59)), to: endOfDay(now) };
    case "last90": return { from: startOfDay(subDays(now, 89)), to: endOfDay(now) };
    case "custom": return undefined;
  }
}

interface Summary {
  total: number;
  matchCount: number;
  mismatchCount: number;
  ordersOnlyCount: number;
  velocityOnlyCount: number;
  totalOrdersQty: number;
  totalVelocityQty: number;
}

interface SummaryCardProps {
  label: string;
  count: number;
  total: number;
  color: string;
  active: boolean;
  onClick: () => void;
}

function SummaryCard({ label, count, total, color, active, onClick }: SummaryCardProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left w-full rounded-lg border p-4 transition-colors hover:bg-muted/50",
        active && "ring-2 ring-primary bg-muted/40"
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold mt-1", color)}>{count.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{pct}% of total</p>
    </button>
  );
}

export default function ComparePage() {
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("last30");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [matchVelocityFilters, setMatchVelocityFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CompareStatus | "all">("all");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({
    sortBy: "absDiff",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lagWarning, setLagWarning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchIdRef = useRef(0);

  const columns = useMemo(() => createCompareColumns(), []);

  const activeDateRange = useMemo<DateRange | undefined>(() => {
    if (datePreset !== "custom") return getPresetRange(datePreset);
    return customRange;
  }, [datePreset, customRange]);

  const fetchData = useCallback(async () => {
    if (!activeDateRange?.from || !activeDateRange?.to) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        startDate: format(activeDateRange.from, "yyyy-MM-dd"),
        endDate:   format(activeDateRange.to,   "yyyy-MM-dd"),
        matchVelocityFilters: String(matchVelocityFilters),
        page:      String(pagination.page),
        limit:     String(pagination.pageSize),
        sortBy:    sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (platformFilter !== "all") params.set("platformSource", platformFilter);
      if (statusFilter !== "all")   params.set("status", statusFilter);
      if (search)                   params.set("search", search);

      const res    = await fetch(apiPath(`/api/compare?${params}`), { cache: "no-store" });
      const result = await res.json() as {
        success: boolean;
        data: CompareRow[];
        summary: Summary;
        meta: { lagWarning: boolean };
        pagination: { total: number; totalPages: number };
        error?: string;
      };

      if (!res.ok || !result.success) throw new Error(result.error ?? "Failed to load");
      if (fetchId !== fetchIdRef.current) return;

      setRows(result.data);
      setSummary(result.summary);
      setLagWarning(result.meta.lagWarning);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [activeDateRange, matchVelocityFilters, pagination, sorting, platformFilter, statusFilter, search]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch(apiPath("/api/velocity/channels"), { cache: "no-store" })
      .then((r) => r.json())
      .then((result: { success: boolean; channels: string[] }) => {
        if (result.success && result.channels.length > 0) setPlatforms(result.channels);
      })
      .catch(() => {});
  }, []);

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

  const handleStatusCardClick = (status: CompareStatus | "all") => {
    setStatusFilter((prev) => (prev === status ? "all" : status));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleExport = useCallback(async () => {
    if (!activeDateRange?.from || !activeDateRange?.to) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({
        startDate: format(activeDateRange.from, "yyyy-MM-dd"),
        endDate:   format(activeDateRange.to,   "yyyy-MM-dd"),
        matchVelocityFilters: String(matchVelocityFilters),
        page:  "1",
        limit: "10000",
        sortBy:    sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (platformFilter !== "all") params.set("platformSource", platformFilter);
      if (statusFilter !== "all")   params.set("status", statusFilter);
      if (search)                   params.set("search", search);

      const res    = await fetch(apiPath(`/api/compare?${params}`), { cache: "no-store" });
      const result = await res.json() as { success: boolean; data: CompareRow[]; error?: string };
      if (!result.success) throw new Error(result.error ?? "Export failed");

      const filtersApplied = matchVelocityFilters ? "velocity_filters" : "all_statuses";
      const headers = ["Master SKU", "Orders Units", "Velocity Units", "Diff", "Diff %", "Status", "Filters Applied"];
      const escape = (v: string | number | null) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csvRows = [
        headers,
        ...result.data.map((r) => [
          r.masterSku,
          r.ordersQty,
          r.velocityQty,
          r.diff,
          r.diffPct !== null ? `${r.diffPct}%` : "",
          r.status,
          filtersApplied,
        ]),
      ];
      const csv  = csvRows.map((row) => row.map(escape).join(",")).join("\n");
      const blob = new Blob(["ï»¿" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `compare_${format(activeDateRange.from, "yyyy-MM-dd")}_${format(activeDateRange.to, "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[compare] export error:", err);
    } finally {
      setExporting(false);
    }
  }, [activeDateRange, matchVelocityFilters, platformFilter, statusFilter, sorting, search]);

  const hasDateRange = Boolean(activeDateRange?.from && activeDateRange?.to);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            <div>
              <h1 className="text-xl font-semibold">Source Compare</h1>
              <p className="text-sm text-muted-foreground">
                Orders (Supabase raw tables) vs Velocity (vw_sales_order_items_link) â€” per master SKU
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Date preset */}
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v as DatePreset);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Custom date range picker */}
            {datePreset === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customRange?.from ? (
                      customRange.to ? (
                        `${format(customRange.from, "MMM d, yyyy")} â€“ ${format(customRange.to, "MMM d, yyyy")}`
                      ) : (
                        format(customRange.from, "MMM d, yyyy")
                      )
                    ) : (
                      <span className="text-muted-foreground">Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={customRange}
                    onSelect={(range) => {
                      setCustomRange(range);
                      setPagination((p) => ({ ...p, page: 1 }));
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            )}

            {/* Platform filter */}
            <Select
              value={platformFilter}
              onValueChange={(v) => { setPlatformFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {platforms.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => void fetchData()}
              disabled={loading || !hasDateRange}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting || totalRows === 0 || !hasDateRange}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {/* Match velocity filters toggle */}
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-4 py-3">
          <Checkbox
            id="matchVelocityFilters"
            checked={matchVelocityFilters}
            onCheckedChange={(checked) => {
              setMatchVelocityFilters(Boolean(checked));
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="mt-0.5"
          />
          <div>
            <label htmlFor="matchVelocityFilters" className="text-sm font-medium cursor-pointer">
              Apply Velocity Filters to Orders
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Restricts the Orders side to <code className="font-mono">FULFILLED</code>/<code className="font-mono">Shipped</code> status and <code className="font-mono">CA-SC*</code> SKUs for an apples-to-apples comparison.
              By default, Orders includes all statuses and SKU prefixes.
            </p>
          </div>
        </div>

        {/* Lag warning */}
        {lagWarning && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The selected date range includes the last 2 days. Velocity data has a 2-day processing lag, so velocity counts will be zero or lower than expected for recent dates. This is expected behavior, not a data error.
            </AlertDescription>
          </Alert>
        )}

        {/* Empty state when no date range selected */}
        {!hasDateRange && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <GitCompareArrows className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-muted-foreground">ë‚ ì§œ ë²”ìœ„ë¥¼ ì„ íƒí•´ ë¹„êµë¥¼ ì‹œìž‘í•˜ì„¸ìš”</p>
            <p className="text-xs text-muted-foreground mt-1">Choose a date preset or set a custom range above</p>
          </div>
        )}

        {/* Summary cards */}
        {hasDateRange && summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Match"
              count={summary.matchCount}
              total={summary.total}
              color="text-emerald-600 dark:text-emerald-400"
              active={statusFilter === "match"}
              onClick={() => handleStatusCardClick("match")}
            />
            <SummaryCard
              label="Mismatch"
              count={summary.mismatchCount}
              total={summary.total}
              color="text-red-600 dark:text-red-400"
              active={statusFilter === "mismatch"}
              onClick={() => handleStatusCardClick("mismatch")}
            />
            <SummaryCard
              label="Orders Only"
              count={summary.ordersOnlyCount}
              total={summary.total}
              color="text-amber-600 dark:text-amber-400"
              active={statusFilter === "orders_only"}
              onClick={() => handleStatusCardClick("orders_only")}
            />
            <SummaryCard
              label="Velocity Only"
              count={summary.velocityOnlyCount}
              total={summary.total}
              color="text-sky-600 dark:text-sky-400"
              active={statusFilter === "velocity_only"}
              onClick={() => handleStatusCardClick("velocity_only")}
            />
          </div>
        )}

        {/* Aggregate totals */}
        {hasDateRange && summary && (
          <div className="flex flex-wrap gap-6 rounded-md border border-border bg-muted/20 px-4 py-3 text-sm">
            <div>
              <span className="text-muted-foreground">Total Orders Units: </span>
              <span className="font-semibold tabular-nums">{summary.totalOrdersQty.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Velocity Units: </span>
              <span className="font-semibold tabular-nums">{summary.totalVelocityQty.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Net Diff: </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  summary.totalOrdersQty - summary.totalVelocityQty > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : summary.totalOrdersQty - summary.totalVelocityQty < 0
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground"
                )}
              >
                {summary.totalOrdersQty - summary.totalVelocityQty > 0 ? "+" : ""}
                {(summary.totalOrdersQty - summary.totalVelocityQty).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* Discrepancy legend */}
        {hasDateRange && (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Diff = Orders âˆ’ Velocity.</span>
            {" "}Positive means Orders counted more units than Velocity.
            {" "}Orders uses <code className="font-mono">SUM(net_quantity)</code> from <code className="font-mono">sales_order_items</code>.
            {" "}Velocity uses <code className="font-mono">COUNT(1)</code> per row in <code className="font-mono">vw_sales_order_items_link</code> â€” a line item with qty=3 counts as 1 in Velocity but 3 in Orders.
            {" "}Velocity always filters to <code className="font-mono">CA-SC*</code> SKUs and <code className="font-mono">FULFILLED/Shipped</code> status.
            {" "}Date boundaries may differ by up to 8 hours due to timezone handling (Velocity uses LA timezone; Orders uses UTC).
          </div>
        )}

        {/* Table */}
        {hasDateRange && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">SKU Comparison</CardTitle>
              <CardDescription>
                Sorted by largest absolute diff first. Click a summary card to filter by status.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {error ? (
                <div className="flex items-center justify-center py-16 text-destructive text-sm px-6">
                  {error}
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={rows}
                  totalRows={totalRows}
                  pageCount={pageCount}
                  pagination={pagination}
                  onPaginationChange={handlePaginationChange}
                  onSortingChange={handleSortingChange}
                  onSearchChange={handleSearchChange}
                  searchPlaceholder="Search Master SKU..."
                  isLoading={loading}
                  getRowClassName={getCompareRowClassName}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
