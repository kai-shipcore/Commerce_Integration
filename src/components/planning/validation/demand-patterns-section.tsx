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
import { SectionHeading } from "./section-heading";
import type { DemandPatternsResponse } from "./types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const nf = new Intl.NumberFormat("en-US");
const COLOUR = { forecast: "#6366f1", tail: "#f59e0b" } as const;
const CONFIG = { responsive: true, displayModeBar: false } as const;

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
    // Two stacked series over up to two years of weeks. At 380 the bands were
    // thin enough that the tail's share read as a stripe rather than a
    // quantity, which is the one thing this chart exists to show.
    height: 460,
    margin: { l: 58, r: 20, t: 16, b: 44 },
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

  // The breakpoint the interpretation below is written about: the smallest
  // share of SKUs that already accounts for half of demand, or failing that the
  // most concentrated row served. Chosen from the data rather than hardcoded to
  // "top 10%", so the sentence always describes a row the table above is
  // actually showing.
  const elbow = useMemo(() => {
    const rows = [...data.concentration].sort((a, b) => a.sku_share - b.sku_share);
    return rows.find((c) => c.demand_share >= 0.5) ?? rows[0] ?? null;
  }, [data.concentration]);

  // Memoised rather than defaulted inline. `data.pareto ?? []` builds a new
  // array on every render when the field is absent, which is exactly the case
  // an older API produces, so the traces below would rebuild forever.
  const pareto = useMemo(() => data.pareto ?? [], [data.pareto]);

  const paretoTraces = useMemo<Data[]>(() => {
    if (pareto.length === 0) return [];
    return [
      // Perfect equality, drawn first so the curve sits over it. Without a
      // reference a cumulative curve looks steep whatever the distribution:
      // every one of them starts low and ends at 100%, so the shape only means
      // something against the line it would follow if every SKU sold the same.
      {
        x: [0, 100],
        y: [0, 100],
        type: "scatter",
        mode: "lines",
        name: pick("균등 분포", "Even demand"),
        line: { color: "rgba(128,128,128,0.55)", width: 1, dash: "dot" },
        hoverinfo: "skip",
      },
      {
        x: pareto.map((p) => p.sku_pct * 100),
        y: pareto.map((p) => p.demand_pct * 100),
        type: "scatter",
        mode: "lines",
        name: pick("누적 수요", "Cumulative demand"),
        line: { color: COLOUR.forecast, width: 2 },
        fill: "tozeroy",
        fillcolor: "rgba(99,102,241,0.10)",
        hovertemplate: pick(
          "상위 %{x:.0f}% SKU → 수요의 %{y:.0f}%<extra></extra>",
          "top %{x:.0f}% of SKUs → %{y:.0f}% of demand<extra></extra>",
        ),
      },
    ];
  }, [pareto, pick]);

  const paretoLayout = useMemo<Partial<Layout>>(() => ({
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { size: 12 },
    // Taller than it was, and taller relative to its width than the chart
    // above. Both axes are 0-100% of the same catalogue, so the curve's bow
    // against the diagonal is the whole message, and a wide flat panel
    // flattens the diagonal towards horizontal and takes the bow with it.
    height: 400,
    margin: { l: 56, r: 16, t: 12, b: 48 },
    showlegend: false,
    // Both axes are percentages of the same catalogue, so both are pinned to
    // 0-100. Letting either autoscale would redraw the curve at a different
    // aspect on every window change and make two windows look like two
    // different distributions.
    xaxis: {
      range: [0, 100],
      showgrid: false,
      ticksuffix: "%",
      title: { text: pick("SKU 누적 비율 (수요 순)", "cumulative share of SKUs, ranked by demand") },
    },
    yaxis: {
      range: [0, 100],
      gridcolor: "rgba(128,128,128,0.22)",
      zeroline: false,
      ticksuffix: "%",
      title: { text: pick("수요 누적 비율", "cumulative share of demand") },
    },
    // The breakpoint the sentence below names, marked where it falls so the
    // words and the picture point at the same place on the curve.
    shapes: elbow
      ? [
          {
            type: "line", x0: elbow.sku_share * 100, x1: elbow.sku_share * 100,
            y0: 0, y1: elbow.demand_share * 100,
            line: { color: "rgba(99,102,241,0.5)", width: 1, dash: "dash" },
          },
          {
            type: "line", x0: 0, x1: elbow.sku_share * 100,
            y0: elbow.demand_share * 100, y1: elbow.demand_share * 100,
            line: { color: "rgba(99,102,241,0.5)", width: 1, dash: "dash" },
          },
        ]
      : [],
  }), [pick, elbow]);

  const segForecast = data.segments.find((s) => s.group === "forecast");
  const segTail = data.segments.find((s) => s.group !== "forecast");
  const catalogue = (segForecast?.n_skus ?? 0) + (segTail?.n_skus ?? 0);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id="demand"
        title={pick("수요 구조", "How demand is shaped")}
        description={pick(
          `최근 ${data.weeks}주. 이 항목들은 예측이 아니라 실판매이며, 위 정확도 수치를 어떤 규모에 놓고 읽어야 하는지를 보여줍니다. 수요가 소수 SKU에 집중되어 있을수록 합산 WAPE는 그 소수의 성적에 좌우됩니다.`,
          `The last ${data.weeks} weeks. Nothing here is a forecast; it is what sold, and it sets the scale the accuracy figures above should be read against. The more concentrated demand is in a few SKUs, the more the pooled WAPE above is really a statement about those few.`,
        )}
        aside={
          <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
          {WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWeeksChange(w)}
              className={`rounded px-2 py-1 text-[12.5px] transition-colors ${
                weeks === w
                  ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {w === 104 ? pick("2년", "2y") : w === 52 ? pick("1년", "1y") : `${w}w`}
            </button>
          ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("예측 대상 SKU", "Forecast SKUs")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {nf.format(segForecast?.n_skus ?? 0)}
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {pick(
              `전체 ${nf.format(catalogue)}개 중 ${catalogue ? Math.round(((segForecast?.n_skus ?? 0) / catalogue) * 100) : 0}%`,
              `${catalogue ? Math.round(((segForecast?.n_skus ?? 0) / catalogue) * 100) : 0}% of ${nf.format(catalogue)} SKUs`,
            )}
          </p>
        </div>
        {/* The two demand cards are complements by construction, so each states
            what it is a share OF and in what units. Previously one read "their
            share of demand" and the other "tail share of demand", which is the
            same fact twice, and "tail" is a word only someone who built the
            segmentation would recognise. */}
        <div className="rounded-md border p-3">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("예측이 설명하는 수요", "Demand the forecast covers")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums">
            {Math.round((1 - totals.tailShare) * 100)}%
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {pick(
              `총 ${nf.format(Math.round(totals.forecast + totals.tail))}개 중 ${nf.format(Math.round(totals.forecast))}개`,
              `${nf.format(Math.round(totals.forecast))} of ${nf.format(Math.round(totals.forecast + totals.tail))} units`,
            )}
          </p>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
            {pick("예측이 없는 수요", "Demand with no forecast")}
          </div>
          <div className="mt-1 text-2xl font-bold leading-none tabular-nums text-amber-700 dark:text-amber-500">
            {Math.round(totals.tailShare * 100)}%
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-amber-800/80 dark:text-amber-500/80">
            {pick(
              `${nf.format(segTail?.n_skus ?? 0)}개 SKU는 판매가 불규칙해 예측 대상이 아닙니다. ${nf.format(Math.round(totals.tail))}개 판매.`,
              `${nf.format(segTail?.n_skus ?? 0)} SKUs sell too irregularly to forecast. ${nf.format(Math.round(totals.tail))} units sold.`,
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
        {/* The trend lives here rather than in a card, and only at a year or
            more. Over 26 weeks it compares two six-week periods, where a move
            from 21% to 20% is noise presented with the same confidence as a
            real change. A reader cannot tell those apart, so the shorter
            windows do not offer it. */}
        {weeks >= 52 && Math.abs(totals.tailShareLate - totals.tailShareEarly) >= 0.02 && (
          <p className="px-1 pt-1 text-[12.5px] font-medium leading-relaxed">
            {pick(
              `예측 없는 수요의 비중이 이 기간 초반 ${Math.round(totals.tailShareEarly * 100)}%에서 최근 ${Math.round(totals.tailShareLate * 100)}%로 ${totals.tailShareLate > totals.tailShareEarly ? "늘었습니다" : "줄었습니다"}.`,
              `The share with no forecast has ${totals.tailShareLate > totals.tailShareEarly ? "grown" : "fallen"} from ${Math.round(totals.tailShareEarly * 100)}% to ${Math.round(totals.tailShareLate * 100)}% of weekly volume across this period.`,
            )}
          </p>
        )}
        <p className="px-1 pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          {pick(
            "주간 실판매를 예측 대상 여부로 나눈 누적 그래프입니다. 주황색 영역은 예측이 전혀 없는 매출이므로, 이 페이지의 모든 정확도 수치가 닿지 않는 범위입니다.",
            "Weekly actual sales, stacked by whether the model forecasts the SKU. The amber band is revenue with no prediction behind it, and so is the limit of what every accuracy figure on this page can speak for.",
          )}
        </p>
      </div>

      <div className="rounded-md border">
        <div className="border-b px-3 py-2">
          <p className="text-[12.5px] font-semibold">{pick("수요 집중도", "Demand concentration")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {pick(
              "SKU를 수요 순으로 정렬했을 때, 상위 몇 %가 전체 수요의 몇 %를 차지하는지를 누적으로 보여줍니다. 점선은 모든 SKU가 균등하게 팔리는 경우이며, 곡선이 그 위로 휠수록 집중도가 높습니다.",
              "SKUs ranked by demand, cumulative. The dotted line is what perfectly even demand would look like; the further the curve bows above it, the more concentrated the catalogue is.",
            )}
          </p>
        </div>
        {/* The curve, not a table of breakpoints. Concentration is a
            distribution, and four rows make a reader add them up mentally to
            see the shape a curve states outright.
            Falls back to the table when the API predates `pareto`, rather than
            rendering an empty panel: the two say the same thing, and the older
            form is still a true statement of it. */}
        {pareto.length > 0 ? (
          <div className="p-2">
            <Plot data={paretoTraces} layout={paretoLayout} config={CONFIG} style={{ width: "100%" }} />
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pl-3 pr-2 text-left font-medium">{pick("상위", "Top")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">SKUs</th>
                <th className="py-1.5 pr-3 text-right font-medium">{pick("수요 비중", "Share of demand")}</th>
              </tr>
            </thead>
            <tbody>
              {data.concentration.map((c) => (
                <tr key={c.sku_share} className="border-t">
                  <td className="py-1.5 pl-3 pr-2 text-[12.5px]">{Math.round(c.sku_share * 100)}%</td>
                  <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {nf.format(c.n_skus)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[12.5px] font-semibold tabular-nums">
                    {(c.demand_share * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* The consequence, in words. The curve shows the shape; this says why
            the shape matters, which is that the pooled figure at the top of the
            page is mostly a verdict on the SKUs at the left of it.
            Read from `concentration` rather than off the curve, which is
            downsampled and would put this figure a sample interval out. */}
        {elbow && (
          <p className="border-t px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
            {pick(
              `상위 ${Math.round(elbow.sku_share * 100)}%인 ${nf.format(elbow.n_skus)}개 SKU가 전체 수요의 ${Math.round(elbow.demand_share * 100)}%를 차지합니다. 이 페이지 상단의 합산 WAPE는 SKU별 오차를 합산한 뒤 나누므로, 사실상 이 ${nf.format(elbow.n_skus)}개에 대한 평가에 가깝습니다.`,
              `The top ${Math.round(elbow.sku_share * 100)}% of SKUs, ${nf.format(elbow.n_skus)} of them, carry ${Math.round(elbow.demand_share * 100)}% of demand. Because the pooled WAPE at the top of this page sums errors across SKUs before dividing, it is largely a verdict on those rather than on the catalogue.`,
            )}
          </p>
        )}
      </div>
    </section>
  );
}
