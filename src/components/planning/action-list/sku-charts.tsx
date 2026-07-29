"use client";

/**
 * Code Guide:
 * The two per-SKU charts: weekly demand against the forward forecast, and the
 * backtest windows the model was scored on.
 *
 * Plotly is imported dynamically with ssr:false, matching demand-trend.tsx —
 * it touches the DOM at module scope and breaks server rendering otherwise.
 * `hovermode: "x unified"` is the same choice made there and matters more here:
 * a tooltip attached to a line only fires within a couple of pixels of the
 * stroke, which in practice means it never fires. Unified hover reports every
 * series at the nearest week regardless of where the pointer sits vertically.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout, Shape } from "plotly.js";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { BacktestWeek, BacktestWindow, ForecastWeek, HistoryWeek } from "./types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const COLOUR = {
  actual: "#8b8b8b",
  forecast: "#7c7fe0",
  v1: "#3fb5a8",
  /** Only drawn where demand is falling, where this flat line is the figure the
   *  model was measured against and lost to. */
  wa4: "#d99a3c",
  band: "rgba(124,127,224,0.13)",
  rule: "#9a9a9a",
} as const;

const BASE_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { size: 11 },
  hovermode: "x unified",
  margin: { l: 44, r: 16, t: 10, b: 34 },
  showlegend: true,
  legend: { orientation: "h", y: -0.18, font: { size: 10 } },
  xaxis: { showgrid: false },
  yaxis: { gridcolor: "rgba(128,128,128,0.15)", zeroline: false },
};

const CONFIG = { responsive: true, displayModeBar: false } as const;

export function DemandChart({
  history,
  forecast,
  wa4,
  showWa4,
  height = 300,
}: {
  history: HistoryWeek[];
  forecast: ForecastWeek[];
  wa4: number | null;
  showWa4: boolean;
  height?: number;
}) {
  const { pick } = useI18n();

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [
      {
        x: history.map((h) => h.ds),
        y: history.map((h) => h.y),
        type: "scatter",
        mode: "lines",
        name: pick("실제 판매", "Actual sales"),
        line: { color: COLOUR.actual, width: 1.8 },
      },
    ];
    if (forecast.length) {
      // Bridge from the last actual so the forecast leaves the demand curve
      // rather than starting in mid-air beside it. The anchor is an
      // observation, not a prediction, and is added to the line only.
      const bridge = history.length ? [history[history.length - 1]] : [];
      out.push({
        x: [...bridge.map((h) => h.ds), ...forecast.map((f) => f.ds)],
        y: [...bridge.map((h) => h.y), ...forecast.map((f) => f.yhat)],
        type: "scatter",
        mode: "lines",
        name: pick("모델 예측", "Model forecast"),
        line: { color: COLOUR.forecast, width: 1.8, dash: "dash" },
      });
      const hasV1 = forecast.some((f) => f.v1_yhat !== null);
      if (hasV1) {
        out.push({
          x: [...bridge.map((h) => h.ds), ...forecast.map((f) => f.ds)],
          y: [...bridge.map((h) => h.y), ...forecast.map((f) => f.v1_yhat)],
          type: "scatter",
          mode: "lines",
          name: pick("스프레드시트 (V1)", "Spreadsheet (V1)"),
          line: { color: COLOUR.v1, width: 1.5, dash: "dot" },
        });
      }
      if (showWa4 && wa4 !== null) {
        out.push({
          x: forecast.map((f) => f.ds),
          y: forecast.map(() => wa4),
          type: "scatter",
          mode: "lines",
          name: pick("최근 4주 평균", "Recent average (4wk)"),
          line: { color: COLOUR.wa4, width: 1.5, dash: "dashdot" },
        });
      }
    }
    return out;
  }, [history, forecast, wa4, showWa4, pick]);

  const layout = useMemo<Partial<Layout>>(() => {
    const boundary = history.length ? history[history.length - 1].ds : null;
    return {
      ...BASE_LAYOUT,
      height,
      yaxis: { ...BASE_LAYOUT.yaxis, title: { text: pick("주당 수량", "units / week") } },
      shapes: boundary
        ? [{
            type: "line", x0: boundary, x1: boundary, yref: "paper", y0: 0, y1: 1,
            line: { color: COLOUR.rule, width: 1.5, dash: "dot" },
          } as Partial<Shape>]
        : [],
    };
  }, [history, height, pick]);

  return <Plot data={traces} layout={layout} config={CONFIG} style={{ width: "100%" }} />;
}

export function BacktestChart({
  history,
  windows,
  weekly,
  height = 320,
}: {
  history: HistoryWeek[];
  windows: BacktestWindow[];
  weekly: BacktestWeek[];
  height?: number;
}) {
  const { pick } = useI18n();
  const BACKTEST_WEEKS = 10;

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [
      {
        x: history.map((h) => h.ds),
        y: history.map((h) => h.y),
        type: "scatter",
        mode: "lines",
        name: pick("실제 판매", "Actual sales"),
        line: { color: COLOUR.actual, width: 1.8 },
      },
    ];
    // One trace per window, so nothing is joined across the gaps between them.
    // Each is anchored to the actual value at its own cutoff, the last week the
    // model saw; the markers use the unbridged points so every dot is a real
    // forecast.
    const byWindow = new Map<string, BacktestWeek[]>();
    for (const w of weekly) {
      const list = byWindow.get(w.window) ?? [];
      list.push(w);
      byWindow.set(w.window, list);
    }
    const actualAt = new Map(history.map((h) => [h.ds, h.y]));
    let first = true;
    for (const [name, rows] of byWindow) {
      const sorted = [...rows].sort((a, b) => a.lead - b.lead);
      const cutoff = sorted[0]?.cutoff;
      const anchor = cutoff && actualAt.has(cutoff) ? [{ ds: cutoff, y: actualAt.get(cutoff) as number }] : [];
      out.push({
        x: [...anchor.map((a) => a.ds), ...sorted.map((r) => r.ds)],
        y: [...anchor.map((a) => a.y), ...sorted.map((r) => r.yhat)],
        type: "scatter",
        mode: "lines+markers",
        name: pick("예측", "Predicted"),
        legendgroup: "pred",
        showlegend: first,
        line: { color: COLOUR.forecast, width: 1.8, dash: "dash" },
        marker: { color: COLOUR.forecast, size: 5 },
        hovertemplate: `${name}: %{y:.1f}<extra></extra>`,
      });
      first = false;
    }
    return out;
  }, [history, weekly, pick]);

  const layout = useMemo<Partial<Layout>>(() => {
    const shapes: Partial<Shape>[] = [];
    for (const w of windows) {
      const start = new Date(w.cutoff);
      const end = new Date(start);
      end.setDate(end.getDate() + BACKTEST_WEEKS * 7);
      shapes.push({
        type: "rect", xref: "x", yref: "paper",
        x0: w.cutoff, x1: end.toISOString().slice(0, 10), y0: 0, y1: 1,
        fillcolor: COLOUR.band, line: { width: 0 }, layer: "below",
      });
      shapes.push({
        type: "line", xref: "x", yref: "paper",
        x0: w.cutoff, x1: w.cutoff, y0: 0, y1: 1,
        line: { color: COLOUR.rule, width: 1, dash: "dash" },
      });
    }
    return {
      ...BASE_LAYOUT,
      height,
      yaxis: { ...BASE_LAYOUT.yaxis, title: { text: pick("주당 수량", "units / week") } },
      shapes,
    };
  }, [windows, height, pick]);

  return <Plot data={traces} layout={layout} config={CONFIG} style={{ width: "100%" }} />;
}
