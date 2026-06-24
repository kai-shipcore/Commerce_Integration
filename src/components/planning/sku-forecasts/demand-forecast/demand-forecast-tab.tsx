"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CalendarIcon, Loader2 } from "lucide-react";
import { format, subWeeks } from "date-fns";
import type { DemandRow } from "@/types/demand-planning";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pick, type SkuForecastLanguage } from "../language";

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
  model: string;
  confidence: string;
  forecast_date: string;
  has_pi: boolean;
  forward_weeks: number;
}

interface ForecastResponse {
  chart: string;
  meta: ForecastMeta;
  forecastDates: string[];
  forecastValues: number[];
  forecastUpper: number[] | null;
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

function trimFig(fig: PlotlyFig, forecastDates: string[], n: number): PlotlyFig {
  if (forecastDates.length === 0) return fig;
  const endX = forecastDates[Math.min(n, forecastDates.length) - 1];
  const startX = ((fig.data[0] as Record<string, unknown>)?.x as string[] | undefined)?.[0];
  return {
    ...fig,
    layout: {
      ...(fig.layout as object),
      xaxis: {
        ...((fig.layout as Record<string, unknown>).xaxis as object ?? {}),
        autorange: false,
        range: [
          startX ? shiftDate(startX, -4) : startX,
          shiftDate(endX, 4),
        ],
      },
    },
  };
}

export function DemandForecastTab({ sku, language, serverError }: { sku: DemandRow; language: SkuForecastLanguage; serverError?: string | null }) {
  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"forward" | "backtest">("forward");

  // ── Forward forecast state ────────────────────────────────────────────────
  const [chartStr, setChartStr] = useState<string | null>(null);
  const [meta, setMeta] = useState<ForecastMeta | null>(null);
  const [forecastDates, setForecastDates] = useState<string[]>([]);
  const [forecastValues, setForecastValues] = useState<number[]>([]);
  const [forecastUpper, setForecastUpper] = useState<number[] | null>(null);
  const [forwardWeeks, setForwardWeeks] = useState(13);
  const [inputWeeks, setInputWeeks] = useState("13");
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
    fetch("/api/forecast/bounds")
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

    const historyParam = historyStart
      ? `start=${format(historyStart, "yyyy-MM-dd")}`
      : `weeks=${historyWeeks}`;
    fetch(`${FORECAST_API_BASE}/${encodeURIComponent(sku.sku)}?${historyParam}`)
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
        setForwardWeeks(json.meta.forward_weeks);
        setInputWeeks(String(json.meta.forward_weeks));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sku.sku, historyWeeks, historyStart]);

  // Reset backtest when SKU changes
  useEffect(() => {
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
    if (!isNaN(parsed) && parsed >= 1) setForwardWeeks(parsed);
    else setInputWeeks(String(forwardWeeks));
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
    const params = new URLSearchParams({ cutoff: format(btCutoff, "yyyy-MM-dd"), horizon: String(btHorizon), model: modelParam });
    if (btTrainStart) {
      params.set("train_start", format(btTrainStart, "yyyy-MM-dd"));
    } else {
      params.set("history_weeks", String(btTrainWeeks));
    }
    fetch(`${FORECAST_API_BASE}/${encodeURIComponent(sku.sku)}/backtest?${params}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `Error ${res.status}`);
        return json as BacktestResult;
      })
      .then(setBtResult)
      .catch((err: Error) => setBtError(err.message))
      .finally(() => setBtLoading(false));
  }

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
  const displayFig = useMemo(
    () => chartStr ? trimFig(JSON.parse(chartStr) as PlotlyFig, forecastDates, clampedWeeks) : null,
    [chartStr, forecastDates, clampedWeeks],
  );
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

    const actuals_context = (() => {
      const all = btResult.actuals_context;
      if (btContextStart) {
        const startStr = format(btContextStart, "yyyy-MM-dd");
        return all.filter((a) => a.ds >= startStr);
      }
      if (btContextWeeks > 0) return all.slice(-btContextWeeks);
      return all;
    })();
    const hasPi = predictions.some((p) => p.yhat_lo !== null);
    const completedPreds = predictions.filter((p) => p.actual !== null);

    const actualsX = [
      ...actuals_context.map((a) => a.ds),
      ...completedPreds.map((p) => p.ds),
    ];
    const actualsY = [
      ...actuals_context.map((a) => a.y),
      ...completedPreds.map((p) => p.actual as number),
    ];

    const xStart = actualsX[0];
    const xEnd = predictions.length > 0 ? predictions[predictions.length - 1].ds : actualsX[actualsX.length - 1];
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
        name: "P70 interval",
        showlegend: true,
        hoverinfo: "skip",
      } as Plotly.Data);
      traces.push({
        type: "scatter",
        x: predictions.map((p) => p.ds),
        y: predictions.map((p) => p.yhat_hi ?? 0),
        mode: "none",
        name: "P70 interval",
        showlegend: false,
        customdata: predictions.map((p) => [p.yhat_lo ?? 0, p.yhat_hi ?? 0]),
        hovertemplate: "P70 interval: [%{customdata[0]}, %{customdata[1]}]<extra></extra>",
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
          range: xStart && xEnd ? [shiftDate(xStart, -4), shiftDate(xEnd, 4)] : undefined,
        },
        yaxis: { showgrid: true, gridcolor: "#F0F0F0", rangemode: "tozero" },
        legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
        hovermode: "x unified",
        shapes: cutoffStr
          ? [{ type: "line", x0: cutoffStr, x1: cutoffStr, y0: 0, y1: 1, yref: "paper", line: { color: "#AAAAAA", width: 1, dash: "dot" } }]
          : [],
      },
    };
  }, [btResult, btCutoff, btContextWeeks, btContextStart, language]);

  // ── Early returns (forward mode gates) ───────────────────────────────────
  if (serverError) {
    return (
      <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
        <p className="font-medium">{pick(language, "예측 서버 시작 실패", "Forecast server failed to start")}</p>
        <p className="text-xs">{serverError}</p>
        <p className="text-xs text-muted-foreground">
          {pick(language, "FORECAST_SERVER_DIR 환경 변수와 가상환경을 확인하세요.", "Check the FORECAST_SERVER_DIR environment variable and venv.")}
        </p>
      </div>
    );
  }
  if (loading && mode === "forward") {
    return (
      <div className="planning-panel flex h-64 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {pick(language, "예측 데이터 불러오는 중...", "Loading forecast...")}
      </div>
    );
  }
  if (notFound && mode === "forward") {
    return (
      <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
        <p className="font-medium">{pick(language, "예측 없음", "No forecast available")}</p>
        <p className="text-xs">
          {pick(language, "이 SKU는 간헐적 수요 SKU이거나 아직 예측이 실행되지 않았습니다.", "This SKU is classified as intermittent demand or has not been forecasted yet.")}
        </p>
      </div>
    );
  }
  if (error && mode === "forward") {
    const isServerDown = error.toLowerCase().includes("fetch") || error.toLowerCase().includes("reach");
    return (
      <div className="planning-panel flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
        <p className="font-medium">{pick(language, "오류", "Error")}</p>
        <p className="text-xs">{error}</p>
        {isServerDown && (
          <p className="text-xs text-muted-foreground">
            {pick(language, "예측 서버가 실행 중인지 확인하세요 (port 8000)", "Make sure the forecast server is running on port 8000")}
          </p>
        )}
      </div>
    );
  }
  if (mode === "forward" && (!displayFig || !meta)) return null;

  const isLowConfidence = meta?.confidence === "low";
  const lastSalesWeek = lastMonday(); // most recently completed weekly sales period
  const btMaxCutoff = subWeeks(lastSalesWeek, 1);

  // ── Mode toggle button classes ─────────────────────────────────────────────
  const modeBtn = (m: "forward" | "backtest") =>
    `px-3 py-1 text-xs ${mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="space-y-3">
      {mode === "forward" && isLowConfidence && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {pick(language, "낮은 신뢰도 예측입니다. 이력 데이터가 부족하거나 모델 오차가 높습니다.", "Low confidence forecast — short history or high model error. Treat with caution.")}
          </span>
        </div>
      )}

      <div className="planning-panel rounded-lg border p-4">
        {/* ── Header: mode toggle ── */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {pick(language, "수요 예측", "Demand Forecast")}
          </span>
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
                  max={meta.forward_weeks}
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
            </div>

            <Plot
              data={displayFig.data as Plotly.Data[]}
              layout={{
                ...(displayFig.layout as Partial<Plotly.Layout>),
                autosize: true,
                margin: { t: 40, r: 20, b: 60, l: 60 },
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { size: 11 },
              }}
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
                <span className="text-muted-foreground">+</span>
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
        <div className="planning-panel grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-xs sm:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted-foreground">
              {clampedWeeks}{pick(language, "주 추천 주문량", "-Week Order Range")}
            </span>
            <span className="font-medium text-foreground">{orderRange}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted-foreground">{pick(language, "예측 재고 소진일", "Forecasted stockout")}</span>
            <span className={`font-medium ${forecastedStockout ? "text-foreground" : "text-muted-foreground"}`}>
              {forecastedStockout
                ? format(forecastedStockout, "MMM d, yyyy")
                : forecastValues.length > 0
                  ? pick(language, `${forecastValues.length}주 이후`, `>${forecastValues.length}w`)
                  : "—"}
            </span>
          </div>
          <MetaField label={pick(language, "모델", "Model")} value={meta.model} />
          <MetaField
            label={pick(language, "신뢰도", "Confidence")}
            value={meta.confidence === "low" ? pick(language, "낮음", "Low") : pick(language, "표준", "Standard")}
            highlight={isLowConfidence ? "amber" : undefined}
          />
          <MetaField label={pick(language, "예측 실행일", "Forecast run")} value={meta.forecast_date} />
        </div>
      )}

      {/* ── Backtest meta strip ── */}
      {mode === "backtest" && btResult && (() => {
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
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">MAE</span>
              <span className="font-medium text-foreground">
                {btResult.mae != null ? `${btResult.mae.toLocaleString()} units` : "—"}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">WAPE</span>
              <span className="font-medium text-foreground">
                {btResult.wape != null ? `${Number(btResult.wape).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">MASE</span>
              <span className={`font-medium ${btResult.mase != null && btResult.mase < 1 ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>
                {btResult.mase != null ? btResult.mase.toFixed(2) : "—"}
              </span>
            </div>
            <MetaField
              label={pick(language, "P70 적중률", "P70 coverage")}
              value={btResult.coverage != null ? `${btResult.coverage}%` : "—"}
              tooltip={pick(
                language,
                "실제 수요가 예측 구간(70%) 내에 든 주차 비율. 잘 보정된 모델은 70% 근처여야 합니다.",
                "% of weeks where actual demand fell within the 70% prediction band. A well-calibrated model scores near 70% — higher means intervals are too wide, lower means overconfident.",
              )}
            />
            <MetaField label={pick(language, "모델", "Model")} value={btResult.model_used} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">{pick(language, "학습 주차", "Train / Eval")}</span>
              <span className="font-medium text-foreground">
                {btResult.training_weeks}w / {btResult.completed_weeks}w
              </span>
            </div>

            <div className="col-span-2 sm:col-span-6 border-t border-border/60 mt-0.5" />

            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground">{pick(language, "기간 실제 판매", "Horizon actual")}</span>
              <span className="font-medium text-foreground">
                {completedPreds.length > 0 ? `${actualTotal.toLocaleString()} units` : "—"}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
              <span className="text-muted-foreground">{pick(language, "기간 예측량", "Horizon forecast")}</span>
              <span className="font-medium text-foreground">{forecastLabel}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-3">
              <span className="text-muted-foreground">{pick(language, "차이 (실제 − 예측)", "Difference (actual − forecast)")}</span>
              {diff !== null ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium text-foreground">
                    {diff >= 0 ? "+" : ""}{diff.toLocaleString()} units
                    {diffPct !== null && <span className="ml-1 text-muted-foreground font-normal">({diff >= 0 ? "+" : ""}{diffPct}%)</span>}
                  </span>
                  {hasPi && (
                    <span className={`text-[11px] ${withinInterval ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {withinInterval
                        ? pick(language, "P70 구간 내", "within P70 interval")
                        : pick(language, "P70 구간 외", "outside P70 interval")}
                    </span>
                  )}
                </div>
              ) : <span className="font-medium text-muted-foreground">—</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function MetaField({ label, value, highlight, tooltip }: { label: string; value: string; highlight?: "amber"; tooltip?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`truncate text-left font-medium ${highlight === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
          >
            {value}
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
