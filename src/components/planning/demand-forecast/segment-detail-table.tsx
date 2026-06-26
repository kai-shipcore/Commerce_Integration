"use client";

import { useEffect, useState } from "react";
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
  skus: SkuRow[];
}

type SmoothSortKey = "unique_id" | "selected_model" | "yhat_total" | "demand_total" | "active_weeks" | "weeks_to_graduation";
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

// ── Smooth table ────────────────────────────────────────────────────────────
function SmoothTable({
  segment,
  rows,
  weeks,
}: {
  segment: string;
  rows: SmoothRow[];
  weeks: number;
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
              <Th col="selected_model" label="Model" />
              <TableHead>Confidence</TableHead>
              {isShortHistory && <Th col="active_weeks"        label="Weeks of history" right />}
              {isShortHistory && <Th col="weeks_to_graduation" label="Weeks to full history" right />}
              <Th col="demand_total" label={`${weeks}W Demand`}   right />
              <Th col="yhat_total"   label={`${weeks}W Forecast`} right />
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
                <TableCell className="text-xs text-muted-foreground">
                  {row.selected_model}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CONF_STYLES[row.confidence] ?? "bg-muted text-muted-foreground border"}`}>
                    {row.confidence}
                  </span>
                </TableCell>
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
export function SegmentDetailTable({ segment }: { segment: string }) {
  const isIntermittent = segment === "intermittent";

  const [weeks, setWeeks]             = useState(isIntermittent ? 13 : 10);
  const [customInput, setCustomInput] = useState("");
  const [data, setData]               = useState<DetailResponse | null>(null);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/forecast/segment/${encodeURIComponent(segment)}?weeks=${weeks}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error as string);
        setData(json as DetailResponse);
      })
      .catch((err: Error) => setError(err.message));
  }, [segment, weeks]);

  return (
    <div className="space-y-3">
      <WeekSelector
        weeks={weeks}
        customInput={customInput}
        setWeeks={setWeeks}
        setCustomInput={setCustomInput}
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading SKU data…
        </div>
      )}

      {data && isIntermittent && (
        <IntermittentTable
          rows={data.skus as IntermittentRow[]}
          weeks={data.weeks}
        />
      )}

      {data && !isIntermittent && (
        <SmoothTable
          segment={segment}
          rows={data.skus as SmoothRow[]}
          weeks={data.weeks}
        />
      )}
    </div>
  );
}
