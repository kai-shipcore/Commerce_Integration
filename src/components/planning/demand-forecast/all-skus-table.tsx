"use client";

/**
 * Code Guide:
 * Cross-segment SKU directory — every SKU in the velocity universe with its
 * segment classification, demand over a selectable window, 4-week momentum,
 * last sale, and the latest run's forward forecast total. Complements the
 * per-segment detail tables (which keep segment-specific diagnostics) by
 * making cross-segment sorting, filtering, and CSV export possible.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2, RotateCcw, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface AllSkuRow {
  unique_id: string;
  segment: "smooth_full" | "smooth_short" | "intermittent";
  model: string | null;
  active_weeks: number;
  last_sale_week: string | null;
  weeks_since_last_sale: number | null;
  demand_total: number;
  avg_weekly: number;
  trend_pct: number | null;
  recent_4w: number;
  prior_4w: number;
  forecast_total: number | null;
}

interface AllSkusData {
  weeks: number;
  period_start: string;
  period_end: string;
  forecast_horizon_weeks: number;
  skus: AllSkuRow[];
}

type SortKey = "unique_id" | "segment" | "model" | "active_weeks" | "demand_total" | "trend_pct" | "last_sale_week" | "forecast_total";
type SortDir = "asc" | "desc";
type SortCriterion = { key: SortKey; dir: SortDir };

const DEFAULT_SORT: SortCriterion[] = [{ key: "demand_total", dir: "desc" }];
// Columns whose first click sorts ascending (text/date-like)
const DEFAULT_ASC: SortKey[] = ["unique_id", "segment", "model", "last_sale_week"];

const WEEK_OPTIONS = [4, 8, 10, 13, 26, 52];
const PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"];
const PAGE_SIZES = [25, 50, 100];

const SEGMENT_BADGES: Record<AllSkuRow["segment"], { ko: string; en: string; cls: string }> = {
  smooth_full:  { ko: "스무스",  en: "Smooth",       cls: "bg-blue-50 text-blue-700 border-blue-200" },
  smooth_short: { ko: "단기 이력", en: "Short history", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  intermittent: { ko: "비정기",  en: "Intermittent",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

const SEGMENT_FILTERS = [
  { value: "all" as const,          ko: "전체",    en: "All" },
  { value: "smooth_full" as const,  ko: "스무스",  en: "Smooth" },
  { value: "smooth_short" as const, ko: "단기 이력", en: "Short history" },
  { value: "intermittent" as const, ko: "비정기",  en: "Intermittent" },
];

const fmt = new Intl.NumberFormat("en-US");

export function AllSkusTable({ initialTypes }: { initialTypes: string[] }) {
  const { pick } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<AllSkusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const [weeks, setWeeks] = useState(10);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialTypes);
  const [segFilter, setSegFilter] = useState<"all" | AllSkuRow["segment"]>("all");
  const [search, setSearch] = useState("");
  const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Wait for the forecast server (started by the layout) to be ready
        let ready = false;
        for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
          try {
            const res = await fetch(apiPath("/api/forecast-server/start"), { method: "POST" });
            if (res.ok) { ready = true; break; }
            const json = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(json.error ?? `Forecast server error ${res.status}`);
          } catch (err) {
            if (err instanceof TypeError) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            throw err;
          }
        }
        if (cancelled) return;
        if (!ready) throw new Error("Forecast server did not start in time");

        const allSelected = selectedTypes.length === PRODUCT_TYPES.length;
        const productType = selectedTypes.length === 0 || allSelected ? "All" : selectedTypes.join(",");
        const params = new URLSearchParams({ weeks: String(weeks), product_type: productType });
        const res = await fetch(apiPath(`/api/forecast/all-skus?${params}`), { signal: AbortSignal.timeout(30_000) });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Server error ${res.status}`);
        if (!cancelled) setData(json as AllSkusData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [weeks, selectedTypes, retryCount]);

  const filteredRows = useMemo(() => {
    let rows = data?.skus ?? [];
    if (segFilter !== "all") rows = rows.filter((r) => r.segment === segFilter);
    const q = search.trim().toUpperCase();
    if (q) rows = rows.filter((r) => r.unique_id.toUpperCase().includes(q));

    const val = (r: AllSkuRow, key: SortKey, dir: SortDir): string | number => {
      switch (key) {
        case "unique_id":      return r.unique_id;
        case "segment":        return r.segment;
        case "model":          return r.model ?? "";
        case "active_weeks":   return r.active_weeks;
        case "demand_total":   return r.demand_total;
        case "trend_pct":      return r.trend_pct ?? (dir === "asc" ? Infinity : -Infinity);
        case "last_sale_week": return r.last_sale_week ?? "";
        case "forecast_total": return r.forecast_total ?? (dir === "asc" ? Infinity : -Infinity);
      }
    };
    return [...rows].sort((a, b) => {
      for (const { key, dir } of sortCriteria) {
        const sign = dir === "asc" ? 1 : -1;
        const av = val(a, key, dir), bv = val(b, key, dir);
        const cmp = typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
        if (cmp !== 0) return cmp * sign;
      }
      return 0;
    });
  }, [data, segFilter, search, sortCriteria]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  const handleSort = (key: SortKey, shiftKey: boolean) => {
    setSortCriteria((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (shiftKey) {
        if (idx !== -1) return prev.map((c, i) => i === idx ? { ...c, dir: c.dir === "asc" ? "desc" as const : "asc" as const } : c);
        return [...prev, { key, dir: DEFAULT_ASC.includes(key) ? "asc" : "desc" }];
      }
      if (idx !== -1) return [{ key, dir: prev[idx].dir === "asc" ? "desc" : "asc" }];
      return [{ key, dir: DEFAULT_ASC.includes(key) ? "asc" : "desc" }];
    });
    setPage(1);
  };

  const isDefaultSort = sortCriteria.length === 1
    && sortCriteria[0].key === DEFAULT_SORT[0].key
    && sortCriteria[0].dir === DEFAULT_SORT[0].dir;

  const exportCsv = () => {
    if (!data) return;
    const header = ["SKU", "Segment", "Model", "Weeks of history", `${data.weeks}W demand`, "Avg/week", "4W trend %", "Recent 4W", "Prior 4W", "Last sale week", `Next ${data.forecast_horizon_weeks}W forecast`];
    const lines = filteredRows.map((r) => [
      r.unique_id, r.segment, r.model ?? "", r.active_weeks, r.demand_total, r.avg_weekly,
      r.trend_pct ?? "", r.recent_4w, r.prior_4w, r.last_sale_week ?? "", r.forecast_total ?? "",
    ].join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all-skus-${data.period_end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pill = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
    }`;

  const renderSortIcon = (col: SortKey) => {
    const idx = sortCriteria.findIndex((c) => c.key === col);
    if (idx === -1) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
    const Arrow = sortCriteria[idx].dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <span className="ml-1 inline-flex items-center gap-px align-middle">
        <Arrow className="h-3 w-3 text-foreground" />
        {sortCriteria.length > 1 && (
          <span className="text-[9px] font-semibold leading-none text-primary/60">{idx + 1}</span>
        )}
      </span>
    );
  };

  const renderTh = (col: SortKey, label: string, right?: boolean) => (
    <TableHead
      onClick={(e) => handleSort(col, e.shiftKey)}
      className={`cursor-pointer select-none whitespace-nowrap text-xs ${right ? "text-right" : ""}`}
    >
      {label}
      {renderSortIcon(col)}
    </TableHead>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {pick("SKU 목록 불러오는 중...", "Loading SKU directory...")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>{pick("SKU 목록을 불러올 수 없습니다:", "Could not load SKU directory:")} {error}</p>
        <button
          onClick={() => setRetryCount((c) => c + 1)}
          className="rounded border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          {pick("다시 시도", "Retry")}
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{pick("조회 기간", "Window")}</span>
            {WEEK_OPTIONS.map((w) => (
              <button key={w} onClick={() => { setWeeks(w); setPage(1); }} className={pill(weeks === w)}>
                {w}{pick("주", "W")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {SEGMENT_FILTERS.map((opt) => (
              <button key={opt.value} onClick={() => { setSegFilter(opt.value); setPage(1); }} className={pill(segFilter === opt.value)}>
                {pick(opt.ko, opt.en)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {PRODUCT_TYPES.map((pt) => (
              <button
                key={pt}
                onClick={() => {
                  setSelectedTypes((prev) => prev.includes(pt) ? prev.filter((t) => t !== pt) : [...prev, pt]);
                  setPage(1);
                }}
                className={pill(selectedTypes.includes(pt))}
              >
                {pt}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={pick("SKU 검색", "Search SKU")}
              className="w-44 rounded border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-blue-400 dark:border-zinc-600"
            />
          </div>
          {!isDefaultSort && (
            <button
              onClick={() => { setSortCriteria(DEFAULT_SORT); setPage(1); }}
              className="flex items-center gap-1.5 rounded border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {pick("정렬 초기화", "Reset sort")}
            </button>
          )}
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {pick(
            `${fmt.format(filteredRows.length)}개 SKU · ${data.period_start} – ${data.period_end}`,
            `${fmt.format(filteredRows.length)} SKUs · ${data.period_start} – ${data.period_end}`,
          )}
          <span className="text-muted-foreground/60">
            {sortCriteria.length > 1
              ? pick(`· ${sortCriteria.length}개 열 정렬 중`, `· ${sortCriteria.length} columns sorted`)
              : pick("· Shift+클릭으로 여러 열 동시 정렬", "· Shift+click headers to sort by multiple columns")}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="rounded border bg-background px-1.5 py-1 text-xs outline-none dark:border-zinc-600"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}{pick("개씩", "/page")}</option>)}
          </select>
          <button disabled={clampedPage <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-muted">‹</button>
          <span>{clampedPage} / {totalPages}</span>
          <button disabled={clampedPage >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-muted">›</button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-md border">
        <Table>
          <TableHeader className="sticky top-14 z-10 bg-background">
            <TableRow>
              {renderTh("unique_id", "SKU")}
              {renderTh("segment", pick("세그먼트", "Segment"))}
              {renderTh("model", pick("모델", "Model"))}
              {renderTh("active_weeks", pick("이력 주 수", "Weeks of history"), true)}
              {renderTh("demand_total", pick(`${data.weeks}주 수요`, `${data.weeks}W Demand`), true)}
              <TableHead className="whitespace-nowrap text-right text-xs">{pick("주 평균", "Avg/wk")}</TableHead>
              {renderTh("trend_pct", pick("4주 추세", "4W Trend"), true)}
              {renderTh("last_sale_week", pick("마지막 판매", "Last sale"), true)}
              {renderTh("forecast_total", pick(`${data.forecast_horizon_weeks}주 예측`, `${data.forecast_horizon_weeks}W Forecast`), true)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => {
              const badge = SEGMENT_BADGES[row.segment];
              return (
                <TableRow
                  key={row.unique_id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/planning/sku-forecasts?sku=${encodeURIComponent(row.unique_id)}`)}
                >
                  <TableCell className="font-mono text-xs text-primary">{row.unique_id}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {pick(badge.ko, badge.en)}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.model ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{row.active_weeks}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{fmt.format(row.demand_total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{row.avg_weekly}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums text-sm ${
                      row.trend_pct == null ? "text-muted-foreground/50"
                      : row.trend_pct > 5 ? "text-emerald-600"
                      : row.trend_pct < -5 ? "text-red-600"
                      : "text-muted-foreground"
                    }`}
                    title={pick(
                      `최근 4주 ${fmt.format(row.recent_4w)} vs 이전 4주 ${fmt.format(row.prior_4w)}`,
                      `Recent 4w ${fmt.format(row.recent_4w)} vs prior 4w ${fmt.format(row.prior_4w)}`,
                    )}
                  >
                    {row.trend_pct == null ? "—" : `${row.trend_pct > 0 ? "▲" : row.trend_pct < 0 ? "▼" : ""} ${row.trend_pct > 0 ? "+" : ""}${row.trend_pct}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {row.last_sale_week ?? "—"}
                    {row.weeks_since_last_sale != null && row.weeks_since_last_sale > 8 && (
                      <span className="ml-1 text-amber-600">({row.weeks_since_last_sale}{pick("주 전", "w ago")})</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {row.forecast_total != null ? fmt.format(row.forecast_total) : <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
