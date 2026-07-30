"use client";

/**
 * Code Guide:
 * Portfolio demand across the SKUs currently in the filtered list.
 *
 * It follows the filters rather than showing a fixed total. A chart describing
 * a different population from the table beneath it invites the reader to
 * reconcile two numbers that were never meant to agree.
 *
 * Open by default, and deliberately large. It was collapsed and small on the
 * argument that the table matters most, but a chart nobody notices teaches
 * nobody anything, and the portfolio shape is the context every row below should
 * be read against. Still collapsible, so anyone working the list daily can
 * reclaim the height.
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

export function PortfolioChart({ skus }: { skus: string[] }) {
  const { pick } = useI18n();
  // Open by default. Collapsed, it was easy to miss entirely, and the
  // portfolio shape is the context every row below should be read against.
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<{ key: string; data: TrendResponse | null; error: string | null }>(
    { key: "", data: null, error: null },
  );

  // The SKU set identifies a response. Sorting first means two filters that
  // select the same SKUs in a different order share a request rather than
  // refetching identical data.
  const key = useMemo(() => [...skus].sort().join(","), [skus]);

  useEffect(() => {
    if (!open || !skus.length) return;
    const controller = new AbortController();
    fetch(apiPath("/api/planning/demand-trend"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus, history_weeks: 26 }),
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
  }, [open, key, skus]);

  const loading = open && state.key !== key;
  const d = state.data;

  const traces = useMemo<Data[]>(() => {
    if (!d) return [];
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
    if (d.forecast.length) {
      out.push({
        x: [...bridge.map((p) => p.ds), ...d.forecast.map((p) => p.ds)],
        y: [...bridge.map((p) => p.value), ...d.forecast.map((p) => p.value)],
        type: "scatter", mode: "lines",
        name: pick("모델 예측", "Model forecast"),
        line: { color: COLOUR.forecast, width: 2.8, dash: "dash" },
      });
    }
    if (d.v1.length) {
      out.push({
        x: [...bridge.map((p) => p.ds), ...d.v1.map((p) => p.ds)],
        y: [...bridge.map((p) => p.value), ...d.v1.map((p) => p.value)],
        type: "scatter", mode: "lines",
        name: pick("스프레드시트 (V1)", "Spreadsheet (V1)"),
        line: { color: COLOUR.v1, width: 2.2, dash: "dot" },
      });
    }
    return out;
  }, [d, pick]);

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
