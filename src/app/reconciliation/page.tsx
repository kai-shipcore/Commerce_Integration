"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  createReconciliationColumns,
  type ReconciliationRow,
} from "@/components/reconciliation/reconciliation-table-columns";
import { Download, RefreshCw, Scale } from "lucide-react";
import type { ReconciliationStatus } from "@/app/api/reconciliation/route";
import { cn } from "@/lib/utils";

const DAYS_OPTIONS = [
  { value: "7",  label: "Last 7 days" },
  { value: "15", label: "Last 15 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
];

interface Summary {
  total: number;
  matchCount: number;
  mismatchCount: number;
  velocityOnlyCount: number;
  ordersOnlyCount: number;
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

export default function ReconciliationPage() {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [days, setDays] = useState("30");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ReconciliationStatus | "all">("all");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" }>({
    sortBy: "absDiff",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fetchIdRef = useRef(0);

  const columns = useMemo(() => createReconciliationColumns(), []);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        days,
        page: String(pagination.page),
        limit: String(pagination.pageSize),
        sortBy: sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (platformFilter !== "all") params.set("platformSource", platformFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);

      const res = await fetch(`/api/reconciliation?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error ?? "Failed to load");
      if (fetchId !== fetchIdRef.current) return;

      setRows(result.data);
      setSummary(result.summary);
      setTotalRows(result.pagination.total);
      setPageCount(result.pagination.totalPages);

      // Collect distinct platform sources from current full result for filter dropdown
      if (result.data.length > 0 && platforms.length === 0) {
        const seen = new Set<string>();
        (result.data as ReconciliationRow[]).forEach((r) => seen.add(r.platformSource));
        setPlatforms(Array.from(seen).sort());
      }
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [days, pagination, sorting, platformFilter, statusFilter, search, platforms.length]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Fetch platforms once on mount (unfiltered, to populate dropdown)
  useEffect(() => {
    fetch("/api/velocity/channels", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (result.success && result.channels.length > 0) {
          setPlatforms(result.channels);
        }
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

  const handleStatusCardClick = (status: ReconciliationStatus | "all") => {
    setStatusFilter((prev) => (prev === status ? "all" : status));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        days,
        page: "1",
        limit: "10000",
        sortBy: sorting.sortBy,
        sortOrder: sorting.sortOrder,
      });
      if (platformFilter !== "all") params.set("platformSource", platformFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);

      const res = await fetch(`/api/reconciliation?${params}`, { cache: "no-store" });
      const result = await res.json();
      if (!result.success) throw new Error(result.error ?? "Export failed");

      const allRows = result.data as ReconciliationRow[];
      const headers = ["Master SKU", "Channel", "Velocity Qty", "Orders Qty", "Diff", "Diff %", "Status"];
      const escape = (v: string | number | null) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csvRows = [
        headers,
        ...allRows.map((r) => [
          r.masterSku,
          r.platformSource,
          r.velocityQty,
          r.ordersQty,
          r.diff,
          r.diffPct !== null ? `${r.diffPct}%` : "",
          r.status,
        ]),
      ];
      const csv = csvRows.map((row) => row.map(escape).join(",")).join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reconciliation_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[reconciliation] export error:", err);
    } finally {
      setExporting(false);
    }
  }, [days, platformFilter, statusFilter, sorting, search]);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            <div>
              <h1 className="text-xl font-semibold">Reconciliation</h1>
              <p className="text-sm text-muted-foreground">
                Velocity (Primary DB) vs Orders (Supabase) — same period, per master SKU
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={(v) => { setDays(v); setPagination((p) => ({ ...p, page: 1 })); }}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button variant="outline" size="icon" onClick={() => void fetchData()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={exporting || totalRows === 0}>
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {/* Summary cards — click to filter by status */}
        {summary && (
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
              label="Velocity Only"
              count={summary.velocityOnlyCount}
              total={summary.total}
              color="text-sky-600 dark:text-sky-400"
              active={statusFilter === "velocity_only"}
              onClick={() => handleStatusCardClick("velocity_only")}
            />
            <SummaryCard
              label="Orders Only"
              count={summary.ordersOnlyCount}
              total={summary.total}
              color="text-amber-600 dark:text-amber-400"
              active={statusFilter === "orders_only"}
              onClick={() => handleStatusCardClick("orders_only")}
            />
          </div>
        )}

        {/* Diff legend */}
        <div className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Diff = Velocity − Orders.</span>
          {" "}Positive means Velocity counted more units than Orders.
          {" "}Velocity filters: <code className="font-mono">is_counted_in_demand=true</code>, <code className="font-mono">fulfillment_status=fulfilled</code>, <code className="font-mono">line_total&gt;0</code>.
          {" "}Orders uses raw <code className="font-mono">quantity</code> mapped to master SKU via vw_sales_order_items.
        </div>

        {/* Table */}
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
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
