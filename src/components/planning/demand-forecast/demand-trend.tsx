"use client";

/**
 * Code Guide:
 * Demand vs forecast trajectory — actual weekly demand overlaid with what the
 * stored runs predicted for those weeks (at a selectable lead time), continuing
 * past today with the latest run's forward horizon and P85 band.
 * Data comes from /api/forecast/demand-trend.
 *
 * Rendered as a tab body inside ForecastPerformance (no Card wrapper here).
 */
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { TREND_SEGMENT_OPTIONS, trendPillClass, type TrendSegment } from "./accuracy-trend";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface ActualPoint   { week: string; segment: TrendSegment; y: number }
interface PredictedPoint { week: string; lead: number; segment: TrendSegment; yhat: number; v1: number | null; run_date: string }
interface ForwardPoint  { week: string; segment: TrendSegment; yhat: number; lo: number; hi: number; v1: number | null }

interface DemandTrendData {
  last_complete_week: string;
  forward_run_date: string | null;
  actuals: ActualPoint[];
  predicted: PredictedPoint[];
  forward: ForwardPoint[];
}

const LEAD_PRESETS = [1, 2, 4, 8, 13];

type LeadChoice = number | "adaptive";

export function DemandTrendContent({ refreshKey }: { refreshKey: number }) {
  const { pick } = useI18n();
  const [data, setData] = useState<DemandTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<TrendSegment>("all");
  const [lead, setLead] = useState<LeadChoice>("adaptive");
  const [showV1, setShowV1] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

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

        const res = await fetch(apiPath("/api/forecast/demand-trend"), { signal: AbortSignal.timeout(30_000) });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Server error ${res.status}`);
        if (!cancelled) setData(json as DemandTrendData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [refreshKey, retryCount]);

  // Leads that actually have past predictions (counted on the "all" segment)
  const availableLeads = useMemo(() => {
    const s = new Set<number>();
    for (const p of data?.predicted ?? []) {
      if (p.segment === "all") s.add(p.lead);
    }
    return s;
  }, [data]);

  const effectiveLead: LeadChoice = useMemo(() => {
    if (lead === "adaptive") return "adaptive";
    return availableLeads.has(lead) ? lead : "adaptive";
  }, [lead, availableLeads]);

  const fig = useMemo(() => {
    if (!data) return null;
    const actuals = data.actuals.filter((a) => a.segment === segment);
    const forward = data.forward.filter((f) => f.segment === segment);
    if (actuals.length === 0 && forward.length === 0) return null;

    const actualByWeek = new Map(actuals.map((a) => [a.week, a.y]));
    const predictedAll = data.predicted.filter((p) => p.segment === segment);
    let predicted: PredictedPoint[];
    if (effectiveLead === "adaptive") {
      // Most recent forecast made for each week = the lowest lead available
      const byWeek = new Map<string, PredictedPoint>();
      for (const p of predictedAll) {
        const cur = byWeek.get(p.week);
        if (!cur || p.lead < cur.lead) byWeek.set(p.week, p);
      }
      predicted = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
    } else {
      predicted = predictedAll
        .filter((p) => p.lead === effectiveLead)
        .sort((a, b) => a.week.localeCompare(b.week));
    }

    const traces: Plotly.Data[] = [];

    // ── P85 band around the forward horizon ──
    if (forward.length > 0) {
      traces.push({
        type: "scatter",
        x: [...forward.map((f) => f.week), ...[...forward].reverse().map((f) => f.week)],
        y: [...forward.map((f) => f.hi), ...[...forward].reverse().map((f) => f.lo)],
        fill: "toself",
        fillcolor: "rgba(221,132,82,0.15)",
        line: { color: "rgba(0,0,0,0)" },
        name: pick("P85 구간", "P85 interval"),
        showlegend: true,
        hoverinfo: "skip",
      } as Plotly.Data);
    }

    // ── Past predictions at the selected lead ──
    if (predicted.length > 0) {
      traces.push({
        type: "scatter",
        x: predicted.map((p) => p.week),
        y: predicted.map((p) => p.yhat),
        mode: "lines+markers",
        name: effectiveLead === "adaptive"
          ? pick("예측 (주별 최신 예측)", "Predicted (most recent run)")
          : pick(`예측 (${effectiveLead}주 전 기준)`, `Predicted (${effectiveLead}w ahead)`),
        line: { color: "#DD8452", width: 2, dash: "dash" },
        marker: { size: 7 },
        customdata: predicted.map((p) => {
          const actual = actualByWeek.get(p.week);
          const diffPct = actual != null && actual > 0 ? ((p.yhat - actual) / actual) * 100 : null;
          return [diffPct != null ? `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(0)}%` : "—", p.run_date, p.lead];
        }),
        hovertemplate: "Forecast: %{y:,}<br>vs actual: %{customdata[0]}<br>Forecasted on: %{customdata[1]} (%{customdata[2]}w ahead)<extra></extra>",
      } as Plotly.Data);
    }

    // ── Latest run's forward horizon (connected to the last actual point) ──
    if (forward.length > 0) {
      const lastActual = actuals[actuals.length - 1];
      const fx = lastActual ? [lastActual.week, ...forward.map((f) => f.week)] : forward.map((f) => f.week);
      const fy = lastActual ? [lastActual.y, ...forward.map((f) => f.yhat)] : forward.map((f) => f.yhat);
      traces.push({
        type: "scatter",
        x: fx,
        y: fy,
        mode: "lines+markers",
        name: pick("예측 (최신 실행)", "Forecast (latest run)"),
        line: { color: "#DD8452", width: 2 },
        marker: { size: 5 },
        hovertemplate: "Forecast: %{y:,}<extra></extra>",
      } as Plotly.Data);
    }

    // ── V1 reference (past predictions + latest run's forward, one visual line) ──
    if (showV1) {
      if (predicted.some((p) => p.v1 != null)) {
        traces.push({
          type: "scatter",
          x: predicted.map((p) => p.week),
          y: predicted.map((p) => p.v1),
          mode: "lines+markers",
          name: effectiveLead === "adaptive"
            ? pick("V1 (주별 최신 예측)", "V1 (most recent run)")
            : pick(`V1 (${effectiveLead}주 전 기준)`, `V1 (${effectiveLead}w ahead)`),
          line: { color: "#8172B2", width: 2, dash: "dot" },
          marker: { size: 6 },
          customdata: predicted.map((p) => [p.run_date]),
          hovertemplate: "V1: %{y:,}<br>Forecasted on: %{customdata[0]}<extra></extra>",
        } as Plotly.Data);
      }
      if (forward.some((f) => f.v1 != null)) {
        traces.push({
          type: "scatter",
          x: forward.map((f) => f.week),
          y: forward.map((f) => f.v1),
          mode: "lines+markers",
          name: pick("V1 (최신 실행)", "V1 (latest run)"),
          line: { color: "#8172B2", width: 2, dash: "dot" },
          marker: { size: 4 },
          hovertemplate: "V1: %{y:,}<extra></extra>",
        } as Plotly.Data);
      }
    }

    // ── Actual demand ──
    traces.push({
      type: "scatter",
      x: actuals.map((a) => a.week),
      y: actuals.map((a) => a.y),
      mode: "lines+markers",
      name: pick("실제 수요", "Actual demand"),
      line: { color: "#4C72B0", width: 2 },
      marker: { size: 5 },
      hovertemplate: "Actual: %{y:,}<extra></extra>",
    } as Plotly.Data);

    return {
      data: traces,
      layout: {
        autosize: true,
        height: 680,
        margin: { t: 30, r: 20, b: 50, l: 50 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { size: 11 },
        xaxis: { showgrid: true, gridcolor: "#F0F0F0" },
        yaxis: { showgrid: true, gridcolor: "#F0F0F0", rangemode: "tozero", title: { text: pick("주간 판매량", "Units per week") } },
        legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
        hovermode: "x unified",
        shapes: [{
          type: "line",
          x0: data.last_complete_week, x1: data.last_complete_week,
          y0: 0, y1: 1, yref: "paper",
          line: { color: "#AAAAAA", width: 1, dash: "dot" },
        }],
        annotations: [{
          x: data.last_complete_week, y: 1, yref: "paper",
          text: pick("마지막 완료 주", "Last complete week"),
          showarrow: false, xanchor: "left", xshift: 5, yanchor: "top",
          font: { color: "#AAAAAA", size: 10 },
        }],
      } as Partial<Plotly.Layout>,
    };
  }, [data, segment, effectiveLead, showV1, pick]);

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
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{pick("예측 시점", "Predicted")}</span>
            <button
              onClick={() => setLead("adaptive")}
              className={trendPillClass(effectiveLead === "adaptive")}
            >
              {pick("자동", "Adaptive")}
            </button>
            {LEAD_PRESETS.map((preset) => {
              const available = availableLeads.has(preset);
              return (
                <button
                  key={preset}
                  onClick={() => available && setLead(preset)}
                  disabled={!available}
                  className={trendPillClass(effectiveLead === preset, !available)}
                >
                  {preset}{pick("주 전", "w ahead")}
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowV1((v) => !v)} className={trendPillClass(showV1)}>
            V1
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground/70">
        {effectiveLead === "adaptive"
          ? pick(
              `실선은 주간 실제 수요, 점선은 각 주에 대해 가장 최근에 실행된 예측값입니다. 마지막 완료 주 이후는 최신 실행의 향후 예측과 P85 구간입니다${data?.forward_run_date ? ` (실행일: ${data.forward_run_date})` : ""}.`,
              `Solid line = actual weekly demand. Dashed points = the most recent forecast made for each week. Beyond the marker, the latest run's forward forecast with its P85 band${data?.forward_run_date ? ` (run ${data.forward_run_date})` : ""}.`,
            )
          : pick(
              `실선은 주간 실제 수요, 점선은 각 주에 대해 ${effectiveLead}주 전에 예측한 값입니다. 마지막 완료 주 이후는 최신 실행의 향후 예측과 P85 구간입니다${data?.forward_run_date ? ` (실행일: ${data.forward_run_date})` : ""}.`,
              `Solid line = actual weekly demand. Dashed points = what the forecast said each week would be, ${effectiveLead} week${effectiveLead === 1 ? "" : "s"} in advance. Beyond the marker, the latest run's forward forecast with its P85 band${data?.forward_run_date ? ` (run ${data.forward_run_date})` : ""}.`,
            )}
      </p>
      <div className="mt-2">
        {loading && (
          <div className="flex h-[680px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {pick("수요 추이 불러오는 중...", "Loading demand trend...")}
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[680px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>{pick("수요 추이를 불러올 수 없습니다:", "Could not load demand trend:")} {error}</p>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="rounded border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              {pick("다시 시도", "Retry")}
            </button>
          </div>
        )}
        {!loading && !error && !fig && (
          <div className="flex h-[680px] items-center justify-center text-sm text-muted-foreground">
            {pick("표시할 예측 데이터가 없습니다.", "No forecast data to display yet.")}
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
