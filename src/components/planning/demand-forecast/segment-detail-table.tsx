"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, Check, HelpCircle, Loader2, Square } from "lucide-react";
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
import { ModelInfoButton } from "./model-details";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ── Smooth row ──────────────────────────────────────────────────────────────
interface SmoothRow {
  unique_id: string;
  bucket: string;
  history_length: string;
  selected_model: string;
  confidence: string;
  yhat_total: number;
  yhat_lo_total: number | null;
  yhat_hi_total: number | null;
  demand_total: number;
  active_weeks: number | null;
  weeks_to_graduation: number | null;
  train_wape: number | null;
}

// ── Intermittent row ────────────────────────────────────────────────────────
interface IntermittentRow {
  unique_id: string;
  units_recent: number;
  last_sale_week: string | null;
  weeks_since_last_sale: number | null;
  event_count: number | null;
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
  forecast_run_date?: string | null;
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

type SmoothSortKey = "unique_id" | "selected_model" | "confidence" | "train_wape" | "yhat_total" | "demand_total" | "active_weeks" | "weeks_to_graduation" | "wape";
type IntermittentSortKey = "unique_id" | "units_recent" | "last_sale_week" | "weeks_since_last_sale" | "event_count" | "avg_units_per_event";
type SortDir = "asc" | "desc";

const SIM_MODEL_OPTIONS = [
  { value: "Auto",            label: "Auto (pipeline selection)" },
  { value: "AutoETS",         label: "AutoETS" },
  { value: "AutoARIMA",       label: "AutoARIMA" },
  { value: "AutoTheta",       label: "AutoTheta" },
  { value: "WindowAverage",   label: "Window Avg" },
  { value: "HistoricAverage", label: "Historic Avg" },
  { value: "SeasonalNaive",   label: "Seasonal Naïve" },
  { value: "Naive",           label: "Naïve" },
];

const fmt = new Intl.NumberFormat("en-US");
const fmtDec = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const CONF_STYLES: Record<string, string> = {
  standard: "bg-muted text-foreground border",
  low:      "bg-red-50 text-red-700 border border-red-200",
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

// ── Forecast interval tooltip ────────────────────────────────────────────────
function ForecastCell({
  yhat, lo, hi, demand, showDemand,
}: {
  yhat: number;
  lo: number | null;
  hi: number | null;
  demand?: number;
  showDemand?: boolean;
}) {
  const { pick } = useI18n();
  const hasInterval = lo !== null && hi !== null;
  const label = hasInterval ? `${fmt.format(yhat)} – ${fmt.format(hi)}` : fmt.format(yhat);

  if (!hasInterval) {
    return <span>{label}</span>;
  }

  // Build sorted number-line items
  type Item = { value: number; label: string; isActual?: boolean; isPoint?: boolean };
  const items: Item[] = [
    { value: lo,   label: pick("하한", "Low") },
    { value: yhat, label: pick("점 예측", "Point"), isPoint: true },
    { value: hi,   label: pick("상한", "High") },
  ];
  const hasDemand = showDemand && demand !== undefined;
  if (hasDemand) {
    items.push({ value: demand!, label: pick("실제값", "Actual"), isActual: true });
  }
  items.sort((a, b) => a.value - b.value || (a.isActual ? -1 : 1));

  const covered = hasDemand && demand! >= lo && demand! <= hi;

  const accentColor = !hasDemand
    ? "text-foreground"
    : covered
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <span className="group relative inline-block cursor-default">
      {label}
      <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-1.5 hidden rounded-md border bg-popover px-3 py-2.5 shadow-md group-hover:block"
        style={{ minWidth: "max-content" }}>
        <span className={`flex items-baseline gap-1 text-xs font-mono ${accentColor}`}>
          {items.map((item, i) => (
            <React.Fragment key={`${item.label}-${i}`}>
              {i > 0 && (
                <span className="text-muted-foreground mx-0.5 font-sans text-[10px]">&lt;</span>
              )}
              <span className="flex flex-col items-center gap-px">
                <span className={`text-[9px] font-sans leading-none ${
                  item.isActual ? accentColor : "text-muted-foreground"
                }`}>
                  {item.label}
                </span>
                <span className={`tabular-nums ${
                  item.isActual ? `font-semibold ${accentColor}` :
                  item.isPoint  ? "font-medium text-foreground" :
                                  "text-muted-foreground"
                }`}>
                  {fmt.format(item.value)}
                </span>
              </span>
            </React.Fragment>
          ))}
        </span>
      </span>
    </span>
  );
}

// ── Simulation step progress ─────────────────────────────────────────────────
const SIM_STEPS_EN = [
  { label: "Profiles",  marker: "Sim-Step 0:" },
  { label: "Filter",    marker: "Sim-Step 1:" },
  { label: "Demand",    marker: "Sim-Step 2:" },
  { label: "Zero-fill", marker: "Sim-Step 3:" },
  { label: "Fit",       marker: "Sim-Step 4:" },
  { label: "Done",      marker: "Sim-Step 5:" },
];
const SIM_STEPS_KO = [
  { label: "프로파일",  marker: "Sim-Step 0:" },
  { label: "필터링",    marker: "Sim-Step 1:" },
  { label: "수요",      marker: "Sim-Step 2:" },
  { label: "결측 보정", marker: "Sim-Step 3:" },
  { label: "모델 학습", marker: "Sim-Step 4:" },
  { label: "완료",      marker: "Sim-Step 5:" },
];

type SimStatus = "running" | "done" | "failed" | "cancelled";

function detectSimStep(lines: string[]): number {
  let current = -1;
  for (const line of lines) {
    for (let i = 0; i < SIM_STEPS_EN.length; i++) {
      if (line.includes(SIM_STEPS_EN[i].marker) && i > current) current = i;
    }
  }
  return current;
}

function SimStepProgress({ lines, status }: { lines: string[]; status: SimStatus }) {
  const { locale } = useI18n();
  const SIM_STEPS = locale === "ko" ? SIM_STEPS_KO : SIM_STEPS_EN;
  const current = detectSimStep(lines);
  return (
    <div className="flex items-start">
      {SIM_STEPS.map((step, i) => {
        const isDone      = status === "done" || i < current;
        const isActive    = i === current && status === "running";
        const isFailed    = i === current && status === "failed";
        const isCancelled = status === "cancelled" && i <= current;
        const connDone    = i > 0 && (status === "done" || i - 1 < current);
        return (
          <div key={step.label} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {i > 0 && <div className={`h-px flex-1 transition-colors ${connDone ? "bg-green-400" : "bg-border"}`} />}
              <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                isDone      ? "border-green-500 bg-green-500 text-white" :
                isActive    ? "border-blue-500 bg-blue-50 text-blue-600" :
                isFailed    ? "border-red-500 bg-red-50 text-red-600" :
                isCancelled ? "border-yellow-500 bg-yellow-50 text-yellow-600" :
                              "border-border bg-background text-muted-foreground"
              }`}>
                {isDone      && <Check className="h-2.5 w-2.5" />}
                {isActive    && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {isFailed    && <span className="text-[9px] font-bold">✕</span>}
                {isCancelled && <span className="text-[9px] font-bold">–</span>}
              </div>
              {i < SIM_STEPS.length - 1 && <div className={`h-px flex-1 transition-colors ${isDone ? "bg-green-400" : "bg-border"}`} />}
            </div>
            <span className={`mt-1 text-center text-[10px] leading-tight ${
              isDone      ? "text-green-600" :
              isActive    ? "font-medium text-blue-600" :
              isFailed    ? "text-red-600" :
              isCancelled ? "text-yellow-600" :
                            "text-muted-foreground"
            }`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type SortCriterion<K> = { key: K; dir: SortDir };

function SortIconSmooth({ col, criteria }: { col: SmoothSortKey; criteria: SortCriterion<SmoothSortKey>[] }) {
  const idx = criteria.findIndex((c) => c.key === col);
  if (idx === -1) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
  const Arrow = criteria[idx].dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <span className="ml-1 inline-flex items-center gap-px align-middle">
      <Arrow className="h-3 w-3 text-foreground" />
      {criteria.length > 1 && (
        <span className="text-[9px] font-semibold leading-none text-primary/60">{idx + 1}</span>
      )}
    </span>
  );
}

function SortIconInter({ col, criteria }: { col: IntermittentSortKey; criteria: SortCriterion<IntermittentSortKey>[] }) {
  const idx = criteria.findIndex((c) => c.key === col);
  if (idx === -1) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />;
  const Arrow = criteria[idx].dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <span className="ml-1 inline-flex items-center gap-px align-middle">
      <Arrow className="h-3 w-3 text-foreground" />
      {criteria.length > 1 && (
        <span className="text-[9px] font-semibold leading-none text-primary/60">{idx + 1}</span>
      )}
    </span>
  );
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
  const { pick } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{pick("조회 기간:", "Lookback window:")}</span>
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
            {w}{pick("주", "W")}
          </button>
        ))}
      </div>
      <input
        type="number"
        min={1}
        max={104}
        placeholder={pick("직접 입력", "custom")}
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
  const { pick } = useI18n();
  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{fmt.format(totalCount)} SKU</span>
        <div className="flex items-center gap-2">
          <span>{pick("페이지당 행 수:", "Rows per page:")}</span>
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
          <span className="text-muted-foreground">{pick(`${page + 1} / ${totalPages} 페이지`, `Page ${page + 1} of ${totalPages}`)}</span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            >
              {pick("이전", "Previous")}
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            >
              {pick("다음", "Next")}
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
  const { pick } = useI18n();

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
        <Loader2 className="h-4 w-4 animate-spin" /> {pick("예측 실행 목록 로딩 중…", "Loading forecast runs…")}
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
      <span className="text-xs text-muted-foreground">{pick("테스트 데이터 사용", "Use test data")}</span>
    </label>
  );

  if (cycles.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pick("완료된 예측 실행이 없습니다. 마지막 예측 주가 지나야 평가가 가능합니다.", "No completed forecast runs yet. A run is eligible once its final forecasted week has passed.")}
        </div>
        <TestModeToggle />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{pick("평가할 예측 실행 선택:", "Select a forecast run to evaluate:")}</span>
        <TestModeToggle />
      </div>

      <div className="rounded-md border max-h-[380px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur border-b">
            <tr>
              <Th col="forecast_date"  label={pick("예측 실행", "Forecast run")} />
              <Th col="horizon_start"  label={pick("기간 시작", "Horizon start")} />
              <Th col="horizon_end"    label={pick("기간 종료", "Horizon end")} />
              <Th col="horizon_weeks"  label={pick("주 수", "Weeks")} right />
              <Th col="sku_count"      label="SKU" right />
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

  // P70 coverage: % of SKUs where demand fell within the full conformal interval [lo, hi]
  const withPI      = rows.filter((r) => r.yhat_lo_total !== null && r.yhat_hi_total !== null);
  const covered     = withPI.filter((r) => r.demand_total >= r.yhat_lo_total! && r.demand_total <= r.yhat_hi_total!);
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

  const { pick } = useI18n();

  const biasLabel =
    bias === null ? pick("예측 방향 대 실제", "Forecast vs actual direction")
    : bias > 0.005 ? pick("과대 예측", "Over-forecast")
    : bias < -0.005 ? pick("과소 예측", "Under-forecast")
    : pick("정확", "On target");

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {pick("평가 기간:", "Evaluation period:")} <span className="font-medium text-foreground">{fmtDate(periodStart)} – {fmtDate(periodEnd)}</span>
        <span className="ml-1 text-muted-foreground/70">
          {pick(
            `(${weeks}주 · ${fmtDate(periodStart)} 이전 예측 vs 해당 기간 실제 수요)`,
            `(${weeks}W · forecast made before ${fmtDate(periodStart)} vs actual demand in this window)`,
          )}
        </span>
      </p>

      <div className={`grid gap-3 ${withPI.length > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">WAPE</p>
          <p className={`text-2xl font-semibold tabular-nums ${wapeColor}`}>
            {wape !== null ? `${(wape * 100).toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">{pick(`${withDemand.length}개 SKU의 가중 절대 오차`, `Weighted absolute error across ${withDemand.length} SKUs`)}</p>
        </div>

        <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{pick("편향", "Bias")}</p>
          <p className={`text-2xl font-semibold tabular-nums ${biasColor}`}>
            {bias !== null ? `${bias >= 0 ? "+" : ""}${(bias * 100).toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">{biasLabel}</p>
        </div>

        {withPI.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{pick("P70 커버리지", "P70 Coverage")}</p>
            <p className={`text-2xl font-semibold tabular-nums ${coverageColor}`}>
              {coverage !== null ? `${Math.round(coverage * 100)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {pick(`${withPI.length}개 SKU 중 ${covered.length}개가 [하한, 상한] 범위 내`, `${covered.length} of ${withPI.length} SKUs within [lo, hi] band`)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfidenceHeaderTip() {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          tabIndex={-1}
        >
          <HelpCircle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="center" className="w-64 p-3 text-xs leading-relaxed">
        {pick(
          "백테스트 WAPE 기준 모델의 학습 정확도입니다. 표준 = 정상 범위 오차. 낮음 = 학습 오차 높음 — 예측값을 대략적인 추정치로 활용하세요.",
          "Based on backtest WAPE — how well the model fit historical data. Standard = acceptable error. Low = high training error; treat the forecast as a rough estimate.",
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Smooth table ────────────────────────────────────────────────────────────
function SmoothTable({
  segment,
  rows,
  weeks,
  mode,
  forecastRunDate,
  initialSku,
}: {
  segment: string;
  rows: SmoothRow[];
  weeks: number;
  mode: string;
  forecastRunDate?: string | null;
  initialSku?: string;
}) {
  const router = useRouter();
  const { pick } = useI18n();
  const isShortHistory = segment === "smooth_short";

  const defaultAscSmooth: SmoothSortKey[] = ["unique_id", "selected_model", "weeks_to_graduation", "confidence"];
  const [sortCriteria, setSortCriteria] = useState<SortCriterion<SmoothSortKey>[]>([
    { key: isShortHistory ? "weeks_to_graduation" : "yhat_total", dir: isShortHistory ? "asc" : "desc" },
  ]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage]         = useState(0);
  const [skuSearch, setSkuSearch] = useState(initialSku ?? "");
  const [showLo, setShowLo]       = useState(false);
  const [showPt, setShowPt]       = useState(true);
  const [showHi, setShowHi]       = useState(false);
  const [colsOpen, setColsOpen]   = useState(false);

  useEffect(() => {
    if (initialSku) { setSkuSearch(initialSku); setPage(0); }
  }, [initialSku]);

  const filteredRows = skuSearch.trim()
    ? rows.filter((r) => r.unique_id.toLowerCase().includes(skuSearch.trim().toLowerCase()))
    : rows;

  function handleSort(key: SmoothSortKey, shiftKey: boolean) {
    setSortCriteria((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (shiftKey) {
        if (idx !== -1) return prev.map((c, i) => i === idx ? { ...c, dir: c.dir === "asc" ? "desc" : "asc" } : c);
        return [...prev, { key, dir: defaultAscSmooth.includes(key) ? "asc" : "desc" }];
      }
      if (idx !== -1) return [{ key, dir: prev[idx].dir === "asc" ? "desc" : "asc" }];
      return [{ key, dir: defaultAscSmooth.includes(key) ? "asc" : "desc" }];
    });
    setPage(() => 0);
  }

  function smoothVal(row: SmoothRow, key: SmoothSortKey): string | number {
    switch (key) {
      case "unique_id":           return row.unique_id;
      case "selected_model":      return row.selected_model;
      case "confidence":          return ({ standard: 1, low: 0 } as Record<string, number>)[row.confidence] ?? -1;
      case "train_wape":          return row.train_wape ?? 9999;
      case "demand_total":        return row.demand_total;
      case "active_weeks":        return row.active_weeks ?? -1;
      case "weeks_to_graduation": return row.weeks_to_graduation ?? 9999;
      case "wape":                return row.demand_total > 0 ? Math.abs(row.yhat_total - row.demand_total) / row.demand_total : 9999;
      default:                    return row.yhat_total;
    }
  }

  const sorted = [...filteredRows].sort((a, b) => {
    for (const { key, dir } of sortCriteria) {
      const av = smoothVal(a, key), bv = smoothVal(b, key);
      const cmp = typeof av === "string"
        ? dir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
        : dir === "asc" ? av - (bv as number) : (bv as number) - av;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows   = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function Th({ col, label, right }: { col: SmoothSortKey; label: React.ReactNode; right?: boolean }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : ""}`}
        onClick={(e) => handleSort(col, e.shiftKey)}
      >
        {label}
        <SortIconSmooth col={col} criteria={sortCriteria} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={pick("SKU 검색…", "Search SKU…")}
            value={skuSearch}
            onChange={(e) => { setSkuSearch(e.target.value); setPage(() => 0); }}
            className="w-56 rounded border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {skuSearch.trim() && (
            <span className="text-xs text-muted-foreground">{pick(`${rows.length}개 중 ${filteredRows.length}개`, `${filteredRows.length} of ${rows.length} SKUs`)}</span>
          )}
          {sortCriteria.length > 1 && (
            <span className="text-[10px] text-muted-foreground/60">{pick(`${sortCriteria.length}개 열 정렬 중`, `${sortCriteria.length} columns sorted`)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Popover open={colsOpen} onOpenChange={setColsOpen}>
            <PopoverTrigger asChild>
              <button className="rounded border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {pick("열 표시", "Columns")}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-44 p-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">{pick("예측 범위", "Forecast range")}</p>
              {([
                { key: "showLo" as const, label: pick("하한 (Low)", "Low"),      val: showLo, set: setShowLo },
                { key: "showPt" as const, label: pick("중간값 (Midpoint)", "Midpoint"), val: showPt, set: setShowPt },
                { key: "showHi" as const, label: pick("상한 (High)", "High"),     val: showHi, set: setShowHi },
              ]).map(({ key, label, val, set }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer rounded px-1 py-1 hover:bg-muted text-xs">
                  <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  {label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <ModelInfoButton method={isShortHistory ? "V1" : "StatsForecast"} />
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={setPageSize}
        totalCount={filteredRows.length}
      />

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground/70 select-none">
          {pick("Shift+클릭으로 여러 열 동시 정렬", "Shift+click column headers to sort by multiple columns")}
        </p>
        {forecastRunDate && (
          <p className="text-[11px] text-muted-foreground/70 select-none">
            {pick("마지막 예측:", "Last forecast:")} {fmtDate(forecastRunDate)}
          </p>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader className="sticky top-14 z-10 bg-background">
            <TableRow>
              <Th col="unique_id"      label="SKU" />
              {(!isShortHistory || mode === "simulation") && <Th col="selected_model" label={pick("모델", "Model")} />}
              {!isShortHistory && mode !== "simulation" && (
                <Th col="confidence" label={
                  <span className="inline-flex items-center gap-1">
                    {pick("신뢰도", "Confidence")}
                    <span onClick={(e) => e.stopPropagation()}>
                      <ConfidenceHeaderTip />
                    </span>
                  </span>
                } />
              )}
              {!isShortHistory && mode !== "simulation" && (
                <Th col="train_wape" label={pick("학습 WAPE", "Train WAPE")} right />
              )}
              <Th col="active_weeks" label={pick("이력 주 수", "Weeks of history")} right />
              {isShortHistory && <Th col="weeks_to_graduation" label={pick("전체 이력까지", "Weeks to full history")} right />}
              <Th col="demand_total" label={(mode === "backtest" || mode === "simulation") ? pick("실제", "Actual") : pick(`${weeks}주 수요`, `${weeks}W Demand`)}   right />
              {showLo && <Th col="yhat_total" label={pick("하한", "Low")} right />}
              {showPt && <Th col="yhat_total" label={(mode === "backtest" || mode === "simulation") ? pick("예측", "Forecast") : pick(`${weeks}주 예측`, `${weeks}W Forecast`)} right />}
              {showHi && <Th col="yhat_total" label={pick("상한", "High")} right />}
              {(mode === "backtest" || mode === "simulation") && <Th col="wape" label="WAPE" right />}
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
                {(!isShortHistory || mode === "simulation") && (
                  <TableCell className="text-xs text-muted-foreground">
                    {row.selected_model}
                  </TableCell>
                )}
                {!isShortHistory && mode !== "simulation" && (
                  <TableCell>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CONF_STYLES[row.confidence] ?? "bg-muted text-muted-foreground border"}`}>
                      {row.confidence}
                    </span>
                  </TableCell>
                )}
                {!isShortHistory && mode !== "simulation" && (
                  <TableCell className="text-right tabular-nums text-xs">
                    {row.train_wape !== null
                      ? <span className={row.confidence === "low" ? "text-red-600 font-medium" : "text-foreground"}>
                          {(row.train_wape * 100).toFixed(1)}%
                        </span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums text-sm">
                  {row.active_weeks ?? "—"}
                </TableCell>
                {isShortHistory && (
                  <TableCell className="text-right tabular-nums text-sm">
                    {row.weeks_to_graduation !== null ? (
                      row.weeks_to_graduation === 0 ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                          {pick("승급", "Promoted")}
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
                {showLo && (
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {row.yhat_lo_total !== null ? fmt.format(row.yhat_lo_total) : "—"}
                  </TableCell>
                )}
                {showPt && (
                  <TableCell className="text-right tabular-nums text-sm">
                    {(showLo || showHi)
                      ? fmt.format(row.yhat_total)
                      : <ForecastCell
                          yhat={row.yhat_total}
                          lo={row.yhat_lo_total ?? null}
                          hi={row.yhat_hi_total ?? null}
                          demand={row.demand_total}
                          showDemand={(mode === "backtest" || mode === "simulation") && !isShortHistory}
                        />}
                  </TableCell>
                )}
                {showHi && (
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {row.yhat_hi_total !== null ? fmt.format(row.yhat_hi_total) : "—"}
                  </TableCell>
                )}
                {(mode === "backtest" || mode === "simulation") && (
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
          <span className="text-muted-foreground">{pick(`${page + 1} / ${totalPages} 페이지`, `Page ${page + 1} of ${totalPages}`)}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">{pick("이전", "Previous")}</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">{pick("다음", "Next")}</button>
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
  forecastRunDate,
  initialSku,
}: {
  rows: IntermittentRow[];
  weeks: number;
  forecastRunDate?: string | null;
  initialSku?: string;
}) {
  const router = useRouter();
  const { pick } = useI18n();

  const [sortCriteria, setSortCriteria] = useState<SortCriterion<IntermittentSortKey>[]>([
    { key: "weeks_since_last_sale", dir: "desc" },
  ]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage]         = useState(0);
  const [skuSearch, setSkuSearch] = useState(initialSku ?? "");

  useEffect(() => {
    if (initialSku) { setSkuSearch(initialSku); setPage(0); }
  }, [initialSku]);

  const filteredRows = skuSearch.trim()
    ? rows.filter((r) => r.unique_id.toLowerCase().includes(skuSearch.trim().toLowerCase()))
    : rows;

  function handleSort(key: IntermittentSortKey, shiftKey: boolean) {
    setSortCriteria((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      const defaultDir: SortDir = key === "unique_id" ? "asc" : "desc";
      if (shiftKey) {
        if (idx !== -1) return prev.map((c, i) => i === idx ? { ...c, dir: c.dir === "asc" ? "desc" : "asc" } : c);
        return [...prev, { key, dir: defaultDir }];
      }
      if (idx !== -1) return [{ key, dir: prev[idx].dir === "asc" ? "desc" : "asc" }];
      return [{ key, dir: defaultDir }];
    });
    setPage(() => 0);
  }

  function interVal(row: IntermittentRow, key: IntermittentSortKey): string | number {
    switch (key) {
      case "unique_id":            return row.unique_id;
      case "units_recent":         return row.units_recent;
      case "last_sale_week":       return row.last_sale_week ?? "";
      case "event_count":          return row.event_count ?? -1;
      case "avg_units_per_event":  return row.avg_units_per_event ?? -1;
      default:                     return row.weeks_since_last_sale ?? 9999;
    }
  }

  const sorted = [...filteredRows].sort((a, b) => {
    for (const { key, dir } of sortCriteria) {
      const av = interVal(a, key), bv = interVal(b, key);
      const cmp = typeof av === "string"
        ? dir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
        : dir === "asc" ? av - (bv as number) : (bv as number) - av;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageRows   = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function Th({ col, label, right }: { col: IntermittentSortKey; label: string; right?: boolean }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : ""}`}
        onClick={(e) => handleSort(col, e.shiftKey)}
      >
        {label}
        <SortIconInter col={col} criteria={sortCriteria} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder={pick("SKU 검색…", "Search SKU…")}
          value={skuSearch}
          onChange={(e) => { setSkuSearch(e.target.value); setPage(() => 0); }}
          className="w-56 rounded border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {skuSearch.trim() && (
          <span className="text-xs text-muted-foreground">{pick(`${rows.length}개 중 ${filteredRows.length}개`, `${filteredRows.length} of ${rows.length} SKUs`)}</span>
        )}
        {sortCriteria.length > 1 && (
          <span className="text-[10px] text-muted-foreground/60">{pick(`${sortCriteria.length}개 열 정렬 중`, `${sortCriteria.length} columns sorted`)}</span>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={setPageSize}
        totalCount={filteredRows.length}
      />

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground/70 select-none">
          {pick("Shift+클릭으로 여러 열 동시 정렬", "Shift+click column headers to sort by multiple columns")}
        </p>
        {forecastRunDate && (
          <p className="text-[11px] text-muted-foreground/70 select-none">
            {pick("데이터 기준:", "Data through:")} {fmtDate(forecastRunDate)}
          </p>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader className="sticky top-14 z-10 bg-background">
            <TableRow>
              <Th col="unique_id"             label="SKU" />
              <Th col="units_recent"          label={pick(`${weeks}주 수량`, `${weeks}W Units`)} right />
              <Th col="last_sale_week"        label={pick("마지막 판매일", "Last sale date")} right />
              <Th col="weeks_since_last_sale" label={pick("마지막 판매 이후 주 수", "Weeks since last sale")} right />
              <Th col="event_count"           label={pick("이벤트 횟수", "Event count")} right />
              <Th col="avg_units_per_event"   label={pick("이벤트당 평균 수량", "Avg units / event")} right />
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
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                  {row.last_sale_week ? fmtDate(row.last_sale_week) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.weeks_since_last_sale !== null ? (
                    <span className={row.weeks_since_last_sale > 26 ? "text-red-600 font-medium" : row.weeks_since_last_sale > 13 ? "text-amber-600" : ""}>
                      {row.weeks_since_last_sale}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                  {row.event_count !== null ? fmt.format(row.event_count) : "—"}
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
          <span className="text-muted-foreground">{pick(`${page + 1} / ${totalPages} 페이지`, `Page ${page + 1} of ${totalPages}`)}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">{pick("이전", "Previous")}</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="rounded px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40">{pick("다음", "Next")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root export ─────────────────────────────────────────────────────────────
function defaultSimCutoff(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // last Monday
  d.setDate(d.getDate() - 13 * 7);                    // 13 weeks back
  return d.toISOString().split("T")[0];
}

export function SegmentDetailTable({ segment, initialTypes, initialSku }: { segment: string; initialTypes?: string[]; initialSku?: string }) {
  const { pick, locale } = useI18n();
  const isIntermittent = segment === "intermittent";

  const [weeks, setWeeks]                 = useState(isIntermittent ? 13 : 10);
  const [customInput, setCustomInput]     = useState("");
  const [mode, setMode]                   = useState<"forward" | "backtest" | "simulation">("forward");
  const [cycles, setCycles]               = useState<BacktestCycle[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [evalDate, setEvalDate]           = useState<string>("");
  const [testMode, setTestMode]           = useState(false);
  const testModeRef = React.useRef(testMode);
  testModeRef.current = testMode;
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialTypes ?? [...PRODUCT_TYPES]);
  const [data, setData]                   = useState<DetailResponse | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  // Simulation state
  const [simCutoff, setSimCutoff]   = useState(defaultSimCutoff);
  const [simHorizon, setSimHorizon] = useState(13);
  const [simHorizonInput, setSimHorizonInput] = useState("13");
  const [simModel, setSimModel]     = useState("Auto");
  const [simJobId, setSimJobId]     = useState<string | null>(null);
  const [simJob, setSimJob]         = useState<{ status: SimStatus; lines: string[] } | null>(null);
  const [simData, setSimData]       = useState<DetailResponse | null>(null);
  const [simError, setSimError]     = useState<string | null>(null);
  const simJobRef = useRef(simJob);
  simJobRef.current = simJob;

  const toggleType = (pt: string) =>
    setSelectedTypes((prev) => prev.includes(pt) ? prev.filter((t) => t !== pt) : [...prev, pt]);

  // Poll sim job status
  useEffect(() => {
    if (!simJobId || simJob?.status !== "running") return;
    const id = setInterval(async () => {
      try {
        const res  = await fetch(`/api/forecast/status/${simJobId}`);
        const data = await res.json() as { status: SimStatus; lines: string[] };
        setSimJob(data);
        if (data.status !== "running") {
          clearInterval(id);
          if (data.status === "done") {
            const rRes = await fetch(`/api/forecast/segment/${encodeURIComponent(segment)}/simulate/result?job_id=${simJobId}`);
            const rData = await rRes.json() as DetailResponse & { error?: string };
            if (rData.error) setSimError(rData.error);
            else setSimData(rData);
          } else if (data.status === "failed") {
            setSimError(data.lines.filter((l) => l.startsWith("Error")).join(" ") || "Simulation failed");
          }
        }
      } catch {
        // transient — keep polling
      }
    }, 2_000);
    return () => clearInterval(id);
  }, [simJobId, simJob?.status, segment]);

  async function runSimulation() {
    const allSelected = selectedTypes.length === PRODUCT_TYPES.length;
    const productType = allSelected ? "All" : selectedTypes.join(",");
    const params      = new URLSearchParams({
      cutoff: simCutoff, horizon: String(simHorizon), model: simModel, product_type: productType,
    });
    setSimJob({ status: "running", lines: [] });
    setSimJobId(null);
    setSimData(null);
    setSimError(null);
    try {
      const res  = await fetch(`/api/forecast/segment/${encodeURIComponent(segment)}/simulate?${params}`, { method: "POST" });
      const data = await res.json() as { job_id?: string; error?: string };
      if (!res.ok || data.error) {
        setSimJob({ status: "failed", lines: [data.error ?? "Failed to start"] });
        setSimError(data.error ?? "Failed to start simulation");
        return;
      }
      setSimJobId(data.job_id ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSimJob({ status: "failed", lines: [msg] });
      setSimError(msg);
    }
  }

  async function cancelSimulation() {
    if (!simJobId) return;
    try {
      await fetch(`/api/forecast/segment/${encodeURIComponent(segment)}/simulate/cancel/${simJobId}`, { method: "POST" });
    } catch {
      // status polling will catch the cancelled state
    }
  }

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
    if (mode === "simulation") return; // simulation has its own fetch
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
            {(["forward", "backtest", "simulation"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1 font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "forward" ? pick("포워드", "Forward") : m === "backtest" ? pick("백테스트", "Backtest") : pick("시뮬레이션", "Simulation")}
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

        {/* Simulation controls */}
        {mode === "simulation" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">{pick("기준일:", "Cutoff:")}</span>
                <input
                  type="date"
                  value={simCutoff}
                  onChange={(e) => setSimCutoff(e.target.value)}
                  disabled={simJob?.status === "running"}
                  className="rounded border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">{pick("기간:", "Horizon:")}</span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={simHorizonInput}
                  onChange={(e) => setSimHorizonInput(e.target.value)}
                  disabled={simJob?.status === "running"}
                  onBlur={() => {
                    const v = parseInt(simHorizonInput);
                    if (!isNaN(v) && v >= 1 && v <= 52) setSimHorizon(v);
                    else setSimHorizonInput(String(simHorizon));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseInt(simHorizonInput);
                      if (!isNaN(v) && v >= 1 && v <= 52) setSimHorizon(v);
                    }
                  }}
                  className="w-14 rounded border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground">{pick("주", "weeks")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">{pick("모델:", "Model:")}</span>
                <select
                  value={simModel}
                  onChange={(e) => setSimModel(e.target.value)}
                  disabled={simJob?.status === "running"}
                  className="rounded border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                  {SIM_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === "Auto" ? pick("자동 (파이프라인 선택)", "Auto (pipeline selection)") : opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => void runSimulation()}
                disabled={simJob?.status === "running" || !simCutoff}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
              >
                {simJob?.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {simJob?.status === "running" ? pick("실행 중…", "Running…") : pick("시뮬레이션 실행", "Run simulation")}
              </button>
              {simJob?.status === "running" && (
                <button
                  onClick={() => void cancelSimulation()}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-muted"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {pick("취소", "Cancel")}
                </button>
              )}
            </div>
            {simJob && (
              <SimStepProgress lines={simJob.lines} status={simJob.status} />
            )}
          </div>
        )}

        {/* Product type filters */}
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-muted-foreground">{pick("제품 유형:", "Product type:")}</span>
          <div className="flex flex-wrap gap-2">
            <ToggleBtn
              active={selectedTypes.length === PRODUCT_TYPES.length}
              onClick={() => setSelectedTypes(selectedTypes.length === PRODUCT_TYPES.length ? [] : [...PRODUCT_TYPES])}
            >
              {pick("전체", "All")}
            </ToggleBtn>
            {PRODUCT_TYPES.map((pt) => (
              <ToggleBtn key={pt} active={selectedTypes.includes(pt)} onClick={() => toggleType(pt)}>
                {pt}
              </ToggleBtn>
            ))}
          </div>
        </div>
      </div>

      {/* Forward / backtest display */}
      {mode !== "simulation" && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {mode !== "simulation" && !data && !error && noEligibleCycles && (
        <div className="text-center text-sm text-muted-foreground py-8">
          {pick("표시할 데이터가 없습니다.", "No data to display.")}
        </div>
      )}

      {mode !== "simulation" && !data && !error && !noEligibleCycles && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          {pick("SKU 데이터 로딩 중…", "Loading SKU data…")}
        </div>
      )}

      {mode !== "simulation" && data?.backtest_unavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {locale === "ko" ? (
            <>{fmtDate(data.period_start)} 이전 예측 이력이 없습니다.{" "}
              {data.earliest_forecast
                ? <><span className="font-medium">{fmtDate(data.earliest_forecast)}</span>부터 예측이 시작되었습니다. 더 짧은 기간을 선택하거나 주간 실행이 더 쌓인 후 확인하세요.</>
                : "예측 실행 기록이 없습니다."}</>
          ) : (
            <>No forecast history before{" "}
              <span className="font-medium">{fmtDate(data.period_start)}</span>.{" "}
              {data.earliest_forecast
                ? <>Forecasts have been running since <span className="font-medium">{fmtDate(data.earliest_forecast)}</span>. Try a shorter lookback window, or check back once more weekly runs have accumulated.</>
                : "No forecast runs found yet."}</>
          )}
        </div>
      )}

      {mode !== "simulation" && data && !isIntermittent && mode === "backtest" && !data.backtest_unavailable && (
        <AccuracyCards
          rows={data.skus as SmoothRow[]}
          periodStart={data.period_start}
          periodEnd={data.period_end}
          weeks={data.weeks}
        />
      )}

      {mode !== "simulation" && data && isIntermittent && (
        <IntermittentTable rows={data.skus as IntermittentRow[]} weeks={data.weeks} forecastRunDate={data.forecast_run_date} initialSku={initialSku} />
      )}

      {mode !== "simulation" && data && !isIntermittent && (
        <SmoothTable segment={segment} rows={data.skus as SmoothRow[]} weeks={data.weeks} mode={data.mode} forecastRunDate={data.forecast_run_date} initialSku={initialSku} />
      )}

      {/* Simulation display */}
      {mode === "simulation" && simError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {simError}
        </div>
      )}

      {mode === "simulation" && !simJob && !simData && !simError && (
        <div className="text-center text-sm text-muted-foreground py-8">
          {locale === "ko"
            ? <>위 매개변수를 설정하고 <span className="font-medium">시뮬레이션 실행</span>을 클릭하세요.</>
            : <>Configure the parameters above and click <span className="font-medium">Run simulation</span>.</>}
        </div>
      )}

      {mode === "simulation" && simJob?.status === "cancelled" && !simData && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pick("시뮬레이션이 취소되었습니다.", "Simulation cancelled.")}
        </div>
      )}

      {mode === "simulation" && simData && simJob?.status === "done" && (
        <>
          <AccuracyCards
            rows={simData.skus as SmoothRow[]}
            periodStart={simData.period_start}
            periodEnd={simData.period_end}
            weeks={simData.weeks}
          />
          <SmoothTable segment={segment} rows={simData.skus as SmoothRow[]} weeks={simData.weeks} mode="simulation" />
        </>
      )}
    </div>
  );
}
