"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AlertTriangle, CalendarIcon, Loader2 } from "lucide-react";
import { format, subWeeks } from "date-fns";
import type { DemandRow } from "@/types/demand-planning";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pick, type SkuForecastLanguage } from "../language";
import { apiPath } from "@/lib/api-path";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const FORECAST_API_BASE = "/api/forecast";

const HISTORY_OPTIONS = [
  { label: "26w", value: 26 },
  { label: "52w", value: 52 },
  { label: "All", value: 0 },
] as const;

const BT_TRAIN_OPTIONS = [
  { label: "26w", value: 26 },
  { label: "52w", value: 52 },
  { label: "All", value: 0 },
] as const;

const BT_MIN_TRAIN_WEEKS = 20; // matches model_min for smooth SKUs in the FastAPI backtest endpoint

const LEVEL_OPTIONS = [
  { value: 40, label: "P70" },
  { value: 60, label: "P80" },
  { value: 70, label: "P85" },
  { value: 80, label: "P90" },
  { value: 90, label: "P95" },
] as const;

const levelLabel = (v: number) => LEVEL_OPTIONS.find((o) => o.value === v)?.label ?? "P85";

const MODEL_OPTIONS = [
  { value: "Auto", label: "Auto" },
  { value: "AutoARIMA", label: "AutoARIMA" },
  { value: "AutoETS", label: "AutoETS" },
  { value: "AutoTheta", label: "AutoTheta" },
  { value: "WindowAverage", label: "Window Avg" },
  { value: "HistoricAverage", label: "Historic Avg" },
  { value: "SeasonalNaive", label: "Seasonal Naïve" },
  { value: "Naive", label: "Naïve" },
];

const MODEL2_BASE_OPTIONS = [
  { value: "AutoARIMA", label: "AutoARIMA" },
  { value: "AutoETS", label: "AutoETS" },
  { value: "AutoTheta", label: "AutoTheta" },
  { value: "WindowAverage", label: "Window Avg" },
  { value: "HistoricAverage", label: "Historic Avg" },
  { value: "SeasonalNaive", label: "Seasonal Naïve" },
  { value: "Naive", label: "Naïve" },
];

const MODEL_DESCRIPTIONS: Record<string, { ko: string; en: string }> = {
  Auto:            { ko: "여러 후보 모델을 자동으로 비교해 가장 정확한 예측 모델을 선택합니다.", en: "Automatically compares candidate models and selects the best-performing one." },
  AutoARIMA:       { ko: "자기회귀·이동평균 기반 자동 탐색. 트렌드와 계절성이 있는 데이터에 적합합니다.", en: "Auto-tuned ARIMA. Best for data with trends and seasonal patterns." },
  AutoETS:         { ko: "지수평활법 자동 선택. 계절성 패턴이 뚜렷한 SKU에 강합니다.", en: "Auto exponential smoothing. Strong when seasonal patterns are clear." },
  AutoTheta:       { ko: "Theta 분해 기반. 단순하면서 노이즈에 강인하고 속도가 빠릅니다.", en: "Theta decomposition. Simple, fast, and resistant to noisy data." },
  WindowAverage:   { ko: "최근 N주 평균을 반복 사용합니다. 판매량이 완만하고 안정적인 SKU에 적합합니다.", en: "Repeats the average of the last N weeks. Good for stable, flat-trend SKUs." },
  HistoricAverage: { ko: "전체 판매 이력의 평균을 예측값으로 사용합니다. 가장 단순한 기준선입니다.", en: "Uses the overall historical average as the forecast. The simplest baseline." },
  SeasonalNaive:   { ko: "작년 동일 기간 판매량을 그대로 반복합니다. 계절성이 강한 SKU에 유리합니다.", en: "Repeats last year's same-period values. Best for strongly seasonal SKUs." },
  Naive:           { ko: "마지막 관측값을 예측값으로 사용합니다. 최소한의 기준선 모델입니다.", en: "Uses the last observed value as the forecast. A minimal baseline." },
};

function ModelTooltip({
  value,
  options,
  language,
  children,
}: {
  value: string;
  options: { value: string; label: string }[];
  language: SkuForecastLanguage;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const describedOptions = options.filter((opt) => MODEL_DESCRIPTIONS[opt.value]);
  if (describedOptions.length === 0) return <>{children}</>;

  const handleMouseEnter = () => {
    if (ref.current) setAnchorRect(ref.current.getBoundingClientRect());
    setShow(true);
  };

  const panel =
    show && anchorRect && typeof window !== "undefined"
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[9999] w-64 overflow-hidden rounded-md border bg-popover text-xs shadow-lg"
            style={{
              left: Math.min(anchorRect.left, window.innerWidth - 264),
              ...(anchorRect.top > 300
                ? { bottom: window.innerHeight - anchorRect.top + 6 }
                : { top: anchorRect.bottom + 6 }),
            }}
          >
            {describedOptions.map((opt) => {
              const desc = MODEL_DESCRIPTIONS[opt.value]!;
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`border-b border-border/50 px-3 py-2 last:border-b-0 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
                >
                  <div className={`font-semibold ${isSelected ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
                    {opt.label}
                    {isSelected && <span className="ml-1.5 font-normal opacity-50">✓</span>}
                  </div>
                  <p className="mt-0.5 leading-snug text-muted-foreground">
                    {language === "ko" ? desc.ko : desc.en}
                  </p>
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={ref} onMouseEnter={handleMouseEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {panel}
    </div>
  );
}

function lastMonday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function defaultBtCutoff(): Date {
  const d = lastMonday();
  d.setDate(d.getDate() - 13 * 7);
  return d;
}

interface ForecastMeta {
  sku_id: string;
  bucket: string;
  history_length: string;
  model: string;
  confidence: string;
  forecast_date: string;
  has_pi: boolean;
  forward_weeks: number;
}

function segmentLabel(bucket: string, historyLength: string): string {
  if (bucket !== "smooth") return "Intermittent";
  if (historyLength === "short") return "Smooth / Short history";
  return "Smooth";
}

function segmentMethod(bucket: string, historyLength: string): string {
  if (bucket !== "smooth") return "Restock policy";
  if (historyLength === "short") return "V1";
  return "StatsForecast";
}

interface ForecastResponse {
  chart: string;
  meta: ForecastMeta;
  forecastDates: string[];
  forecastValues: number[];
  forecastUpper: number[] | null;
  level?: number;
}

interface PlotlyFig {
  data: object[];
  layout: object;
}

interface BtPrediction {
  ds: string;
  yhat: number;
  yhat_lo: number | null;
  yhat_hi: number | null;
  actual: number | null;
}

interface BacktestResult {
  predictions: BtPrediction[];
  actuals_context: { ds: string; y: number }[];
  mae: number | null;
  wape: number | null;
  mase: number | null;
  coverage: number | null;
  level?: number;
  model_used: string;
  bucket: string;
  history_length: string;
  training_weeks: number;
  completed_weeks: number;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function trimFig(fig: PlotlyFig, forecastDates: string[], n: number, viewStart?: string | null): PlotlyFig {
  if (forecastDates.length === 0) return fig;
  const endX = forecastDates[Math.min(n, forecastDates.length) - 1];
  const lastForecastX = forecastDates[forecastDates.length - 1];
  // viewStart controls the initial zoom; null falls back to the first data point.
  // All data remains in the traces so the user can pan left freely.
  const firstDataX = ((fig.data[0] as Record<string, unknown>)?.x as string[] | undefined)?.[0];
  const rangeStart = viewStart ?? firstDataX;
  // minallowed must be ≤ rangeStart so selected history windows (26w, 52w) always
  // honour the full range even when actual data starts later (empty space is fine).
  const minAllowed = rangeStart && firstDataX && rangeStart < firstDataX ? rangeStart : firstDataX;
  return {
    ...fig,
    layout: {
      ...(fig.layout as object),
      xaxis: {
        ...((fig.layout as Record<string, unknown>).xaxis as object ?? {}),
        autorange: false,
        range: [
          rangeStart ? shiftDate(rangeStart, -4) : rangeStart,
          shiftDate(endX, 4),
        ],
        minallowed: minAllowed,
        maxallowed: shiftDate(lastForecastX, 4),
      },
    },
  };
}

export function DemandForecastTab({ sku, language, serverError }: { sku: DemandRow; language: SkuForecastLanguage; serverError?: string | null }) {
  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"forward" | "backtest">("forward");

  // ── Confidence level (smooth/full only) ───────────────────────────────────
  const [level, setLevel] = useState(70);

  // ── Forward forecast state ────────────────────────────────────────────────
  const [forwardModel, setForwardModel] = useState("Auto");
  const [chartStr, setChartStr] = useState<string | null>(null);
  const [meta, setMeta] = useState<ForecastMeta | null>(null);
  const [forecastDates, setForecastDates] = useState<string[]>([]);
  const [forecastValues, setForecastValues] = useState<number[]>([]);
  const [forecastUpper, setForecastUpper] = useState<number[] | null>(null);
  const [forwardWeeks, setForwardWeeks] = useState(13);
  const [inputWeeks, setInputWeeks] = useState("13");
  const [extraHorizon, setExtraHorizon] = useState(0);
  const [historyWeeks, setHistoryWeeks] = useState<number>(26);
  const [historyStart, setHistoryStart] = useState<Date | null>(null);
  const [historyFromDate, setHistoryFromDate] = useState<Date | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Backtest state ────────────────────────────────────────────────────────
  const [btCutoff, setBtCutoff] = useState<Date>(defaultBtCutoff);
  const [btHorizon, setBtHorizon] = useState(13);
  const [btInputHorizon, setBtInputHorizon] = useState("13");
  const [btTrainWeeks, setBtTrainWeeks] = useState(0);
  const [btTrainStart, setBtTrainStart] = useState<Date | null>(null);
  const [btContextWeeks, setBtContextWeeks] = useState(26);
  const [btContextStart, setBtContextStart] = useState<Date | null>(null);
  const [btPickerMode, setBtPickerMode] = useState<"train" | "context">("train");
  const [btModel, setBtModel] = useState("Auto");
  const [btModel2, setBtModel2] = useState("");
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btCalOpen, setBtCalOpen] = useState(false);
  const [btSharedCalOpen, setBtSharedCalOpen] = useState(false);

  // ── Bounds fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(apiPath("/api/forecast/bounds"))
      .then((r) => r.json())
      .then((data: { minDate: string | null }) => {
        if (!data.minDate) return;
        const [y, m, d] = data.minDate.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const daysToMonday = (1 - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + daysToMonday);
        setHistoryFromDate(date);
      })
      .catch(() => {});
  }, []);

  // ── Forward forecast fetch ────────────────────────────────────────────────
  useEffect(() => {
    if (!sku.sku) return;
    setChartStr(null);
    setMeta(null);
    setForecastDates([]);
    setForecastValues([]);
    setForecastUpper(null);
    setError(null);
    setNotFound(false);
    setLoading(true);

    const params = new URLSearchParams({ weeks: "0", level: String(level) }); // always fetch full history; zoom is client-side
    if (forwardModel !== "Auto") params.set("model", forwardModel);
    if (extraHorizon > 0) params.set("horizon", String(extraHorizon));
    const isOverride = forwardModel !== "Auto" || extraHorizon > 0;
    fetch(apiPath(`${FORECAST_API_BASE}/${encodeURIComponent(sku.sku)}?${params}`),
      { signal: AbortSignal.timeout(isOverride ? 30_000 : 10_000) }
    )
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return null; }
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `Server error ${res.status}`);
        return json as ForecastResponse;
      })
      .then((json) => {
        if (!json) return;
        setChartStr(json.chart);
        setMeta(json.meta);
        setForecastDates(json.forecastDates);
        setForecastValues(json.forecastValues);
        setForecastUpper(json.forecastUpper);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sku.sku, forwardModel, extraHorizon, level]);

  // Reset forward and backtest state when SKU changes
  useEffect(() => {
    setForwardWeeks(13);
    setInputWeeks("13");
    setExtraHorizon(0);
    setBtResult(null);
    setBtError(null);
    setBtCutoff(defaultBtCutoff());
    setBtTrainStart(null);
    setBtContextWeeks(26);
    setBtContextStart(null);
    setBtModel2("");
  }, [sku.sku]);

  function applyForwardWeeks() {
    const parsed = parseInt(inputWeeks);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 52) {
      setForwardWeeks(parsed);
      const available = meta?.forward_weeks ?? 0;
      if (parsed > available) setExtraHorizon(parsed);
    } else {
      setInputWeeks(String(forwardWeeks));
    }
    inputRef.current?.blur();
  }

  function applyBtHorizon() {
    const parsed = parseInt(btInputHorizon);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 52) setBtHorizon(parsed);
    else setBtInputHorizon(String(btHorizon));
  }

  function runBacktest() {
    // Client-side validation before hitting the API
    const effectiveTrainWeeks = btTrainStart
      ? Math.round((btCutoff.getTime() - btTrainStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
      : btTrainWeeks;

    if (effectiveTrainWeeks > 0 && effectiveTrainWeeks < BT_MIN_TRAIN_WEEKS) {
      setBtError(pick(language, `학습 데이터가 너무 짧습니다. 최소 ${BT_MIN_TRAIN_WEEKS}주가 필요합니다.`, `Training window is too short — minimum ${BT_MIN_TRAIN_WEEKS} weeks required.`));
      setBtResult(null);
      return;
    }
    if (effectiveTrainWeeks > 0 && btHorizon >= effectiveTrainWeeks) {
      setBtError(pick(language, `예측 기간(${btHorizon}주)이 학습 기간(${effectiveTrainWeeks}주) 이상입니다.`, `Horizon (${btHorizon}w) must be shorter than the training window (${effectiveTrainWeeks}w).`));
      setBtResult(null);
      return;
    }

    const maxHorizon = Math.floor((lastSalesWeek.getTime() - btCutoff.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (btHorizon > maxHorizon) {
      setBtError(pick(
        language,
        `예측 기간(${btHorizon}주)이 마지막 판매 데이터를 초과합니다. 선택한 기준일 기준 최대 ${maxHorizon}주입니다.`,
        `Horizon (${btHorizon}w) extends past the last full week of sales. Max from this cutoff is ${maxHorizon}w.`,
      ));
      setBtResult(null);
      return;
    }

    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    const modelParam = btModel2 ? `Ensemble:${btModel}+${btModel2}` : btModel;
    const params = new URLSearchParams({ cutoff: format(btCutoff, "yyyy-MM-dd"), horizon: String(btHorizon), model: modelParam, level: String(level) });
    if (btTrainStart) {
      params.set("train_start", format(btTrainStart, "yyyy-MM-dd"));
    } else {
      params.set("history_weeks", String(btTrainWeeks));
    }
    fetch(apiPath(`${FORECAST_API_BASE}/${encodeURIComponent(sku.sku)}/backtest?${params}`))
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `Error ${res.status}`);
        return json as BacktestResult;
      })
      .then(setBtResult)
      .catch((err: Error) => setBtError(err.message))
      .finally(() => setBtLoading(false));
  }

  // ── Shared date references ────────────────────────────────────────────────
  const lastSalesWeek = lastMonday();

  // ── Forward mode derived values ───────────────────────────────────────────
  const clampedWeeks = Math.min(Math.max(forwardWeeks, 1), forecastValues.length || meta?.forward_weeks || forwardWeeks);
  const sumSlice = (arr: number[]) => arr.slice(0, clampedWeeks).reduce((a, b) => a + b, 0);
  const orderMin = forecastValues.length > 0 ? sumSlice(forecastValues) : null;
  const orderMax = forecastUpper && forecastUpper.length > 0 ? sumSlice(forecastUpper) : null;
  const orderRange = useMemo(
    () =>
      orderMin !== null
        ? orderMax !== null
          ? `${orderMin.toLocaleString()} – ${orderMax.toLocaleString()}`
          : orderMin.toLocaleString()
        : "—",
    [orderMin, orderMax],
  );
  const displayFig = useMemo(() => {
    if (!chartStr) return null;
    const parsed = JSON.parse(chartStr) as PlotlyFig;
    if (language === "ko") {
      const curLabel = levelLabel(level);
      const nameMap: Record<string, string> = {
        "Actual demand": "실제 수요",
        [`${curLabel} interval`]: `${curLabel} 구간`,
        "Forecast": "예측",
      };
      parsed.data = (parsed.data as Record<string, unknown>[]).map((trace) =>
        trace.name && nameMap[trace.name as string]
          ? { ...trace, name: nameMap[trace.name as string] }
          : trace
      );
    }
    // Derive the initial zoom start from the history picker (all data is always present)
    const viewStart = historyStart
      ? format(historyStart, "yyyy-MM-dd")
      : historyWeeks > 0
        ? format(subWeeks(lastSalesWeek, historyWeeks), "yyyy-MM-dd")
        : null; // historyWeeks === 0 (All) → no restriction, show from first data point
    return trimFig(parsed, forecastDates, clampedWeeks, viewStart);
  }, [chartStr, forecastDates, clampedWeeks, language, historyWeeks, historyStart]);
  const forecastedStockout = useMemo(() => {
    const stock = sku.total_stock;
    if (!stock || stock <= 0 || forecastValues.length === 0 || forecastDates.length === 0) return null;
    let remaining = stock;
    for (let i = 0; i < forecastValues.length; i++) {
      const weekly = forecastValues[i];
      if (weekly <= 0) continue;
      if (remaining <= weekly) {
        const fraction = remaining / weekly;
        const weekEnd = new Date(forecastDates[i]);
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 6);
        weekStart.setDate(weekStart.getDate() + Math.round(fraction * 6));
        return weekStart;
      }
      remaining -= weekly;
    }
    return null;
  }, [sku.total_stock, forecastValues, forecastDates]);

  // ── Backtest chart figure ─────────────────────────────────────────────────
  const btDisplayFig = useMemo(() => {
    if (!btResult) return null;
    const { predictions } = btResult;

    // Always include all actuals_context in the traces — the context picker only sets zoom.
    const allActuals = btResult.actuals_context;
    const hasPi = predictions.some((p) => p.yhat_lo != null);
    const completedPreds = predictions.filter((p) => p.actual !== null);
    const piLabel = levelLabel(btResult.level ?? 70);

    const actualsX = [
      ...allActuals.map((a) => a.ds),
      ...completedPreds.map((p) => p.ds),
    ];
    const actualsY = [
      ...allActuals.map((a) => a.y),
      ...completedPreds.map((p) => p.actual as number),
    ];

    const xEnd = predictions.length > 0 ? predictions[predictions.length - 1].ds : actualsX[actualsX.length - 1];

    // Compute initial zoom start from the context picker (all data still panned to)
    const viewStart = btContextStart
      ? format(btContextStart, "yyyy-MM-dd")
      : btContextWeeks > 0
        ? format(subWeeks(new Date(format(btCutoff, "yyyy-MM-dd")), btContextWeeks), "yyyy-MM-dd")
        : actualsX[0]; // All → show from first data point
    const cutoffStr = format(btCutoff, "yyyy-MM-dd");

    const traces: Plotly.Data[] = [];

    if (hasPi) {
      traces.push({
        type: "scatter",
        x: [...predictions.map((p) => p.ds), ...[...predictions].reverse().map((p) => p.ds)],
        y: [...predictions.map((p) => p.yhat_hi ?? 0), ...[...predictions].reverse().map((p) => p.yhat_lo ?? 0)],
        fill: "toself",
        fillcolor: "rgba(221,132,82,0.18)",
        line: { color: "rgba(0,0,0,0)" },
        name: `${piLabel} interval`,
        showlegend: true,
        hoverinfo: "skip",
      } as Plotly.Data);
      traces.push({
        type: "scatter",
        x: predictions.map((p) => p.ds),
        y: predictions.map((p) => p.yhat_hi ?? 0),
        mode: "none",
        name: `${piLabel} interval`,
        showlegend: false,
        customdata: predictions.map((p) => [p.yhat_lo ?? 0, p.yhat_hi ?? 0]),
        hovertemplate: `${piLabel} interval: [%{customdata[0]}, %{customdata[1]}]<extra></extra>`,
      } as Plotly.Data);
    }

    traces.push({
      type: "scatter",
      x: predictions.map((p) => p.ds),
      y: predictions.map((p) => p.yhat),
      mode: "lines+markers",
      name: pick(language, "백테스트 예측", "Backtest forecast"),
      line: { color: "#DD8452", width: 2, dash: "dash" },
      marker: { size: 5 },
      hovertemplate: "Forecast: %{y:.0f}<extra></extra>",
    } as Plotly.Data);

    traces.push({
      type: "scatter",
      x: actualsX,
      y: actualsY,
      mode: "lines+markers",
      name: pick(language, "실제 수요", "Actual demand"),
      line: { color: "#4C72B0", width: 2 },
      marker: { size: 5 },
      hovertemplate: "Actual: %{y:.0f}<extra></extra>",
    } as Plotly.Data);

    return {
      data: traces,
      layout: {
        autosize: true,
        margin: { t: 40, r: 20, b: 60, l: 60 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { size: 11 },
        xaxis: {
          showgrid: true,
          gridcolor: "#F0F0F0",
          autorange: false,
          range: viewStart && xEnd ? [shiftDate(viewStart, -4), shiftDate(xEnd, 4)] : undefined,
          minallowed: actualsX[0],
          maxallowed: xEnd ? shiftDate(xEnd, 4) : undefined,
        },
        yaxis: { showgrid: true, gridcolor: "#F0F0F0", rangemode: "tozero" },
        legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
        hovermode: "x unified",
        shapes: cutoffStr
          ? [{ type: "line", x0: cutoffStr, x1: cutoffStr, y0: 0, y1: 1, yref: "paper", line: { color: "#AAAAAA", width: 1, dash: "dot" } }]
          : [],
      },
    };
  }, [btResult, btCutoff, btContextWeeks, btContextStart, language]); // context deps control zoom only

  const sectionHeader = (
    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {pick(language, "수요 예측", "Demand Forecast")}
    </div>
  );

  // ── Early returns (forward mode gates) ───────────────────────────────────
  if (serverError) {
    return (
      <div className="space-y-3">
        {sectionHeader}
        <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
          <p className="font-medium">{pick(language, "예측 서버 시작 실패", "Forecast server failed to start")}</p>
          <p className="text-xs">{serverError}</p>
          <p className="text-xs text-muted-foreground">
            {pick(language, "AI_SERVICE_URL 연결 상태를 확인하세요. 로컬 실행 방식이면 FORECAST_SERVER_DIR와 가상환경도 확인하세요.", "Check AI_SERVICE_URL connectivity. For local startup mode, also check FORECAST_SERVER_DIR and the venv.")}
          </p>
        </div>
      </div>
    );
  }
  if (loading && mode === "forward") {
    return (
      <div className="space-y-3">
        {sectionHeader}
        <div className="planning-panel flex h-64 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {pick(language, "예측 데이터 불러오는 중...", "Loading forecast...")}
        </div>
      </div>
    );
  }
  if (notFound && mode === "forward") {
    return (
      <div className="space-y-3">
        {sectionHeader}
        <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
          <p className="font-medium">{pick(language, "예측 없음", "No forecast available")}</p>
          <p className="text-xs">
            {pick(language, "이 SKU는 간헐적 수요 SKU이거나 아직 예측이 실행되지 않았습니다.", "This SKU is classified as intermittent demand or has not been forecasted yet.")}
          </p>
        </div>
      </div>
    );
  }
  if (error && mode === "forward") {
    const isServerDown = error.toLowerCase().includes("fetch") || error.toLowerCase().includes("reach");
    return (
      <div className="space-y-3">
        {sectionHeader}
        <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
          <p className="font-medium">{pick(language, "오류", "Error")}</p>
          <p className="text-xs">{error}</p>
          {isServerDown && (
            <p className="text-xs text-muted-foreground">
              {pick(language, "예측 서버가 실행 중인지 확인하세요 (port 8000)", "Make sure the forecast server is running on port 8000")}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (mode === "forward" && (!displayFig || !meta)) return null;

  const isLowConfidence = meta?.confidence === "low";
  const btMaxCutoff = subWeeks(lastSalesWeek, 1);

  // ── Smooth/full check: only show level selector for smooth/full SKUs ─────
  const isSmoothFull =
    (meta !== null && meta.bucket === "smooth" && meta.history_length !== "short") ||
    (btResult !== null && btResult.bucket === "smooth" && btResult.history_length !== "short");

  // ── Mode toggle button classes ─────────────────────────────────────────────
  const modeBtn = (m: "forward" | "backtest") =>
    `px-3 py-1 text-xs ${mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="space-y-3">
      {sectionHeader}
      {mode === "forward" && isLowConfidence && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {pick(language, "낮은 신뢰도 예측", "Low confidence forecast")}
          </span>
        </div>
      )}

      <div className="planning-panel rounded-lg border p-4">
        {/* ── Header: mode toggle + level selector ── */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {pick(language, "수요 예측", "Demand Forecast")}
            </span>
            {isSmoothFull && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{pick(language, "신뢰 수준", "Confidence")}</span>
                <div className="flex rounded-md border text-xs">
                  {LEVEL_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLevel(opt.value)}
                      className={`px-2.5 py-1 ${i === 0 ? "rounded-l-md" : ""} ${i === LEVEL_OPTIONS.length - 1 ? "rounded-r-md" : "border-r"} ${
                        level === opt.value
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex rounded-md border text-xs">
            <button type="button" onClick={() => setMode("forward")} className={`${modeBtn("forward")} rounded-l-md`}>
              {pick(language, "순방향", "Forward")}
            </button>
            <button type="button" onClick={() => setMode("backtest")} className={`${modeBtn("backtest")} rounded-r-md border-l`}>
              {pick(language, "백테스트", "Backtest")}
            </button>
          </div>
        </div>

        {/* ── Forward mode ── */}
        {mode === "forward" && displayFig && meta && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{pick(language, "예측", "Forecast")}</span>
                <input
                  ref={inputRef}
                  type="number"
                  min={1}
                  max={52}
                  value={inputWeeks}
                  onChange={(e) => setInputWeeks(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyForwardWeeks(); }}
                  onBlur={applyForwardWeeks}
                  className="w-12 rounded border bg-background px-1 py-0.5 text-center font-mono text-xs outline-none focus:border-blue-400 dark:border-zinc-600"
                />
                <span>{pick(language, "주", "weeks")}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{pick(language, "기간", "History")}</span>
                <div className="flex rounded-md border text-xs">
                  {HISTORY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setHistoryWeeks(opt.value); setHistoryStart(null); }}
                      className={`px-2.5 py-1 first:rounded-l-md ${
                        historyStart === null && historyWeeks === opt.value
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <Popover open={calOpen} onOpenChange={setCalOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`flex items-center gap-1 rounded-r-md border-l px-2.5 py-1 ${
                          historyStart !== null ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <CalendarIcon className="h-3 w-3" />
                        {historyStart ? format(historyStart, "MMM d") : pick(language, "날짜", "Date")}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={historyStart ?? undefined}
                        onSelect={(date) => { if (date) { setHistoryStart(date); setCalOpen(false); } }}
                        captionLayout="dropdown"
                        disabled={(day) => day.getDay() !== 1 || day > lastSalesWeek || (historyFromDate !== null && day < historyFromDate)}
                        startMonth={historyFromDate ?? undefined}
                        endMonth={lastSalesWeek}
                        fromDate={historyFromDate ?? undefined}
                        toDate={lastSalesWeek}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <ModelTooltip value={forwardModel} options={MODEL_OPTIONS} language={language}>
                <select
                  value={forwardModel}
                  onChange={(e) => setForwardModel(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-blue-400 dark:border-zinc-600"
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </ModelTooltip>
            </div>

            <Plot
              data={displayFig.data as Plotly.Data[]}
              layout={(() => {
                const base = displayFig.layout as Record<string, unknown>;
                const existingShapes = (base.shapes as object[] | undefined) ?? [];
                const stockoutStr = forecastedStockout ? format(forecastedStockout, "yyyy-MM-dd") : null;
                return {
                  ...(base as Partial<Plotly.Layout>),
                  autosize: true,
                  margin: { t: 40, r: 20, b: 60, l: 60 },
                  paper_bgcolor: "rgba(0,0,0,0)",
                  plot_bgcolor: "rgba(0,0,0,0)",
                  font: { size: 11 },
                  shapes: stockoutStr ? [
                    ...existingShapes,
                    {
                      type: "line",
                      x0: stockoutStr, x1: stockoutStr,
                      y0: 0, y1: 1, yref: "paper",
                      line: { color: "#C026D3", width: 2, dash: "dash" },
                    },
                  ] : existingShapes,
                  annotations: stockoutStr ? [
                    {
                      x: stockoutStr, y: 0.97, yref: "paper",
                      text: "Stockout",
                      showarrow: false,
                      xanchor: "left", xshift: 5,
                      font: { color: "#C026D3", size: 11 },
                      bgcolor: "rgba(255,255,255,0.85)",
                    },
                  ] : [],
                };
              })()}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "380px" }}
              useResizeHandler
            />
          </>
        )}

        {/* ── Backtest mode ── */}
        {mode === "backtest" && (
          <>
            {/* Controls */}
            <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {/* Cutoff date */}
              <div className="flex items-center gap-1.5">
                <span>{pick(language, "기준일", "Cutoff")}</span>
                <Popover open={btCalOpen} onOpenChange={setBtCalOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted"
                    >
                      <CalendarIcon className="h-3 w-3" />
                      {format(btCutoff, "MMM d, yyyy")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={btCutoff}
                      onSelect={(date) => { if (date) { setBtCutoff(date); setBtCalOpen(false); } }}
                      captionLayout="dropdown"
                      disabled={(day) => day.getDay() !== 1 || day > btMaxCutoff || (historyFromDate !== null && day < historyFromDate)}
                      startMonth={historyFromDate ?? undefined}
                      endMonth={btMaxCutoff}
                      fromDate={historyFromDate ?? undefined}
                      toDate={btMaxCutoff}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Horizon */}
              <div className="flex items-center gap-1">
                <span>{pick(language, "예측 기간", "Horizon")}</span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={btInputHorizon}
                  onChange={(e) => setBtInputHorizon(e.target.value)}
                  onBlur={applyBtHorizon}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-10 rounded border bg-background px-1 py-0.5 text-center font-mono text-xs outline-none focus:border-blue-400 dark:border-zinc-600"
                />
                <span>{pick(language, "주", "w")}</span>
              </div>

              {/* Train / History shared picker */}
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setBtPickerMode("train")}
                    className={`px-2.5 py-1 rounded-l-md border-r ${btPickerMode === "train" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {pick(language, "학습", "Train")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBtPickerMode("context")}
                    className={`px-2.5 py-1 rounded-r-md ${btPickerMode === "context" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {pick(language, "기간", "History")}
                  </button>
                </div>
                <div className="flex rounded-md border text-xs">
                  {BT_TRAIN_OPTIONS.map((opt) => {
                    const activeWeeks = btPickerMode === "train" ? btTrainWeeks : btContextWeeks;
                    const activeStart = btPickerMode === "train" ? btTrainStart : btContextStart;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          if (btPickerMode === "train") { setBtTrainWeeks(opt.value); setBtTrainStart(null); }
                          else { setBtContextWeeks(opt.value); setBtContextStart(null); }
                        }}
                        className={`px-2.5 py-1 first:rounded-l-md ${
                          activeStart === null && activeWeeks === opt.value
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <Popover open={btSharedCalOpen} onOpenChange={setBtSharedCalOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`flex items-center gap-1 rounded-r-md border-l px-2.5 py-1 ${
                          (btPickerMode === "train" ? btTrainStart : btContextStart) !== null
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <CalendarIcon className="h-3 w-3" />
                        {(btPickerMode === "train" ? btTrainStart : btContextStart)
                          ? format((btPickerMode === "train" ? btTrainStart : btContextStart)!, "MMM d")
                          : pick(language, "날짜", "Date")}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={(btPickerMode === "train" ? btTrainStart : btContextStart) ?? undefined}
                        onSelect={(date) => {
                          if (date) {
                            if (btPickerMode === "train") setBtTrainStart(date);
                            else setBtContextStart(date);
                            setBtSharedCalOpen(false);
                          }
                        }}
                        captionLayout="dropdown"
                        disabled={(day) => {
                          if (day.getDay() !== 1) return true;
                          if (historyFromDate !== null && day < historyFromDate) return true;
                          if (btPickerMode === "train") return day > subWeeks(btCutoff, BT_MIN_TRAIN_WEEKS);
                          return day >= btCutoff;
                        }}
                        startMonth={historyFromDate ?? undefined}
                        endMonth={btPickerMode === "train" ? subWeeks(btCutoff, BT_MIN_TRAIN_WEEKS) : subWeeks(btCutoff, 1)}
                        fromDate={historyFromDate ?? undefined}
                        toDate={btPickerMode === "train" ? subWeeks(btCutoff, BT_MIN_TRAIN_WEEKS) : subWeeks(btCutoff, 1)}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Model */}
              <div className="flex items-center gap-1">
                <ModelTooltip value={btModel} options={MODEL_OPTIONS} language={language}>
                  <select
                    value={btModel}
                    onChange={(e) => {
                      setBtModel(e.target.value);
                      if (e.target.value === btModel2) setBtModel2("");
                    }}
                    className="rounded border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-blue-400 dark:border-zinc-600"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </ModelTooltip>
                <span className="text-muted-foreground">+</span>
                <ModelTooltip value={btModel2} options={MODEL2_BASE_OPTIONS} language={language}>
                  <select
                    value={btModel2}
                    onChange={(e) => setBtModel2(e.target.value)}
                    className="rounded border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-blue-400 dark:border-zinc-600"
                  >
                    <option value="">None</option>
                    {MODEL2_BASE_OPTIONS.filter((opt) => opt.value !== btModel).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </ModelTooltip>
              </div>

            </div>
              <button
                type="button"
                onClick={runBacktest}
                disabled={btLoading}
                className="shrink-0 flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {btLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {btLoading ? pick(language, "실행 중...", "Running...") : pick(language, "실행", "Run")}
              </button>
            </div>

            {/* Chart / states */}
            {btLoading && (
              <div className="flex h-80 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {pick(language, "백테스트 실행 중 (최대 60초)...", "Running backtest (up to 60s)...")}
              </div>
            )}

            {btError && !btLoading && (
              <div className="flex h-80 flex-col items-center justify-center gap-1 text-sm">
                <p className="font-medium text-red-600">{pick(language, "오류", "Error")}</p>
                <p className="text-xs text-muted-foreground">{btError}</p>
              </div>
            )}

            {!btLoading && !btError && !btResult && (
              <div className="flex h-80 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <p>{pick(language, "파라미터를 설정하고 실행을 누르세요.", "Set parameters and click Run.")}</p>
              </div>
            )}

            {!btLoading && btDisplayFig && (
              <Plot
                data={btDisplayFig.data as Plotly.Data[]}
                layout={btDisplayFig.layout as Partial<Plotly.Layout>}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%", height: "380px" }}
                useResizeHandler
              />
            )}
          </>
        )}
      </div>

      {/* ── Forward meta strip ── */}
      {mode === "forward" && meta && (
        <div className="planning-panel grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-xs sm:grid-cols-3">
          <MetaField
            label={`${clampedWeeks}${pick(language, "주 추천 주문량", "-Week Order Range")}`}
            value={orderRange}
            tooltip={pick(
              language,
              `향후 ${clampedWeeks}주 예측 수요 합계입니다. ${levelLabel(level)} 구간이 제공될 경우, 범위의 상한선은 수요 불확실성을 위한 안전 재고 버퍼로 활용할 수 있습니다.`,
              `Total forecasted demand over the next ${clampedWeeks} weeks. When a prediction interval is available, the upper bound provides a safety buffer for demand uncertainty — useful when sizing order quantities.`,
            )}
          />
          <MetaField
            label={pick(language, "예측 재고 소진일", "Forecasted stockout")}
            value={forecastedStockout ? format(forecastedStockout, "MMM d, yyyy") : forecastValues.length > 0 ? pick(language, `${forecastValues.length}주 이후`, `>${forecastValues.length}w`) : "—"}
            tooltip={pick(
              language,
              "현재 보유 재고가 예측 수요 속도로 소진되는 예상 날짜입니다. 입고 예정 재고는 포함되지 않습니다. 입고 재고를 반영한 분석은 재고 탭을 확인하세요.",
              "Estimated date when current on-hand inventory runs out at the forecasted demand rate. Inbound shipments are not included — check the Inventory tab to factor those in.",
            )}
          >
            <span className={forecastedStockout ? "text-foreground" : "text-muted-foreground"}>
              {forecastedStockout
                ? format(forecastedStockout, "MMM d, yyyy")
                : forecastValues.length > 0
                  ? pick(language, `${forecastValues.length}주 이후`, `>${forecastValues.length}w`)
                  : "—"}
            </span>
          </MetaField>
          <MetaField
            label={pick(language, "세그먼트", "Segment")}
            value={segmentLabel(meta.bucket, meta.history_length)}
            tooltip={pick(
              language,
              "이 SKU의 예측 방법 분류입니다. Smooth: StatsForecast 앙상블 모델 사용. Smooth / Short history: 이력이 짧아 단순화된 V1 모델 사용. Intermittent: 간헐적 수요 전용 Restock policy 모델 사용.",
              "The forecasting method assigned to this SKU. Smooth: StatsForecast ensemble. Smooth / Short history: simplified V1 model for SKUs with limited history. Intermittent: Restock policy model for sporadic demand.",
            )}
          />
          <MetaField
            label={pick(language, "모델", "Model")}
            value={meta.model}
            tooltip={pick(
              language,
              "예측에 사용된 알고리즘입니다. Auto는 마지막 배치 실행 시 교차 검증 정확도 기반으로 가장 적합한 모델이 자동 선택된 것입니다. 위의 드롭다운으로 다른 모델을 직접 선택할 수 있습니다.",
              "The algorithm used to generate this forecast. Auto means the best-fitting model was selected automatically during the last batch run using cross-validation accuracy. Use the model selector above to try a different one.",
            )}
          />
          <MetaField
            label={pick(language, "신뢰도", "Confidence")}
            value={meta.confidence === "low" ? pick(language, "낮음", "Low") : pick(language, "표준", "Standard")}
            highlight={isLowConfidence ? "amber" : undefined}
            tooltip={pick(
              language,
              "표준: 모델 오차가 계획에 적합한 범위 내에 있습니다. 낮음: 이력 데이터가 짧거나 판매가 불규칙하거나 모델 오차가 높습니다. 수치를 방향성 참고용으로만 활용하세요.",
              "Standard = the model's historical error is within an acceptable range for planning. Low = the SKU has short history, intermittent sales, or high model error — treat the forecast as directional guidance rather than a precise number.",
            )}
          >
            {isLowConfidence ? (
              <>
                <span className="text-amber-600 dark:text-amber-400">{pick(language, "낮음", "Low")}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({meta.history_length === "short"
                    ? pick(language, "이력 부족", "Short history")
                    : pick(language, "예측 오차 높음", "Accuracy")})
                </span>
              </>
            ) : undefined}
          </MetaField>
          <MetaField
            label={pick(language, "예측 실행일", "Forecast run")}
            value={meta.forecast_date}
            tooltip={pick(
              language,
              "이 예측이 마지막으로 생성된 날짜입니다. 몇 주 이상 된 예측은 최근 수요 변화를 반영하지 못할 수 있습니다. 배치 실행은 일반적으로 매주 모든 SKU 예측을 업데이트합니다.",
              "Date this forecast was last computed. A forecast that is several weeks old may not reflect recent demand changes. The batch run typically refreshes all SKU forecasts weekly.",
            )}
          />
        </div>
      )}

      {/* ── Backtest meta strip ── */}
      {mode === "backtest" && btResult && (() => {
        const btLabel = levelLabel(btResult.level ?? 70);
        const completedPreds = btResult.predictions.filter((p) => p.actual !== null);
        const hasPi = completedPreds.some((p) => p.yhat_lo !== null);
        const actualTotal = completedPreds.reduce((s, p) => s + (p.actual ?? 0), 0);
        const forecastTotal = completedPreds.reduce((s, p) => s + p.yhat, 0);
        const upperTotal = hasPi ? completedPreds.reduce((s, p) => s + (p.yhat_hi ?? p.yhat), 0) : null;
        const lowerTotal = hasPi ? completedPreds.reduce((s, p) => s + (p.yhat_lo ?? p.yhat), 0) : null;
        const diff = completedPreds.length > 0 ? actualTotal - forecastTotal : null;
        const diffPct = diff !== null && forecastTotal > 0 ? Math.round(diff / forecastTotal * 100) : null;
        const withinInterval = hasPi && lowerTotal !== null && upperTotal !== null && actualTotal >= lowerTotal && actualTotal <= upperTotal;

        const forecastLabel = hasPi && lowerTotal !== null && upperTotal !== null
          ? `${forecastTotal.toLocaleString()} – ${upperTotal.toLocaleString()}`
          : completedPreds.length > 0 ? forecastTotal.toLocaleString() : "—";

        return (
          <div className="planning-panel grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-xs sm:grid-cols-6">
            <MetaField
              label="MAE"
              value={btResult.mae != null ? `${btResult.mae.toLocaleString()} units` : "—"}
              tooltip={pick(
                language,
                "평균 절대 오차 — 예측과 실제 수요의 평균 차이(단위). MAE가 5이면 주당 평균 5개 오차를 의미합니다. 낮을수록 좋지만, 맥락이 중요합니다: 주당 200개 판매 SKU의 MAE 10은 우수하지만, 주당 12개 판매 SKU에서는 심각합니다.",
                "Mean Absolute Error — the average gap between forecast and actual demand in units. A MAE of 5 means the forecast was off by 5 units per week on average. Lower is better, but context matters: MAE of 10 on a SKU selling 200/week is excellent; on one selling 12/week it is concerning.",
              )}
            />
            <MetaField
              label="WAPE"
              value={btResult.wape != null ? `${Number(btResult.wape).toFixed(1)}%` : "—"}
              tooltip={pick(
                language,
                "가중 절대 백분율 오차 — 전체 실제 수요 대비 총 예측 오차의 비율입니다. 저판매량 SKU에서 단순 MAPE보다 신뢰할 수 있습니다. 20% 미만은 우수, 30% 미만은 대부분의 계획 목적에 적합합니다.",
                "Weighted Absolute Percentage Error — total forecast error as a percentage of total actual demand. More reliable than simple MAPE for low-volume SKUs. Under 20% is strong; under 30% is generally acceptable for planning.",
              )}
            />
            <MetaField
              label="MASE"
              value={btResult.mase != null ? btResult.mase.toFixed(2) : "—"}
              tooltip={pick(
                language,
                "평균 절대 스케일 오차 — 이 모델의 오차를 '지난 주 반복' 단순 기준선과 비교합니다. 1.0 미만(녹색)은 모델이 기준선을 초과함을 의미합니다. 1.0 이상은 지난 주를 그대로 반복하는 것이 더 정확했음을 의미합니다.",
                "Mean Absolute Scaled Error — compares this model's error to a simple 'repeat last week' naïve baseline. Below 1.0 (shown in green) means the model outperforms the baseline. At or above 1.0 means even repeating last week's number would have been more accurate.",
              )}
            >
              <span className={btResult.mase != null && btResult.mase < 1 ? "text-green-600 dark:text-green-400" : ""}>
                {btResult.mase != null ? btResult.mase.toFixed(2) : "—"}
              </span>
            </MetaField>
            <MetaField
              label={pick(language, `${btLabel} 적중률`, `${btLabel} coverage`)}
              value={btResult.coverage != null ? `${btResult.coverage}%` : "—"}
              tooltip={pick(
                language,
                `실제 수요가 ${btLabel} 예측 구간 내에 든 주차 비율입니다. 잘 보정된 모델은 목표 수준 근처여야 합니다.`,
                `Percentage of weeks where actual demand fell within the ${btLabel} forecast band. A well-calibrated model should score near the target level.`,
              )}
            />
            <MetaField
              label={pick(language, "모델", "Model")}
              value={btResult.model_used}
              tooltip={pick(
                language,
                "이 백테스트에 사용된 예측 모델입니다. 위의 컨트롤에서 모델을 변경하고 다시 실행하여 모델 간 정확도를 비교할 수 있습니다.",
                "The forecasting model used in this backtest. Change the model in the controls above and re-run to compare accuracy across different algorithms.",
              )}
            />
            <MetaField
              label={pick(language, "학습 주차", "Train / Eval")}
              value={`${btResult.training_weeks}w / ${btResult.completed_weeks}w`}
              tooltip={pick(
                language,
                "학습: 모델 훈련에 사용된 이력 데이터 주차 수. 평가: 실제 수요와 비교된 예측 주차 수(완료된 주차). 학습 데이터가 많을수록 일반적으로 정확도가 향상됩니다.",
                "Train = weeks of historical data used to fit the model. Eval = number of forecast weeks compared against actual demand (completed weeks only). More training data generally improves accuracy.",
              )}
            />

            <div className="col-span-2 sm:col-span-6 border-t border-border/60 mt-0.5" />

            <MetaField
              label={pick(language, "기간 실제 판매", "Horizon actual")}
              value={completedPreds.length > 0 ? `${actualTotal.toLocaleString()} units` : "—"}
              tooltip={pick(
                language,
                "평가 기간 동안 실제로 판매된 총 단위 수입니다. 예측 정확도가 측정되는 기준값입니다.",
                "Total units actually sold during the evaluation window. This is the ground truth the forecast accuracy is measured against.",
              )}
            />
            <MetaField
              label={pick(language, "기간 예측량", "Horizon forecast")}
              value={forecastLabel}
              tooltip={pick(
                language,
                `동일 평가 기간의 총 예측 단위 수입니다. ${btLabel} 구간이 있으면 범위는 포인트 예측에서 상한선까지 표시됩니다. 실제 판매량과 비교하여 전반적인 편향을 확인하세요.`,
                `Total forecasted units for the same evaluation window. When a prediction interval is available, the range runs from the point forecast to the ${btLabel} upper bound. Compare with the horizon actual to assess overall forecast bias.`,
              )}
              className="sm:col-span-2"
            />
            <MetaField
              label={pick(language, "차이 (실제 − 예측)", "Difference (actual − forecast)")}
              value={diff !== null ? `${diff >= 0 ? "+" : ""}${diff.toLocaleString()} units${diffPct !== null ? ` (${diff >= 0 ? "+" : ""}${diffPct}%)` : ""}` : "—"}
              tooltip={pick(
                language,
                "실제 판매량 빼기 예측량입니다. 양수(+)는 수요가 예측을 초과했음을 의미하며, 이 패턴이 지속되면 재고 부족 위험이 있습니다. 음수(−)는 예측이 실제 수요를 초과한 것으로 과잉 재고 위험을 나타냅니다.",
                "Actual demand minus forecast. Positive (+) means demand exceeded the forecast — ongoing stockout risk if this pattern continues. Negative (−) means the forecast overshot actual demand — potential overstock risk.",
              )}
              className="sm:col-span-3"
            >
              {diff !== null ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium text-foreground">
                    {diff >= 0 ? "+" : ""}{diff.toLocaleString()} units
                    {diffPct !== null && <span className="ml-1 text-muted-foreground font-normal">({diff >= 0 ? "+" : ""}{diffPct}%)</span>}
                  </span>
                  {hasPi && (
                    <span className={`text-[11px] ${withinInterval ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {withinInterval
                        ? pick(language, `${btLabel} 구간 내`, `within ${btLabel} interval`)
                        : pick(language, `${btLabel} 구간 외`, `outside ${btLabel} interval`)}
                    </span>
                  )}
                </div>
              ) : <span className="text-muted-foreground">—</span>}
            </MetaField>
          </div>
        );
      })()}
    </div>
  );
}

function MetaField({ label, value, highlight, tooltip, children, className }: { label: string; value: string; highlight?: "amber"; tooltip?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`text-left font-medium ${children ? "" : "truncate"} ${highlight === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
          >
            {children ?? value}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="break-words text-sm font-medium">{value}</div>
          {tooltip && <div className="mt-2 text-xs text-muted-foreground">{tooltip}</div>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
