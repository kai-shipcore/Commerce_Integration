"use client";

/**
 * Code Guide:
 * Demand vs forecast trajectory — actual weekly demand overlaid with what the
 * stored runs predicted for those weeks at a selectable lead, continuing past
 * the last complete week with the latest run's forward horizon.
 *
 * The ML counterpart of the old Demand Forecast page's chart, reading the same
 * kind of source: forecasts served before the outcome was known, scored as
 * their weeks complete. Not the backtest windows, which are a different claim
 * already answered by the grid above.
 *
 * Two differences from the original, both forced by the data:
 *
 * No P85 band. That chart drew the conformal interval around both the past
 * predictions and the forward horizon and used it as a calibration check: the
 * actual line leaving the band meant the interval missed. The LightGBM track
 * emits a point forecast and nothing else, so there is no band to draw. The
 * chart says so rather than leaving a reader to wonder where it went.
 *
 * V1 on the forward horizon only. The V1 baseline is recomputed per run into
 * v1_forward_forecasts; the accumulating history store keeps the model's own
 * predictions. The comparison over past weeks is the grid above.
 *
 * Empty until runs accumulate. The store gains one entry per weekly run, so
 * early on there is demand and a forward curve and no predicted line. That is
 * the honest state, and the chart says which it is rather than looking broken.
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout, Shape } from "plotly.js";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { SectionHeading } from "./section-heading";
import type { DemandVsForecastResponse } from "./types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// The old chart's presets, so the two read the same. A preset with no scored
// weeks is shown disabled rather than hidden: "nothing is settled 13 weeks out
// yet" is information, and a control that silently disappears is not.
const LEAD_PRESETS = [1, 2, 4, 8, 13];

// Seaborn deep, as the old chart used: blue actual, orange forecast, purple V1.
const COLOUR = { actual: "#4C72B0", forecast: "#DD8452", v1: "#8172B2" } as const;

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

type LeadChoice = number | "adaptive";

const pillClass = (active: boolean, disabled = false) =>
  `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
    disabled
      ? "cursor-not-allowed bg-muted/40 text-muted-foreground/40"
      : active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/80"
  }`;

export function DemandVsForecastSection({ data }: { data: DemandVsForecastResponse }) {
  const { pick } = useI18n();
  const [segment, setSegment] = useState<string>("all");
  const [lead, setLead] = useState<LeadChoice>("adaptive");
  const [showV1, setShowV1] = useState(false);

  const availableLeads = useMemo(
    () => new Set(data.leads ?? []),
    [data.leads],
  );

  const effectiveLead: LeadChoice = useMemo(
    () => (lead === "adaptive" || availableLeads.has(lead) ? lead : "adaptive"),
    [lead, availableLeads],
  );

  const view = useMemo(() => {
    const actuals = data.actuals.filter((a) => a.segment === segment);
    const forward = data.forward.filter((f) => f.segment === segment);
    const actualByWeek = new Map(actuals.map((a) => [a.ds, a.y]));
    const all = data.predicted.filter((p) => p.segment === segment);
    let predicted;
    if (effectiveLead === "adaptive") {
      // The most recent forecast made for each week is the one with the
      // smallest lead, because a run N weeks before the target week produces
      // lead N. Every run that covered the week is present, so this is a real
      // choice rather than a formality.
      const byWeek = new Map<string, typeof all[number]>();
      for (const p of all) {
        const cur = byWeek.get(p.ds);
        if (!cur || p.lead < cur.lead) byWeek.set(p.ds, p);
      }
      predicted = [...byWeek.values()].sort((a, b) => a.ds.localeCompare(b.ds));
    } else {
      predicted = all.filter((p) => p.lead === effectiveLead)
        .sort((a, b) => a.ds.localeCompare(b.ds));
    }
    return { actuals, forward, actualByWeek, predicted };
  }, [data, segment, effectiveLead]);

  const stats = useMemo(() => {
    const withActual = view.predicted.filter((p) => view.actualByWeek.has(p.ds));
    if (withActual.length === 0 && view.forward.length === 0) return null;
    const last = withActual[withActual.length - 1] ?? null;
    const lastActual = last ? view.actualByWeek.get(last.ds)! : null;
    const sumF = withActual.reduce((s, p) => s + p.yhat, 0);
    const sumA = withActual.reduce((s, p) => s + view.actualByWeek.get(p.ds)!, 0);
    return {
      last,
      lastActual,
      lastDiffPct: last && lastActual ? ((last.yhat - lastActual) / lastActual) * 100 : null,
      nWeeks: withActual.length,
      biasPct: sumA > 0 ? ((sumF - sumA) / sumA) * 100 : null,
      // Aggregate, not pooled. Stated here and explained below, because summing
      // SKUs before differencing lets overs cancel unders and this is always
      // the flattering number.
      wape: sumA > 0 ? withActual.reduce(
        (s, p) => s + Math.abs(p.yhat - view.actualByWeek.get(p.ds)!), 0) / sumA : null,
      fwdWeeks: view.forward.length,
      fwdTotal: view.forward.reduce((s, f) => s + f.yhat, 0),
    };
  }, [view]);

  const fig = useMemo(() => {
    const { actuals, forward, actualByWeek, predicted } = view;
    if (actuals.length === 0 && forward.length === 0) return null;

    const traces: Data[] = [];

    // Bridge from the last scored week to the first forward week, so the
    // prediction series reads as one continuous line across the marker rather
    // than two detached fragments. Dotted and unlabelled: it is a connector,
    // not a prediction for the weeks it spans.
    const lastPred = predicted[predicted.length - 1];
    const firstFwd = forward[0];
    if (lastPred && firstFwd && lastPred.ds < firstFwd.ds) {
      traces.push({
        type: "scatter",
        x: [lastPred.ds, firstFwd.ds],
        y: [lastPred.yhat, firstFwd.yhat],
        mode: "lines",
        line: { color: COLOUR.forecast, width: 2, dash: "dot" },
        showlegend: false,
        hoverinfo: "skip",
      } as Data);
    }

    if (predicted.length > 0) {
      traces.push({
        type: "scatter",
        x: predicted.map((p) => p.ds),
        y: predicted.map((p) => p.yhat),
        mode: "lines+markers",
        name:
          effectiveLead === "adaptive"
            ? pick("예측 (주별 최신 예측)", "Predicted (most recent run)")
            : pick(`예측 (${effectiveLead}주 전 기준)`, `Predicted (${effectiveLead}w ahead)`),
        line: { color: COLOUR.forecast, width: 2, dash: "dash" },
        marker: { size: 7 },
        customdata: predicted.map((p) => {
          const actual = actualByWeek.get(p.ds);
          const diff = actual != null && actual > 0 ? ((p.yhat - actual) / actual) * 100 : null;
          return [
            diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%` : "—",
            String(p.week_of ?? "").slice(0, 10),
            p.lead,
            fmtInt(p.n_skus),
          ];
        }),
        hovertemplate:
          "Forecast: %{y:,.0f}<br>vs actual: %{customdata[0]}<br>" +
          "Forecast on: %{customdata[1]} (%{customdata[2]}w ahead)<br>" +
          "SKUs: %{customdata[3]}<extra></extra>",
      } as Data);
    }

    if (forward.length > 0) {
      // Anchored to the last actual so the horizon continues the demand line
      // rather than floating away from it. The anchor is a separate trace with
      // hoverinfo suppressed: without this, unified hover at the anchor week
      // shows "Forecast: <actual value>" because the point carries the actual's
      // y, not a prediction. That is the tooltip bug of 2026-08-14.
      const lastActual = actuals[actuals.length - 1];
      if (lastActual) {
        traces.push({
          type: "scatter",
          x: [lastActual.ds, forward[0].ds],
          y: [lastActual.y, forward[0].yhat],
          mode: "lines",
          line: { color: COLOUR.forecast, width: 2 },
          showlegend: false,
          hoverinfo: "skip",
        } as Data);
      }
      traces.push({
        type: "scatter",
        x: forward.map((f) => f.ds),
        y: forward.map((f) => f.yhat),
        mode: "lines+markers",
        name: pick("예측 (최신 실행)", "Forecast (latest run)"),
        line: { color: COLOUR.forecast, width: 2 },
        marker: { size: 5 },
        hovertemplate: "Forecast: %{y:,.0f}<extra></extra>",
      } as Data);
    }

    if (showV1 && forward.some((f) => f.v1 != null)) {
      traces.push({
        type: "scatter",
        x: forward.map((f) => f.ds),
        y: forward.map((f) => f.v1),
        mode: "lines+markers",
        name: pick("V1 (최신 실행)", "V1 (latest run)"),
        line: { color: COLOUR.v1, width: 2, dash: "dot" },
        marker: { size: 4 },
        hovertemplate: "V1: %{y:,.0f}<extra></extra>",
      } as Data);
    }

    traces.push({
      type: "scatter",
      x: actuals.map((a) => a.ds),
      y: actuals.map((a) => a.y),
      mode: "lines+markers",
      name: pick("실제 수요", "Actual demand"),
      line: { color: COLOUR.actual, width: 2 },
      marker: { size: 5 },
      hovertemplate: "Actual: %{y:,.0f}<extra></extra>",
    } as Data);

    const shapes: Partial<Shape>[] = [];
    if (data.last_complete_week) {
      shapes.push({
        type: "line",
        x0: data.last_complete_week, x1: data.last_complete_week,
        y0: 0, y1: 1, yref: "paper",
        line: { color: "#AAAAAA", width: 1, dash: "dot" },
      });
    }

    const layout: Partial<Layout> = {
      autosize: true,
      height: 680,
      margin: { t: 30, r: 20, b: 50, l: 50 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { size: 11 },
      xaxis: { showgrid: true, gridcolor: "#F0F0F0" },
      yaxis: {
        showgrid: true, gridcolor: "#F0F0F0", rangemode: "tozero",
        title: { text: pick("주간 판매량", "Units per week") },
      },
      legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
      hovermode: "x unified",
      shapes,
      annotations: data.last_complete_week
        ? [{
            x: data.last_complete_week, y: 1, yref: "paper",
            text: pick("마지막 완료 주", "Last complete week"),
            showarrow: false, xanchor: "left", xshift: 5, yanchor: "top",
            font: { color: "#AAAAAA", size: 10 },
          }]
        : [],
    };
    return { data: traces, layout };
  }, [view, data, effectiveLead, showV1, pick]);

  const segmentOptions = ["all", ...data.segments];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        id="trajectory"
        title={pick("주간 실판매와 예측", "Demand vs forecast")}
        description={pick(
          "위 표와 같은 증거를 그림으로 본 것입니다. 실제 주간 판매량 위에, 저장된 각 예측이 그 주에 대해 무엇을 예측했는지를 겹쳐 그립니다. 표는 오차를 하나의 숫자로 줄이지만, 여기서는 그 오차가 어느 시기에 어느 방향으로 발생했는지가 보입니다.",
          "The same evidence as the table above, drawn. Actual weekly units with what each stored forecast said about those weeks laid over the top. The table reduces the error to one number; this shows when it happened and in which direction, which is the part a single figure cannot carry.",
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {segmentOptions.map((s) => (
            <button key={s} onClick={() => setSegment(s)} className={pillClass(segment === s)}>
              {s === "all" ? pick("전체", "All") : s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{pick("예측 시점", "Predicted")}</span>
            <button
              onClick={() => setLead("adaptive")}
              className={pillClass(effectiveLead === "adaptive")}
            >
              {pick("전체", "All weeks")}
            </button>
            {LEAD_PRESETS.map((preset) => {
              const available = availableLeads.has(preset);
              return (
                <button
                  key={preset}
                  onClick={() => available && setLead(preset)}
                  disabled={!available}
                  title={available ? undefined : pick("이 리드에는 채점된 주가 없습니다", "No scored weeks at this lead")}
                  className={pillClass(effectiveLead === preset, !available)}
                >
                  {preset}{pick("주 전", "w ahead")}
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowV1((v) => !v)} className={pillClass(showV1)}>
            V1
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground/70">
        {effectiveLead === "adaptive"
          ? pick(
              `실선은 주간 실제 수요, 점선은 각 주에 대해 가장 최근에 실행된 예측값입니다. 마지막 완료 주 이후는 최신 실행의 향후 예측입니다${data.forward_run_date ? ` (실행일: ${data.forward_run_date})` : ""}.`,
              `Solid line = actual weekly demand. Dashed points = the most recent forecast made for each week. Beyond the marker, the latest run's forward forecast${data.forward_run_date ? ` (run ${data.forward_run_date})` : ""}.`,
            )
          : pick(
              `각 주에 대해 정확히 ${effectiveLead}주 전에 예측한 값만 표시합니다. 모델이 얼마나 앞을 내다볼 수 있는지를 보는 방식입니다.`,
              `Only weeks that were predicted exactly ${effectiveLead} week${effectiveLead === 1 ? "" : "s"} in advance, which is how far ahead the model can be trusted to see.`,
            )}
      </p>

      {stats && (
        <div className="mb-1 flex flex-wrap items-baseline gap-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs [&>span]:flex-1 [&>span]:border-l [&>span]:border-border [&>span]:px-4 [&>span:first-child]:border-l-0 [&>span:first-child]:pl-0">
          {stats.last && stats.lastActual != null && (
            <span>
              <span className="text-muted-foreground">{pick("지난주:", "Last week:")} </span>
              <span className="font-medium tabular-nums">
                {fmtInt(stats.lastActual)} {pick("실제", "actual")} · {fmtInt(stats.last.yhat)} {pick("예측", "forecast")}
              </span>
              {stats.lastDiffPct != null && (
                <span className={`ml-1 tabular-nums ${Math.abs(stats.lastDiffPct) <= 10 ? "text-emerald-600" : "text-amber-600"}`}>
                  ({stats.lastDiffPct >= 0 ? "+" : ""}{stats.lastDiffPct.toFixed(0)}%)
                </span>
              )}
            </span>
          )}
          {stats.nWeeks > 0 && (
            <span>
              <span className="text-muted-foreground">{pick("예측 편향:", "Forecast bias:")} </span>
              <span className={`font-medium tabular-nums ${
                stats.biasPct == null ? "" :
                Math.abs(stats.biasPct) <= 5 ? "text-emerald-600" :
                stats.biasPct < 0 ? "text-amber-600" : "text-blue-600"
              }`}>
                {stats.biasPct != null ? `${stats.biasPct >= 0 ? "+" : ""}${stats.biasPct.toFixed(1)}%` : "—"}
              </span>
              <span className="ml-1 text-muted-foreground">{pick(`(${stats.nWeeks}주 기준)`, `(over ${stats.nWeeks}wk)`)}</span>
            </span>
          )}
          {stats.wape != null && (
            <span>
              <span className="text-muted-foreground">{pick("합산 오차:", "Aggregate error:")} </span>
              <span className="font-medium tabular-nums">{(stats.wape * 100).toFixed(1)}%</span>
              <span className="ml-1 text-muted-foreground">{pick("(SKU 합산 후)", "(summed first)")}</span>
            </span>
          )}
          {stats.fwdWeeks > 0 && (
            <span>
              <span className="text-muted-foreground">{pick(`향후 ${stats.fwdWeeks}주:`, `Next ${stats.fwdWeeks}w:`)} </span>
              <span className="font-medium tabular-nums">{fmtInt(stats.fwdTotal)}</span>
            </span>
          )}
        </div>
      )}

      {fig ? (
        <div className="h-[680px] overflow-hidden rounded-md border">
          <Plot
            data={fig.data}
            layout={fig.layout}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%", height: "680px" }}
            useResizeHandler
          />
        </div>
      ) : (
        <div className="flex h-[680px] items-center justify-center rounded-md border text-sm text-muted-foreground">
          {pick("표시할 예측 데이터가 없습니다.", "No forecast data to display yet.")}
        </div>
      )}

      {/* Loud on purpose. Seeded runs exist so this chart can be reviewed
          before real ones accumulate, and a fabricated line that looks like
          evidence is worse than no line. Disappears by itself: the endpoint
          prefers the current model's rows the moment a real run lands. */}
      {data.history_version && data.history_version !== data.version && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">
            {pick("샘플 데이터입니다.", "This is sample data.")}
          </span>{" "}
          {pick(
            `과거 예측선은 ${data.history_version} 의 값이며, 현재 모델 ${data.version} 의 실제 실행 기록이 아닙니다. 차트 동작을 확인하기 위해 만들어 넣은 값이므로 정확도를 판단하는 데 쓰면 안 됩니다. 실제 실행이 저장되면 자동으로 대체됩니다.`,
            `The predicted line comes from ${data.history_version}, not from real runs of the current model (${data.version}). It was fabricated so this chart could be reviewed before runs accumulate, and says nothing about accuracy. It is replaced automatically once a real run is stored.`,
          )}
        </div>
      )}

      {data.runs_stored === 0 && (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {pick(
              "아직 저장된 예측 실행이 없어 과거 예측선이 비어 있습니다.",
              "No stored runs yet, so there is no predicted line.",
            )}
          </span>{" "}
          {pick(
            "위 그래프는 실제 수요와 최신 실행의 향후 예측만 보여줍니다. 주간 예측이 실행될 때마다 그 내용이 기록되고, 해당 주가 끝나면 실판매와 대조되어 점선이 채워집니다. 백테스트 결과를 대신 그리지 않는 이유는 그것이 다른 주장이기 때문입니다. 백테스트는 위 표가 답하고 있고, 이 그래프는 결과를 모르는 상태에서 미리 낸 예측만 다룹니다.",
            "The chart shows actual demand and the latest run's forward horizon only. Each weekly run records what it predicted, and as those weeks finish they are scored and the dashed line fills in. Backtest results are deliberately not drawn here instead: those are a different claim, already answered by the grid above, and this chart is only about forecasts made before the outcome was known.",
          )}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        {!data.has_intervals && pick(
          "이 모델은 점 예측만 산출하므로 P85 같은 예측 구간 밴드가 없습니다. 기존 페이지의 차트에는 밴드가 있었고, 실제선이 밴드를 벗어나는지로 구간 보정을 눈으로 확인할 수 있었습니다. 대신 발주 목록의 안전재고는 SKU별 측정 오차를 사용합니다. ",
          "This model emits a point forecast only, so there is no prediction band. The old page's chart drew one and used it as a calibration check: the actual line leaving the band meant the interval missed. The Action List's safety stock uses measured per-SKU error instead, which is a different instrument. ",
        )}
        {pick(
          "합산 오차는 위 표의 SKU별 합산 오차와 다릅니다. SKU를 먼저 더하면 과다 예측과 과소 예측이 서로 상쇄되기 때문이며, 정확도 지표는 위의 값입니다.",
          "Aggregate error here differs from the pooled figure above: summing SKUs before taking the difference lets one SKU's over-forecast cancel another's under. The figure above remains the accuracy claim; this is the portfolio shape.",
        )}
      </p>
    </section>
  );
}
