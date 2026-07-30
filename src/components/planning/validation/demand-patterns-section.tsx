"use client";

/**
 * Code Guide:
 * What demand actually looks like, independent of any model.
 *
 * Nothing in this section is a forecast or a judgement of one. It is here so
 * that the accuracy figures above are read in proportion: a model that covers
 * 13% of the catalogue but most of its volume is a different proposition from
 * one that covers 13% of the volume too.
 *
 * The weekly chart splits demand into the SKUs the model forecasts and the
 * intermittent tail it does not. The second series is real revenue with no
 * prediction behind it, and it is the honest boundary of everything on this
 * page.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { DemandPatternsResponse } from "./types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const nf = new Intl.NumberFormat("en-US");
const COLOUR = { forecast: "#6366f1", tail: "#f59e0b" } as const;

/** Offered windows, in weeks. 26 is the default: the annual view is already
 *  carried by the comparison grid above, and half a year is the horizon a
 *  planner can act on. 52 stays one click away because the tail's growth as a
 *  share of volume only reads over a full year. */
export const WEEK_OPTIONS = [13, 26, 52, 104] as const;
export const DEFAULT_WEEKS = 26;

export function DemandPatternsSection({
  data,
  weeks,
  onWeeksChange,
}: {
  data: DemandPatternsResponse;
  weeks: number;
  onWeeksChange: (weeks: number) => void;
}) {
  const { pick } = useI18n();

  const traces = useMemo<Data[]>(() => {
    const x = data.weekly.map((p) => p.ds);
    return [
      {
        x,
        y: data.weekly.map((p) => p.forecast),
        type: "scatter", mode: "lines", stackgroup: "one",
        name: pick("예측 대상 SKU", "Forecast SKUs"),
        line: { color: COLOUR.forecast, width: 1.5 },
        fillcolor: "rgba(99,102,241,0.55)",
      },
      {
        x,
        y: data.weekly.map((p) => p.not_forecast),
        type: "scatter", mode: "lines", stackgroup: "one",
        name: pick("예측 대상 아님 (간헐)", "Not forecast (intermittent)"),
        line: { color: COLOUR.tail, width: 1.5 },
        fillcolor: "rgba(245,158,11,0.55)",
      },
    ];
  }, [data, pick]);

  const layout = useMemo<Partial<Layout>>(() => ({
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { size: 12 },
    hovermode: "x unified",
    height: 380,
    margin: { l: 58, r: 20, t: 16, b: 40 },
    legend: { orientation: "h", y: -0.16, font: { size: 11 } },
    xaxis: { showgrid: false },
    yaxis: {
      gridcolor: "rgba(128,128,128,0.22)",
      zeroline: false,
      title: { text: pick("주당 수량", "units / week") },
    },
  }), [pick]);

  const totals = useMemo(() => {
    const f = data.weekly.reduce((s, p) => s + p.forecast, 0);
    const t = data.weekly.reduce((s, p) => s + p.not_forecast, 0);
    const all = f + t;
    // First and last quarter of the window, to say whether the tail's share is
    // moving rather than only what it is now. A single ratio hides a trend.
    // The comparison is only as long as the window allows, which is why the
    // card names the span rather than saying "early" and "now" unqualified.
    const q = Math.max(1, Math.floor(data.weekly.length / 4));
    const shareOf = (pts: typeof data.weekly) => {
      const sf = pts.reduce((s, p) => s + p.forecast, 0);
      const st = pts.reduce((s, p) => s + p.not_forecast, 0);
      return sf + st > 0 ? st / (sf + st) : 0;
    };
    return {
      forecast: f,
      tail: t,
      tailShare: all > 0 ? t / all : 0,
      tailShareEarly: shareOf(data.weekly.slice(0, q)),
      tailShareLate: shareOf(data.weekly.slice(-q)),
      spanWeeks: q,
    };
  }, [data]);

  const segForecast = data.segments.find((s) => s.group === "forecast");
  const segTail = data.segments.find((s) => s.group !== "forecast");
  const catalogue = (segForecast?.n_skus ?? 0) + (segTail?.n_skus ?? 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{pick("수요 구조", "How demand is shaped")}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {pick(
              `최근 ${data.weeks}주. 이 항목들은 예측이 아니라 실판매이며, 위 정확도 수치를 어떤 규모에 놓고 읽어야 하는지를 보여줍니다.`,
              `The last ${data.weeks} weeks. Nothing here is a forecast; it is what sold, and it sets the scale the accuracy figures above should be read against.`,
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
          {WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWeeksChange(w)}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${
                weeks === w
                  ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {w === 104 ? pick("2년", "2y") : w === 52 ? pick("1년", "1y") : `${w}w`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("예측 대상 SKU", "Forecast SKUs")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {nf.format(segForecast?.n_skus ?? 0)}
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {pick(
              `전체 ${nf.format(catalogue)}개 중 ${catalogue ? Math.round(((segForecast?.n_skus ?? 0) / catalogue) * 100) : 0}%`,
              `${catalogue ? Math.round(((segForecast?.n_skus ?? 0) / catalogue) * 100) : 0}% of ${nf.format(catalogue)} SKUs`,
            )}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("그 SKU들의 수요 비중", "Their share of demand")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {Math.round((1 - totals.tailShare) * 100)}%
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {pick(`${nf.format(Math.round(totals.forecast))}개`, `${nf.format(Math.round(totals.forecast))} units`)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("간헐 SKU", "Intermittent SKUs")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {nf.format(segTail?.n_skus ?? 0)}
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {pick("예측 없음", "no forecast at all")}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("간헐 SKU 수요 비중", "Tail share of demand")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {Math.round(totals.tailShare * 100)}%
          </div>
          {/* Names the span it compares over. At 26 weeks these are six-week
              periods, at 104 they are half-years, and "early" without that
              qualifier would read as the same claim at every setting. */}
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {pick(
              `첫 ${totals.spanWeeks}주 ${Math.round(totals.tailShareEarly * 100)}% → 최근 ${totals.spanWeeks}주 ${Math.round(totals.tailShareLate * 100)}%`,
              `${Math.round(totals.tailShareEarly * 100)}% over the first ${totals.spanWeeks}w, ${Math.round(totals.tailShareLate * 100)}% over the last ${totals.spanWeeks}w`,
            )}
          </p>
        </div>
      </div>

      <div className="rounded-md border p-2">
        <Plot
          data={traces}
          layout={layout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%" }}
        />
        <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-muted-foreground">
          {pick(
            "주간 실판매를 예측 대상 여부로 나눈 누적 그래프입니다. 주황색 영역은 예측이 전혀 없는 매출이므로, 이 페이지의 모든 정확도 수치가 닿지 않는 범위입니다.",
            "Weekly actual sales, stacked by whether the model forecasts the SKU. The amber band is revenue with no prediction behind it, and so is the limit of what every accuracy figure on this page can speak for.",
          )}
        </p>
      </div>

      <div className="rounded-md border">
        <div className="border-b px-3 py-2">
          <p className="text-[11px] font-semibold">{pick("수요 집중도", "Demand concentration")}</p>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">
            {pick(
              "상위 SKU가 전체 수요에서 차지하는 비중.",
              "How much of total demand the largest SKUs account for.",
            )}
          </p>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/60 text-[9.5px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pl-3 pr-2 text-left font-medium">{pick("상위", "Top")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">SKUs</th>
              <th className="py-1.5 pr-3 text-right font-medium">{pick("수요 비중", "Share of demand")}</th>
            </tr>
          </thead>
          <tbody>
            {data.concentration.map((c) => (
              <tr key={c.sku_share} className="border-t">
                <td className="py-1.5 pl-3 pr-2 text-[11.5px]">{Math.round(c.sku_share * 100)}%</td>
                <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                  {nf.format(c.n_skus)}
                </td>
                <td className="py-1.5 pr-3 text-right text-[11.5px] font-semibold tabular-nums">
                  {(c.demand_share * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
