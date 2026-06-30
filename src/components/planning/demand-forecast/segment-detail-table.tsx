"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPath } from "@/lib/api-path";

// ── Smooth row ──────────────────────────────────────────────────────────────
interface SmoothRow {
  unique_id: string;
  bucket: string;
  history_length: string;
  selected_model: string;
  confidence: string;
  yhat_total: number;
  yhat_hi_total: number | null;
  demand_total: number;
  active_weeks: number | null;
  weeks_to_graduation: number | null;
}

// ── Intermittent row ────────────────────────────────────────────────────────
interface IntermittentRow {
  unique_id: string;
  units_recent: number;
  last_sale_week: string | null;
  weeks_since_last_sale: number | null;
  avg_units_per_event: number | null;
}

type SkuRow = SmoothRow | IntermittentRow;

function isIntermittentRow(r: SkuRow): r is IntermittentRow {
  return "weeks_since_last_sale" in r;
}

interface DetailResponse {
  segment: string;
  weeks: number;
  mode: string;
  period_start: string;
  period_end: string;
  skus: SkuRow[];
  backtest_unavailable?: boolean;
  earliest_forecast?: string | null;
}

interface BacktestCycle {
  forecast_date: string;
  horizon_start: string;
  horizon_end: string;
  horizon_weeks: number;
  sku_count: number;
}

type SmoothSortKey = "unique_id" | "selected_model" | "yhat_total" | "demand_total" | "active_weeks" | "weeks_to_graduation" | "wape";
type IntermittentSortKey = "unique_id" | "units_recent" | "weeks_since_last_sale" | "avg_units_per_event";
type SortDir = "asc" | "desc";

const fmt = new Intl.NumberFormat("en-US");
const fmtDec = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const CONF_STYLES: Record<string, string> = {
  high:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  medium: "bg-amber-50  text-amber-700  border border-amber-200",
  low:    "bg-red-50    text-red-700    border border-red-200",
};

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const WEEK_OPTIONS = [4, 8, 10, 13, 26, 52];
const PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"] as const;

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function SortIconSmooth({ col, sortKey, sortDir }: { col: SmoothSortKey; sortKey: SmoothSortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp   className="ml-1 inline h-3 w-3 text-foreground" />
    : <ArrowDown className="ml-1 inline h-3 w-3 text-foreground" />;
}

function SortIconInter({ col, sortKey, sortDir }: { col: IntermittentSortKey; sortKey: IntermittentSortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp   className="ml-1 inline h-3 w-3 text-foreground" />
    : <ArrowDown className="ml-1 inline h-3 w-3 text-foreground" />;
}

// ── Week selector (shared) ──────────────────────────────────────────────────
function WeekSelector({
  weeks,
  customInput,
  setWeeks,
  setCustomInput,
}: {
  weeks: number;
  customInput: string;
  setWeeks: (w: number) => void;
  setCustomInput: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Lookback window:</span>
      <div className="flex gap-1">
        {WEEK_OPTIONS.map((w) => (
          <button
            key={w}
            onClick={() => { setWeeks(w); setCustomInput(""); }}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              weeks === w && customInput === ""
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {w}W
          </button>
        ))}
      </div>
      <input
        type="number"
        min={1}
        max={104}
        placeholder="custom"
        value={customInput}
        onChange={(e) => setCustomInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = parseInt(customInput);
            if (!isNaN(v) && v >= 1 && v <= 104) setWeeks(v);
          }
        }}
        onBlur={() => {
          const v = parseInt(customInput);
          if (!isNaN(v) && v >= 1 && v <= 104) setWeeks(v);
          else setCustomInput("");
        }}
        className="w-20 rounded border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

// ── Pagination controls (shared) ────────────────────────────────────────────
function Pagination({
  page,
  totalPages,
  pageSize,
  setPage,
  setPageSize,
  totalCount,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  setPage: (fn: (p: number) => number) => void;
  setPageSize: (n: number) => void;
  totalCount: number;
}) {
  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{fmt.format(totalCount)} SKUs</span>
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => { setPageSize(Number(v)); setPage(() => 0); }}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Date helpers ────────────────────────────────────────────────────────────
function getLastMonday(): Date {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const jsDay = today.getDay();
  const pyDay = jsDay === 0 ? 6 : jsDay - 1; // Mon=0 … Sun=6
  const daysBack = pyDay === 0 ? 7 : pyDay;
  const d = new Date(today); d.setDate(today.getDate() - daysBack);
  return d;
}

function toISO(d: Date): string { return d.toISOString().split("T")[0]; }

function weeksToDateRange(w: number): { start: string; end: string } {
  const end = getLastMonday();
  const start = new Date(end); start.setDate(end.getDate() - w * 7);
  return { start: toISO(start), end: toISO(end) };
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Cycle picker ────────────────────────────────────────────────────────────
type CycleSortKey = "forecast_date" | "horizon_start" | "horizon_end" | "horizon_weeks" | "sku_count";

function CyclePicker({
  cycles,
  loading,
  selected,
  onSelect,
  testMode,
  onTestModeChange,
}: {
  cycles: BacktestCycle[];
  loading: boolean;
  selected: string;
  onSelect: (date: string) => void;
  testMode: boolean;
  onTestModeChange: (v: boolean) => void;
}) {
  const [sortKey, setSortKey]   = useState<CycleSortKey>("forecast_date");
  const [sortDir, setSortDir]   = useState<SortDir>("desc");

  function handleSort(key: CycleSortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = [...cycles].sort((a, b) => {
    const av = a[sortKey] as string | number;
    const bv = b[sortKey] as string | number;
    if (typeof av === "number") return sortDir === "asc" ? av - (bv as number) : (bv as number) - av;
    return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
  });

  function Th({ col, label, right }: { col: CycleSortKey; label: string; right?: boolean }) {
    const active = col === sortKey;
    return (
      <th
        onClick={() => handleSort(col)}
        className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground ${right ? "text-right" : ""}`}
      >
        {label}
        {active
          ? sortDir === "asc"
            ? <ArrowUp   className="ml-1 inline h-3 w-3 text-foreground" />
            : <ArrowDown className="ml-1 inline h-3 w-3 text-foreground" />
          : <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />}
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading forecast runs…
      </div>
    );
  }

  const TestModeToggle = () => (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={testMode}
        onChange={(e) => onTestModeChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-primary"
      />
      <span className="text-xs text-muted-foreground">Use test data</span>
    </label>
  );

  if (cycles.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No completed forecast runs yet. A run is eligible once its final forecasted week has passed.
        </div>
        <TestModeToggle />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Select a forecast run to evaluate:</span>
        <TestModeToggle />
      </div>

      <div className="rounded-md border max-h-[380px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur border-b">
            <tr>
              <Th col="forecast_date"  label="Forecast run" />
              <Th col="horizon_start"  label="Horizon start" />
              <Th col="horizon_end"    label="Horizon end" />
              <Th col="horizon_weeks"  label="Weeks" right />
              <Th col="sku_count"      label="SKUs" right />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((c) => (
              <tr
                key={c.forecast_date}
                onClick={() => onSelect(c.forecast_date)}
                className={`cursor-pointer transition-colors ${
                  c.forecast_date === selected
                    ? "bg-primary/10 font-medium"
                    : "hover:bg-muted/50"
                }`}
              >
                <td className="px-3 py-2 font-mono text-xs">{c.forecast_date}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(c.horizon_start)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(c.horizon_end)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{c.horizon_weeks}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{fmt.format(c.sku_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Accuracy cards ──────────────────────────────────────────────────────────
function AccuracyCards({
  rows,
  periodStart,
  periodEnd,
  weeks,
}: {
  rows: SmoothRow[];
  periodStart: string;
  periodEnd: string;
  weeks: number;
}) {
  const withDemand  = rows.filter((r) => r.demand_total > 0);
  const totalDemand = withDemand.reduce((s, r) => s + r.demand_total, 0);
  const totalYhat   = withDemand.reduce((s, r) => s + r.yhat_total, 0);
  const totalAbsErr = withDemand.reduce((s, r) => s + Math.abs(r.yhat_total - r.demand_total), 0);

  const wape = totalDemand > 0 ? totalAbsErr / totalDemand : null;
  const bias = totalDemand > 0 ? (totalYhat - totalDemand) / totalDemand : null;

  // P70 coverage: % of SKUs with PI where demand fell within [yhat_total, yhat_hi_total]
  const withPI      = rows.filter((r) => r.yhat_hi_total !== null);
  const covered     = withPI.filter((r) => r.demand_total >= r.yhat_total && r.demand_total <= r.yhat_hi_total!);
  const coverage    = withPI.length > 0 ? covered.length / withPI.length : null;

  const wapeColor =
    wape === null ? "text-muted-foreground"
    : wape < 0.20 ? "text-emerald-600"
    : wape < 0.40 ? "text-amber-600"
    : "text-red-600";

  const biasColor =
    bias === null ? "text-muted-foreground"
    : Math.abs(bias) < 0.10 ? "text-emerald-600"
    : Math.abs(bias) < 0.30 ? "text-amber-600"
    : "text-red-600";

  const coverageColor =
    coverage === null ? "text-muted-foreground"
    : coverage >= 0.65 ? "text-emerald-600"
    : coverage >= 0.50 ? "text-amber-600"
    : "text-red-600";

  const biasLabel =
    bias === null ? "Forecast vs actual direction"
    : bias > 0.005 ? "Over-forecast"
    : bias < -0.005 ? "Under-forecast"
    : "On target";

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Evaluation period: <span className="font-medium text-foreground">{fmtDate(periodStart)} – {fmtDate(periodEnd)}</span>
        <span className="ml-1 text-muted-foreground/70">({weeks}W · forecast made before {fmtDate(periodStart)} vs actual demand in this window)</span>
      </p>

      <div className={`grid gap-3 ${withPI.length > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">WAPE</p>
          <p className={`text-2xl font-semibold tabular-nums ${wapeColor}`}>
            {wape !== null ? `${(wape * 100).toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Weighted absolute error across {withDemand.length} SKUs</p>
        </div>

        <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Bias</p>
          <p className={`text-2xl font-semibold tabular-nums ${biasColor}`}>
            {bias !== null ? `${bias >= 0 ? "+" : ""}${(bias * 100).toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">{biasLabel}</p>
        </div>

        {withPI.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">P70 Coverage</p>
            <p className={`text-2xl font-semibold tabular-nums ${coverageColor}`}>
              {coverage !== null ? `${Math.round(coverage * 100)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {covered.length} of {withPI.length} SKUs within P70 band
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Smooth table ────────────────────────────────────────────────────────────
function SmoothTable({
  segment,
  rows,
  weeks,
  mode,
}: {
  segment: string;
  rows: SmoothRow[];
  weeks: number;
  mode: string;
}) {
  const router = useRouter();
  const isShortHistory = segment === "smooth_short";

  const [sortKey, setSortKey] = useState<SmoothSortKey>(isShortHistory ? "weeks_to_graduation" : "yhat_total");
  const [sortDir, setSortDir] = useState<SortDir>(isShortHistory ? "asc" : "desc");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage]         = useState(0);

  function handleSort(key: SmoothSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const defaultAsc: SmoothSortKey[] = ["unique_id", "selected_model", "weeks_to_graduation"];
      setSortDir(defaultAsc.includes(key) ? "asc" : "desc");
    }
    setPage(() => 0);
  }

  const sorted = [...rows].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortKey) {
      case "unique_id":           av = a.unique_id;                   bv = b.unique_id; break;
      case "selected_model":      av = a.selected_model;              bv = b.selected_model; break;
      case "demand_total":        av = a.demand_total;                bv = b.demand_total; break;
      case "active_weeks":        av = a.active_weeks ?? -1;          bv = b.active_weeks ?? -1; break;
      case "weeks_to_graduation": av = a.weeks_to_graduation ?? 9999; bv = b.weeks_to_graduation ?? 9999; break;
      case "wape":
        av = a.demand_total > 0 ? Math.abs(a.yhat_total - a.demand_total) / a.demand_total : 9999;
        bv = b.demand_total > 0 ? Math.abs(b.yhat_total - b.demand_total) / b.demand_total : 9999;
        break;
      default:                    av = a.yhat_total;                  bv = b.yhat_total;
    }
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === "asc" ? av - (bv as number) : (bv as number) - av;
  });

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows   = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function Th({ col, label, right }: { col: SmoothSortKey; label: string; right?: boolean }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : ""}`}
        onClick={() => handleSort(col)}
      >
        {label}
        <SortIconSmooth col={col} sortKey={sortKey} sortDir={sortDir} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={setPageSize}
        totalCount={rows.length}
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <Th col="unique_id"      label="SKU" />
              {!isShortHistory && <Th col="selected_model" label="Model" />}
              {!isShortHistory && <TableHead>Confidence</TableHead>}
              {isShortHistory && <Th col="active_weeks"        label="Weeks of history" right />}
              {isShortHistory && <Th col="weeks_to_graduation" label="Weeks to full history" right />}
              <Th col="demand_total" label={`${weeks}W Demand`}   right />
              <Th col="yhat_total"   label={`${weeks}W Forecast`} right />
              {mode === "backtest" && <Th col="wape" label="WAPE" right />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.unique_id}
                className="cursor-pointer"
                onClick={() => router.push(`/planning/sku-forecasts?sku=${encodeURIComponent(row.unique_id)}`)}
              >
                <TableCell className="font-mono text-xs text-primary">
                  {row.unique_id}
                </TableCell>
                {!isShortHistory && (
                  <TableCell className="text-xs text-muted-foreground">
                    {row.selected_model}
                  </TableCell>
                )}
                {!isShortHistory && (
                  <TableCell>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CONF_STYLES[row.confidence] ?? "bg-muted text-muted-foreground border"}`}>
                      {row.confidence}
                    </span>
                  </TableCell>
                )}
                {isShortHistory && (
                  <TableCell className="text-right tabular-nums text-sm">
                    {row.active_weeks ?? "—"}
                  </TableCell>
                )}
                {isShortHistory && (
                  <TableCell className="text-right tabular-nums text-sm">
                    {row.weeks_to_graduation !== null ? (
                      row.weeks_to_graduation === 0 ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                          Promoted
                        </span>
                      ) : (
                        <span className={row.weeks_to_graduation <= 8 ? "font-semibold text-emerald-600" : ""}>
                          {row.weeks_to_graduation}
                        </span>
                      )
                    ) : "—"}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums text-sm">
                  {fmt.format(row.demand_total)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.yhat_hi_total !== null
                    ? <>{fmt.format(row.yhat_total)} – {fmt.format(row.yhat_hi_total)}</>
                    : fmt.format(row.yhat_total)
                  }
                </TableCell>
                {mode === "backtest" && (
                  <TableCell className="text-right tabular-nums text-sm">
                    {row.demand_total > 0
                      ? `${(Math.abs(row.yhat_total - row.demand_total) / row.demand_total * 100).toFixed(0)}%`
                      : "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">Previous</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Intermittent table ──────────────────────────────────────────────────────
function IntermittentTable({
  rows,
  weeks,
}: {
  rows: IntermittentRow[];
  weeks: number;
}) {
  const router = useRouter();

  const [sortKey, setSortKey] = useState<IntermittentSortKey>("weeks_since_last_sale");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage]         = useState(0);

  function handleSort(key: IntermittentSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "unique_id" ? "asc" : "desc");
    }
    setPage(() => 0);
  }

  const sorted = [...rows].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortKey) {
      case "unique_id":            av = a.unique_id;                      bv = b.unique_id; break;
      case "units_recent":         av = a.units_recent;                   bv = b.units_recent; break;
      case "avg_units_per_event":  av = a.avg_units_per_event ?? -1;      bv = b.avg_units_per_event ?? -1; break;
      default:                     av = a.weeks_since_last_sale ?? 9999;  bv = b.weeks_since_last_sale ?? 9999;
    }
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === "asc" ? av - (bv as number) : (bv as number) - av;
  });

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows   = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function Th({ col, label, right }: { col: IntermittentSortKey; label: string; right?: boolean }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : ""}`}
        onClick={() => handleSort(col)}
      >
        {label}
        <SortIconInter col={col} sortKey={sortKey} sortDir={sortDir} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={setPageSize}
        totalCount={rows.length}
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <Th col="unique_id"           label="SKU" />
              <Th col="units_recent"        label={`${weeks}W Units`} right />
              <Th col="weeks_since_last_sale" label="Weeks since last sale" right />
              <Th col="avg_units_per_event" label="Avg units / event" right />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.unique_id}
                className="cursor-pointer"
                onClick={() => router.push(`/planning/sku-forecasts?sku=${encodeURIComponent(row.unique_id)}`)}
              >
                <TableCell className="font-mono text-xs text-primary">
                  {row.unique_id}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {fmt.format(row.units_recent)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.weeks_since_last_sale !== null ? (
                    <span className={row.weeks_since_last_sale > 26 ? "text-red-600 font-medium" : row.weeks_since_last_sale > 13 ? "text-amber-600" : ""}>
                      {row.weeks_since_last_sale}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                  {row.avg_units_per_event !== null ? fmtDec.format(row.avg_units_per_event) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">Previous</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root export ─────────────────────────────────────────────────────────────
export function SegmentDetailTable({ segment, initialTypes }: { segment: string; initialTypes?: string[] }) {
  const isIntermittent = segment === "intermittent";

  const [weeks, setWeeks]                 = useState(isIntermittent ? 13 : 10);
  const [customInput, setCustomInput]     = useState("");
  const [mode, setMode]                   = useState<"forward" | "backtest">("forward");
  const [cycles, setCycles]               = useState<BacktestCycle[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [evalDate, setEvalDate]           = useState<string>("");
  const [testMode, setTestMode]           = useState(false);
  const testModeRef = React.useRef(testMode);
  testModeRef.current = testMode;
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialTypes ?? [...PRODUCT_TYPES]);
  const [data, setData]                   = useState<DetailResponse | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  const toggleType = (pt: string) =>
    setSelectedTypes((prev) => prev.includes(pt) ? prev.filter((t) => t !== pt) : [...prev, pt]);

  const noEligibleCycles = mode === "backtest" && !isIntermittent && !cyclesLoading && cycles.length === 0;

  // Fetch available backtest cycles when switching to backtest mode or testMode changes
  useEffect(() => {
    if (mode !== "backtest" || isIntermittent) return;
    setCyclesLoading(true);
    setEvalDate("");
    setCycles([]);
    const url = apiPath(testMode ? "/api/forecast/backtest-cycles?test=true" : "/api/forecast/backtest-cycles");
    fetch(url)
      .then((r) => r.json())
      .then((json: unknown) => {
        const list = Array.isArray(json) ? (json as BacktestCycle[]) : [];
        setCycles(list);
        if (list.length > 0) setEvalDate(list[0].forecast_date);
      })
      .finally(() => setCyclesLoading(false));
  }, [mode, isIntermittent, testMode]);

  useEffect(() => {
    setData(null);
    setError(null);
    if (selectedTypes.length === 0) {
      setData({ segment, weeks, mode, period_start: "", period_end: "", skus: [] });
      return;
    }
    if (mode === "backtest" && !evalDate) return; // wait for cycle selection
    const allSelected = selectedTypes.length === PRODUCT_TYPES.length;
    const productType = allSelected ? "All" : selectedTypes.join(",");
    const params = new URLSearchParams({ weeks: String(weeks), product_type: productType, mode });
    if (mode === "backtest" && evalDate) params.set("eval_date", evalDate);
    if (testModeRef.current) params.set("test", "true");
    fetch(apiPath(`/api/forecast/segment/${encodeURIComponent(segment)}?${params}`))
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error as string);
        setData(json as DetailResponse);
      })
      .catch((err: Error) => setError(err.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, weeks, mode, evalDate, selectedTypes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        {/* Mode switch */}
        {!isIntermittent && (
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs self-start">
            {(["forward", "backtest"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1 font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "forward" ? "Forward" : "Backtest"}
              </button>
            ))}
          </div>
        )}

        {/* Lookback window — only in forward mode */}
        {mode === "forward" && (
          <WeekSelector
            weeks={weeks}
            customInput={customInput}
            setWeeks={setWeeks}
            setCustomInput={setCustomInput}
          />
        )}

        {/* Cycle picker — only in backtest mode */}
        {mode === "backtest" && !isIntermittent && (
          <CyclePicker
            cycles={cycles}
            loading={cyclesLoading}
            selected={evalDate}
            onSelect={setEvalDate}
            testMode={testMode}
            onTestModeChange={(v) => { setTestMode(v); }}
          />
        )}

        {/* Product type filters */}
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-muted-foreground">Product type:</span>
          <div className="flex flex-wrap gap-2">
            <ToggleBtn
              active={selectedTypes.length === PRODUCT_TYPES.length}
              onClick={() => setSelectedTypes(selectedTypes.length === PRODUCT_TYPES.length ? [] : [...PRODUCT_TYPES])}
            >
              All
            </ToggleBtn>
            {PRODUCT_TYPES.map((pt) => (
              <ToggleBtn key={pt} active={selectedTypes.includes(pt)} onClick={() => toggleType(pt)}>
                {pt}
              </ToggleBtn>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!data && !error && noEligibleCycles && (
        <div className="text-center text-sm text-muted-foreground py-8">
          No data to display.
        </div>
      )}

      {!data && !error && !noEligibleCycles && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading SKU data…
        </div>
      )}

      {data?.backtest_unavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No forecast history before{" "}
          <span className="font-medium">{fmtDate(data.period_start)}</span>.{" "}
          {data.earliest_forecast
            ? <>Forecasts have been running since <span className="font-medium">{fmtDate(data.earliest_forecast)}</span>. Try a shorter lookback window, or check back once more weekly runs have accumulated.</>
            : "No forecast runs found yet."}
        </div>
      )}

      {data && !isIntermittent && mode === "backtest" && !data.backtest_unavailable && (
        <AccuracyCards
          rows={data.skus as SmoothRow[]}
          periodStart={data.period_start}
          periodEnd={data.period_end}
          weeks={data.weeks}
        />
      )}

      {data && isIntermittent && (
        <IntermittentTable rows={data.skus as IntermittentRow[]} weeks={data.weeks} />
      )}

      {data && !isIntermittent && (
        <SmoothTable segment={segment} rows={data.skus as SmoothRow[]} weeks={data.weeks} mode={data.mode} />
      )}
    </div>
  );
}
