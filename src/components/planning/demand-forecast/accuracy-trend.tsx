"use client";

/**
 * Code Guide:
 * Forecast accuracy over time — pooled WAPE per stored forecast run, evaluated
 * over the first K completed weeks of each run's horizon. Data comes from
 * /api/forecast/accuracy-history (all K values in one response, so switching
 * the window is instant). One run per training week.
 *
 * Rendered as a tab body inside ForecastPerformance (no Card wrapper here).
 */
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface AccuracyPoint {
  forecast_date: string;
  horizon_start: string;
  segment: "all" | "smooth_full" | "smooth_short";
  k: number;
  n_skus: number;
  demand_total: number;
  model_total: number;
  model_wape: number | null;
  n_v1: number;
  demand_total_v1: number;
  v1_total: number;
  model_wape_v1: number | null;
  v1_wape: number | null;
  coverage: number | null;
  n_band: number;
}

const K_PRESETS = [1, 2, 4, 8, 10, 13];

export const TREND_SEGMENT_OPTIONS = [
  { value: "all" as const,          ko: "전체",        en: "All smooth" },
  { value: "smooth_full" as const,  ko: "Smooth",      en: "Smooth" },
  { value: "smooth_short" as const, ko: "짧은 이력",   en: "Short history" },
];

export type TrendSegment = "all" | "smooth_full" | "smooth_short";

export const trendPillClass = (active: boolean, disabled = false) =>
  `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
    disabled
      ? "cursor-not-allowed bg-muted/40 text-muted-foreground/40"
      : active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/80"
  }`;

export function AccuracyTrendContent({ refreshKey }: { refreshKey: number }) {
  const { pick } = useI18n();
  const [series, setSeries] = useState<AccuracyPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<TrendSegment>("all");
  const [k, setK] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Wait for the forecast server (started by the layout) to be ready,
        // same pattern as SegmentationOverview.
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

        const res = await fetch(apiPath("/api/forecast/accuracy-history"), { signal: AbortSignal.timeout(30_000) });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Server error ${res.status}`);
        if (!cancelled) setSeries((json as { series: AccuracyPoint[] }).series);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [refreshKey, retryCount]);

  // Runs available at each K (counted on the "all" segment)
  const runsPerK = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of series ?? []) {
      if (p.segment === "all") counts.set(p.k, (counts.get(p.k) ?? 0) + 1);
    }
    return counts;
  }, [series]);

  // Default K: largest preset with at least 2 runs, else largest with any data
  const effectiveK = useMemo(() => {
    if (k !== null && (runsPerK.get(k) ?? 0) > 0) return k;
    const withTwo = K_PRESETS.filter((p) => (runsPerK.get(p) ?? 0) >= 2);
    if (withTwo.length > 0) return withTwo[withTwo.length - 1];
    const withOne = K_PRESETS.filter((p) => (runsPerK.get(p) ?? 0) >= 1);
    return withOne.length > 0 ? withOne[withOne.length - 1] : null;
  }, [k, runsPerK]);

  const points = useMemo(
    () => (series ?? []).filter((p) => p.segment === segment && p.k === effectiveK),
    [series, segment, effectiveK],
  );

  const fig = useMemo(() => {
    if (points.length === 0) return null;
    const x = points.map((p) => p.horizon_start);
    const traces: Plotly.Data[] = [
      {
        type: "scatter",
        x,
        y: points.map((p) => (p.model_wape != null ? p.model_wape * 100 : null)),
        mode: "lines+markers",
        name: pick("모델 WAPE", "Model WAPE"),
        line: { color: "#4C72B0", width: 2 },
        marker: { size: 7 },
        customdata: points.map((p) => [p.n_skus, p.demand_total, p.model_total]),
        hovertemplate:
          "Model WAPE: %{y:.1f}%<br>Model forecast: %{customdata[2]:,}<br>" +
          "Actual demand: %{customdata[1]:,}<br>SKUs: %{customdata[0]}<extra></extra>",
      } as Plotly.Data,
    ];
    if (points.some((p) => p.v1_wape != null)) {
      traces.push({
        type: "scatter",
        x,
        y: points.map((p) => (p.v1_wape != null ? p.v1_wape * 100 : null)),
        mode: "lines+markers",
        name: "V1 WAPE",
        line: { color: "#DD8452", width: 2, dash: "dash" },
        marker: { size: 7 },
        customdata: points.map((p) => [p.v1_total]),
        hovertemplate: "V1 WAPE: %{y:.1f}%<br>V1 forecast: %{customdata[0]:,}<extra></extra>",
      } as Plotly.Data);
    }
    return {
      data: traces,
      layout: {
        autosize: true,
        height: 680,
        margin: { t: 30, r: 20, b: 50, l: 50 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { size: 11 },
        xaxis: { showgrid: true, gridcolor: "#F0F0F0", title: { text: pick("예측 시작 주", "Forecast start week") } },
        yaxis: { showgrid: true, gridcolor: "#F0F0F0", range: [0, 100], ticksuffix: "%", dtick: 10 },
        legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
        hovermode: "x unified",
      } as Partial<Plotly.Layout>,
    };
  }, [points, pick]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {TREND_SEGMENT_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setSegment(opt.value)} className={trendPillClass(segment === opt.value)}>
              {pick(opt.ko, opt.en)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{pick("평가 기간", "Window")}</span>
          {K_PRESETS.map((preset) => {
            const available = (runsPerK.get(preset) ?? 0) > 0;
            return (
              <button
                key={preset}
                onClick={() => available && setK(preset)}
                disabled={!available}
                className={trendPillClass(effectiveK === preset, !available)}
              >
                {preset}{pick("주", "w")}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground/70">
        {pick(
          `각 지점은 해당 예측 실행의 첫 ${effectiveK ?? "K"}주(완료된 주 기준)에 대한 통합 WAPE입니다. 낮을수록 정확합니다.`,
          `Each point is the pooled WAPE over the first ${effectiveK ?? "K"} completed week${effectiveK === 1 ? "" : "s"} of that run's horizon. Lower is better.`,
        )}
      </p>
      <div className="mt-2">
        {loading && (
          <div className="flex h-[680px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {pick("정확도 이력 불러오는 중...", "Loading accuracy history...")}
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[680px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>{pick("정확도 이력을 불러올 수 없습니다:", "Could not load accuracy history:")} {error}</p>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="rounded border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              {pick("다시 시도", "Retry")}
            </button>
          </div>
        )}
        {!loading && !error && !fig && (
          <div className="flex h-[680px] flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <p>{pick("아직 평가 가능한 예측 실행이 없습니다.", "No forecast runs with completed weeks yet.")}</p>
            <p className="text-xs">{pick("예측 첫 주가 완료되면 자동으로 표시됩니다.", "Points appear automatically once a run's first forecast week completes.")}</p>
          </div>
        )}
        {!loading && !error && fig && (
          <div className="h-[680px] overflow-hidden">
            <Plot
              data={fig.data}
              layout={fig.layout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "680px" }}
              useResizeHandler
            />
          </div>
        )}
      </div>
    </>
  );
}
