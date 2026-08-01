"use client";

/**
 * Code Guide:
 * Portfolio demand across the SKUs currently in the filtered list.
 *
 * It follows the filters rather than showing a fixed total. A chart describing
 * a different population from the table beneath it invites the reader to
 * reconcile two numbers that were never meant to agree.
 *
 * Collapsed by default. It was open, on the argument that a chart nobody
 * notices teaches nobody anything. What that traded away was the top of the
 * worklist: 460px of chart plus its controls put the first table row below the
 * fold on a laptop, every morning, on the one screen whose entire job is "what
 * do I order today". The same question is answered twice on Forecast Validation
 * with better instruments, so this is a summary rather than the only place to
 * see it, and a summary should not outrank the thing it summarises.
 *
 * Both spans are adjustable. The history window is a server parameter, since the
 * weekly series lives there and sending two years of it to trim in the browser
 * would ship the data in order to discard most of it. The forecast window is
 * trimmed here, because the whole horizon is at most a few dozen points and is
 * already in hand.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout, Shape } from "plotly.js";
import { Loader2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Point { ds: string; value: number }
interface TrendResponse {
  actual: Point[];
  forecast: Point[];
  v1: Point[];
  v1_coverage: number;
  sku_count: number;
  history_weeks: number;
}

// Brighter than the per-SKU charts on purpose: this one is read at a glance
// from across the page rather than studied point by point.
const COLOUR = { actual: "#5b5b5b", forecast: "#6366f1", v1: "#14b8a6" } as const;

/** Selectable spans, in weeks. History is what the server slices; forecast is
 *  trimmed from the horizon already returned. */
const HISTORY_WEEKS = [13, 26, 52, 104] as const;
const FORECAST_WEEKS = [4, 8, 13] as const;

export function PortfolioChart({ skus }: { skus: string[] }) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [historyWeeks, setHistoryWeeks] = useState<number>(26);
  const [forecastWeeks, setForecastWeeks] = useState<number | "all">("all");
  const [state, setState] = useState<{ key: string; data: TrendResponse | null; error: string | null }>(
    { key: "", data: null, error: null },
  );

  // The SKU set and the history window together identify a response. Sorting the
  // ids first means two filters that select the same SKUs in a different order
  // share a request rather than refetching identical data.
  const key = useMemo(
    () => `${historyWeeks}|${[...skus].sort().join(",")}`,
    [skus, historyWeeks],
  );

  useEffect(() => {
    if (!open || !skus.length) return;
    const controller = new AbortController();
    fetch(apiPath("/api/planning/demand-trend"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus, history_weeks: historyWeeks }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        return body as TrendResponse;
      })
      .then((body) => setState({ key, data: body, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [open, key, skus, historyWeeks]);

  const loading = open && state.key !== key;
  const d = state.data;

  // How many forward weeks the run actually produced. The forecast presets are
  // filtered against it rather than fixed, so a 13-week horizon does not offer a
  // 26-week view that would silently show 13.
  const horizon = d?.forecast.length ?? 0;

  const traces = useMemo<Data[]>(() => {
    if (!d) return [];
    const cut = <T,>(arr: T[]) => (forecastWeeks === "all" ? arr : arr.slice(0, forecastWeeks));
    const forecast = cut(d.forecast);
    const v1 = cut(d.v1);
    const out: Data[] = [
      {
        x: d.actual.map((p) => p.ds),
        y: d.actual.map((p) => p.value),
        type: "scatter", mode: "lines",
        name: pick("실제 판매", "Actual sales"),
        line: { color: COLOUR.actual, width: 2.6 },
      },
    ];
    // Bridge from the last actual so the forecast continues the demand line
    // rather than starting detached from it.
    const bridge = d.actual.length ? [d.actual[d.actual.length - 1]] : [];
    if (forecast.length) {
      out.push({
        x: [...bridge.map((p) => p.ds), ...forecast.map((p) => p.ds)],
        y: [...bridge.map((p) => p.value), ...forecast.map((p) => p.value)],
        type: "scatter", mode: "lines",
        name: pick("모델 예측", "Model forecast"),
        line: { color: COLOUR.forecast, width: 2.8, dash: "dash" },
      });
    }
    if (v1.length) {
      out.push({
        x: [...bridge.map((p) => p.ds), ...v1.map((p) => p.ds)],
        y: [...bridge.map((p) => p.value), ...v1.map((p) => p.value)],
        type: "scatter", mode: "lines",
        name: pick("스프레드시트 (V1)", "Spreadsheet (V1)"),
        line: { color: COLOUR.v1, width: 2.2, dash: "dot" },
      });
    }
    return out;
  }, [d, forecastWeeks, pick]);

  const layout = useMemo<Partial<Layout>>(() => {
    const boundary = d?.actual.length ? d.actual[d.actual.length - 1].ds : null;
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { size: 12 },
      hovermode: "x unified",
      height: 460,
      margin: { l: 58, r: 20, t: 16, b: 40 },
      legend: { orientation: "h", y: -0.14, font: { size: 11 } },
      xaxis: { showgrid: false },
      yaxis: {
        gridcolor: "rgba(128,128,128,0.22)",
        zeroline: false,
        title: { text: pick("주당 수량", "units / week") },
      },
      shapes: boundary
        ? [{
            type: "line", x0: boundary, x1: boundary, yref: "paper", y0: 0, y1: 1,
            line: { color: "#9a9a9a", width: 1.5, dash: "dot" },
          } as Partial<Shape>]
        : [],
    };
  }, [d, pick]);

  return (
    <details className="rounded-md border" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none px-3 py-2.5 text-[12.5px] font-semibold hover:bg-muted/40">
        {pick(
          `이 ${skus.length.toLocaleString()}개 SKU의 수요`,
          `Demand across these ${skus.length.toLocaleString()} SKUs`,
        )}
      </summary>
      <div className="border-t p-2">
        {/* Two spans, labelled by what each one governs. Kept apart rather than
            merged into one "range" control: the left of the marker is what
            happened and the right of it is what the model claims will happen,
            and a reader lengthening one is asking a different question from a
            reader lengthening the other. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{pick("실적 기간", "History")}</span>
            {HISTORY_WEEKS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setHistoryWeeks(w)}
                aria-pressed={historyWeeks === w}
                className={`rounded border px-1.5 py-0.5 tabular-nums transition-colors ${
                  historyWeeks === w
                    ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                    : "border-transparent text-muted-foreground hover:bg-muted"
                }`}
              >
                {w === 104 ? pick("2년", "2y") : w === 52 ? pick("1년", "1y") : `${w}w`}
              </button>
            ))}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">{pick("예측 기간", "Forecast")}</span>
            {FORECAST_WEEKS.filter((w) => w < horizon).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setForecastWeeks(w)}
                aria-pressed={forecastWeeks === w}
                className={`rounded border px-1.5 py-0.5 tabular-nums transition-colors ${
                  forecastWeeks === w
                    ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                    : "border-transparent text-muted-foreground hover:bg-muted"
                }`}
              >
                {w}w
              </button>
            ))}
            <button
              type="button"
              onClick={() => setForecastWeeks("all")}
              aria-pressed={forecastWeeks === "all"}
              className={`rounded border px-1.5 py-0.5 tabular-nums transition-colors ${
                forecastWeeks === "all"
                  ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                  : "border-transparent text-muted-foreground hover:bg-muted"
              }`}
            >
              {pick(`전체 ${horizon}w`, `all ${horizon}w`)}
            </button>
          </span>
        </div>
        {loading && (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {pick("불러오는 중…", "Loading…")}
          </div>
        )}
        {state.error && <p className="p-4 text-sm text-muted-foreground">{state.error}</p>}
        {!loading && d && (
          <>
            <Plot data={traces} layout={layout} config={{ responsive: true, displayModeBar: false }} style={{ width: "100%" }} />
            <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {pick(
                `최근 ${d.history_weeks}주 실판매와 이후 예측을, 현재 필터의 ${d.sku_count.toLocaleString()}개 SKU에 대해 합산했습니다. 점선은 실적이 끝나는 지점입니다.`,
                `Last ${d.history_weeks} weeks of actual demand, then the forward forecast, summed across the ${d.sku_count.toLocaleString()} SKUs in the current filter. The dotted line marks where history ends.`,
              )}
              {d.v1.length > 0 && d.v1_coverage < 1 && (
                <>
                  {" "}
                  {pick(
                    `V1은 이 중 ${Math.round(d.v1_coverage * 100)}%만 포함하므로 직접 비교할 수 없습니다.`,
                    `V1 covers ${Math.round(d.v1_coverage * 100)}% of these SKUs, so its line is not directly comparable.`,
                  )}
                </>
              )}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
