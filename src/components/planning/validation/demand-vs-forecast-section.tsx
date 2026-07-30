"use client";

/**
 * Code Guide:
 * Weekly demand against what the model predicted for those weeks.
 *
 * The visual form of the comparison grid above it: the grid gives one error
 * figure per segment and window, this shows the weeks those figures are made
 * of. Ported in spirit from the old Demand Forecast page's chart, but not
 * copied, because the data underneath is a different shape.
 *
 * Two things the old chart had that this one cannot, and should not fake:
 *
 * There is no adaptive-versus-fixed lead control. On the old page many runs
 * predicted the same week at different leads, so "adaptive" meant picking the
 * freshest. Here each week appears exactly once, at the lead its position in
 * its window gives it, so there is no choice to expose.
 *
 * Nothing is drawn between the last scored week and the first forward week.
 * That span is the quarantined final test window, and a line across it would
 * spend the test to decorate a chart.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout, Shape } from "plotly.js";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { DemandVsForecastResponse } from "./types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const nf = new Intl.NumberFormat("en-US");
const COLOUR = { actual: "#4b5563", predicted: "#6366f1", forward: "#6366f1" } as const;

export function DemandVsForecastSection({
  data,
  window,
  onWindowChange,
}: {
  data: DemandVsForecastResponse;
  window: string;
  onWindowChange: (w: string) => void;
}) {
  const { pick } = useI18n();

  const traces = useMemo<Data[]>(() => {
    const x = data.weekly.map((w) => w.ds);
    const out: Data[] = [
      {
        x,
        y: data.weekly.map((w) => w.actual),
        type: "scatter", mode: "lines+markers",
        name: pick("실제 판매", "Actual"),
        line: { color: COLOUR.actual, width: 2.4 },
        marker: { size: 4 },
      },
      {
        x,
        y: data.weekly.map((w) => w.predicted),
        type: "scatter", mode: "lines+markers",
        name: pick("모델 예측", "Model predicted"),
        line: { color: COLOUR.predicted, width: 2.4 },
        marker: { size: 4 },
      },
    ];
    if (data.forward.length) {
      out.push({
        x: data.forward.map((p) => p.ds),
        y: data.forward.map((p) => p.value),
        type: "scatter", mode: "lines",
        name: pick("향후 예측", "Forward forecast"),
        line: { color: COLOUR.forward, width: 2.4, dash: "dash" },
      });
    }
    return out;
  }, [data, pick]);

  const layout = useMemo<Partial<Layout>>(() => {
    const shapes: Partial<Shape>[] = [];

    // The quarantined span, shaded rather than left as an unexplained blank.
    if (data.quarantine?.end) {
      shapes.push({
        type: "rect", xref: "x", yref: "paper",
        x0: data.quarantine.start, x1: data.quarantine.end,
        y0: 0, y1: 1,
        fillcolor: "rgba(120,120,120,0.10)",
        line: { width: 0 },
        layer: "below",
      });
    }

    // Window boundaries, because the SKU population changes at each one and
    // both lines step together there. Unmarked, that step reads as a demand
    // event rather than a change in what is being counted.
    if (data.window === "all") {
      for (const b of data.boundaries.slice(1)) {
        shapes.push({
          type: "line", xref: "x", yref: "paper",
          x0: b.start, x1: b.start, y0: 0, y1: 1,
          line: { color: "rgba(128,128,128,0.45)", width: 1, dash: "dot" },
        });
      }
    }

    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { size: 12 },
      hovermode: "x unified",
      height: 340,
      margin: { l: 58, r: 20, t: 16, b: 40 },
      legend: { orientation: "h", y: -0.18, font: { size: 11 } },
      xaxis: { showgrid: false },
      yaxis: {
        gridcolor: "rgba(128,128,128,0.22)",
        zeroline: false,
        title: { text: pick("주당 수량", "units / week") },
      },
      shapes,
      annotations: data.quarantine?.end
        ? [{
            x: data.quarantine.start, xref: "x", yref: "paper", y: 1,
            text: pick("최종 테스트 구간 (미평가)", "final test window, not evaluated"),
            showarrow: false, xanchor: "left", yanchor: "bottom",
            font: { size: 9.5, color: "#8a8a8a" },
          }]
        : [],
    };
  }, [data, pick]);

  // Aggregate error, stated so the chart cannot be read as contradicting the
  // headline. Summing SKUs before differencing lets one SKU's over-forecast
  // cancel another's under, so this is always the flattering number.
  const aggregate = useMemo(() => {
    const a = data.weekly.reduce((s, w) => s + w.actual, 0);
    const e = data.weekly.reduce((s, w) => s + Math.abs(w.predicted - w.actual), 0);
    return a > 0 ? e / a : null;
  }, [data]);

  const options = ["all", ...data.windows];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {pick("주간 실판매와 예측", "Demand against forecast")}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {pick(
              "위 표의 오차가 어떤 주들로 이루어져 있는지를 보여줍니다. 두 선은 같은 SKU 집합을 합산한 값입니다.",
              "The weeks the error figures above are made of. Both lines sum the same set of SKUs.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
          {options.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindowChange(w)}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                window === w
                  ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {w === "all" ? pick("전체", "All") : w}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border p-2">
        <Plot
          data={traces}
          layout={layout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%" }}
        />

        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-1 text-[10.5px] text-muted-foreground">
          {data.boundaries.map((b) => (
            <span key={b.window}>
              <span className="font-medium text-foreground">{b.window}</span>{" "}
              {pick(`${nf.format(b.n_skus)}개 SKU`, `${nf.format(b.n_skus)} SKUs`)}
            </span>
          ))}
        </div>

        <p className="px-1 pt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          {pick(
            `백테스트 예측입니다. 실제 운영에서 미리 낸 예측이 아니라, 각 구간의 기준일 이전 데이터로 학습해 이후를 예측한 결과입니다. 백테스트 가능한 SKU 수는 구간마다 다르므로(${data.boundaries.map((b) => b.n_skus).join(" → ")}) 두 선이 경계에서 함께 계단처럼 움직입니다. 회색 구간은 아직 평가하지 않은 최종 테스트 구간입니다.`,
            `These are backtest predictions: the model was fit on data before each window's cutoff and predicted forward. They are not forecasts that were served before the outcome was known, which is what the performance section below will show once runs accumulate. The number of backtestable SKUs differs by window (${data.boundaries.map((b) => b.n_skus).join(" → ")}), so both lines step together at the dotted boundaries. The shaded span is the final test window, deliberately unevaluated.`,
          )}
        </p>

        {aggregate !== null && (
          <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            {pick(
              `이 차트의 합산 오차는 ${(aggregate * 100).toFixed(1)}%로, 위의 SKU별 합산 오차보다 낮습니다. SKU를 먼저 더하면 과다 예측과 과소 예측이 서로 상쇄되기 때문이며, 정확도 지표는 위의 값입니다.`,
              `Aggregate error on this chart is ${(aggregate * 100).toFixed(1)}%, lower than the pooled figure above. Summing SKUs before taking the difference lets one SKU's over-forecast cancel another's under. The figure above remains the accuracy claim; this chart is the portfolio shape.`,
            )}
          </p>
        )}
      </div>
    </section>
  );
}
