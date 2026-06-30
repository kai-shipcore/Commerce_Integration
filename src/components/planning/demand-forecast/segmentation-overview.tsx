"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DemandConcentration, type ParetoData } from "./demand-concentration";
import { apiPath } from "@/lib/api-path";

const fmt = new Intl.NumberFormat("en-US");

const SEGMENT_TIPS: Record<string, string> = {
  smooth_full:  "SKUs with consistent, predictable sales and at least a year of history. These are your core products — demand is stable enough that a statistical model can reliably forecast week-by-week quantities.",
  smooth_short: "Same consistent demand pattern as Smooth, but with less than a year of sales history. The model is less confident here — forecasts improve automatically as more history accumulates.",
  intermittent: "SKUs that sell sporadically or rarely. Demand is too irregular to forecast week-by-week, so these are managed with a restock policy (e.g. reorder when stock drops below a threshold) rather than a time series model.",
};

const METHOD_TIPS: Record<string, string> = {
  "StatsForecast": "A library of statistical time series models (ETS, ARIMA, Theta, etc.). The best-fitting model is selected per SKU through cross-validation, then refit on all available data to produce the forward forecast.",
  "V1":            "A simpler fallback model used when a SKU doesn't have enough history to run full cross-validation. It produces a reasonable baseline forecast that gets replaced by a StatsForecast model once enough data accumulates.",
  "Restock policy": "No time series forecast is generated. Instead, stock is replenished reactively — typically when on-hand inventory drops below a set threshold. Suitable for slow-moving or unpredictable items where a forecast would be unreliable.",
};

function InfoTooltip({ text, onClick }: { text: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <span className="group relative inline-flex items-center" onClick={onClick ?? ((e) => e.stopPropagation())}>
      <HelpCircle className={`ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground ${onClick ? "cursor-pointer" : "cursor-help"}`} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function V1Detail() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        V1 is the same formula used in the current Google Sheets forecasting tool. It computes a blended daily sales rate from three independent order streams, applies a dampening step to smooth sudden spikes, then scales up to the forecast horizon with a seasonal multiplier.
      </p>

      <div className="space-y-1.5">
        <p className="font-medium">Step 1 — Three order streams</p>
        <p className="text-muted-foreground">Orders are split into three non-overlapping channels that are summed at the end:</p>
        <ul className="ml-4 space-y-0.5 text-muted-foreground list-disc">
          <li><span className="font-medium text-foreground">West</span> — regular sales + preorders (non-Amazon)</li>
          <li><span className="font-medium text-foreground">East</span> — TTM (through-the-month) orders + TTM preorders</li>
          <li><span className="font-medium text-foreground">FBA</span> — Amazon FBA sales only</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">Step 2 — Weighted blend (West &amp; East)</p>
        <p className="text-muted-foreground">For each stream, six lookback windows are computed and blended into a single daily rate:</p>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2">Rate formula</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono">
              {[
                ["90 days", "sales",    "10%", "sum(sales, 90d) / 90"],
                ["60 days", "sales",    "15%", "sum(sales, 60d) / 60"],
                ["30 days", "sales",    "30%", "sum(sales, 30d) / 30"],
                ["15 days", "sales",    "20%", "sum(sales, 15d) / 15"],
                [ "7 days", "sales",    "15%", "sum(sales, 7d) / 7"],
                ["30 days", "preorder", "10%", "sum(preorder, 30d) / 30"],
              ].map(([win, type, wt, formula]) => (
                <tr key={win + type} className="text-xs">
                  <td className="px-3 py-1.5">{win}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{type}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{wt}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Blended rate = Σ (weight × window_rate). FBA uses only a 30-day average with no blending.</p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">Step 3 — Dampening</p>
        <p className="text-muted-foreground">To avoid overreacting to sudden spikes or drops, the current rate is compared to the rate computed one week earlier:</p>
        <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
          <p>change = |current − prev| / prev</p>
          <p className="mt-1">if change &lt; 50%: rate = 0.1 × prev + 0.9 × current</p>
          <p>if change ≥ 50%: rate = 0.2 × prev + 0.8 × current</p>
        </div>
        <p className="text-xs text-muted-foreground">FBA is not dampened.</p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">Step 4 — Forecast</p>
        <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
          <p>daily_rate = west + east + fba</p>
          <p className="mt-1">forecast = daily_rate × horizon_days × seasonal_modifier</p>
        </div>
        <p className="text-muted-foreground text-xs">
          The seasonal modifier is a proportional blend of monthly factors (Jan 0.75 → Dec 1.30) weighted by how many days of the forecast window fall in each month.
        </p>
      </div>
    </div>
  );
}

function StatsForecastDetail() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        StatsForecast is a high-performance library of classical time series models. Rather than using one model for all SKUs, each SKU is individually evaluated through cross-validation and assigned the model that best predicts its own demand pattern.
      </p>

      <div className="space-y-1.5">
        <p className="font-medium">Model candidates (per SKU)</p>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                ["AutoETS",         "Exponential smoothing — learns how much weight to give recent vs. older observations. Handles level, trend, and seasonality automatically."],
                ["AutoARIMA",       "Fits a regression on lagged values and forecast errors. Good at capturing momentum and autocorrelation in demand."],
                ["AutoTheta",       "Decomposes the series into a long-term trend and a short-term component. Often strong for noisy or volatile series."],
                ["SeasonalNaive",   "Baseline: repeats last year's corresponding week. Surprisingly competitive for highly seasonal products."],
                ["WindowAverage",   "Baseline: averages demand over a recent fixed window. A simple but robust fallback."],
              ].map(([model, desc]) => (
                <tr key={model}>
                  <td className="px-3 py-2 font-mono text-xs font-medium whitespace-nowrap">{model}</td>
                  <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">How the best model is selected</p>
        <p className="text-muted-foreground">
          Each SKU is evaluated using walk-forward cross-validation: the model is fit on historical data up to a cutoff date, then asked to predict the next 13 weeks. This is repeated across several cutoff windows. The model with the lowest <span className="font-medium text-foreground">horizon WAPE</span> (weighted absolute percentage error over the full 13-week window, averaged across all CV windows) is selected. Total demand accuracy is what matters for restocking — per-week errors that cancel out don't count against the model.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">Prediction intervals</p>
        <p className="text-muted-foreground">
          Where the SKU has enough history, the forecast includes a <span className="font-medium text-foreground">P70 confidence band</span> (the range expected to contain actual demand 70% of the time), computed via conformal prediction. SKUs where the interval can't be computed reliably show a point forecast only.
        </p>
      </div>
    </div>
  );
}

const METHOD_DETAILS: Record<string, { title: string; content: React.ReactNode }> = {
  "StatsForecast": { title: "StatsForecast — How it works", content: <StatsForecastDetail /> },
  "V1":            { title: "V1 Formula — How it works",    content: <V1Detail /> },
};

function MethodBadge({ method }: { method: string }) {
  const [open, setOpen] = React.useState(false);
  const detail = METHOD_DETAILS[method];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (detail) setOpen(true);
  };

  return (
    <>
      <span
        onClick={handleOpen}
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
          METHOD_STYLES[method] ?? "bg-muted text-muted-foreground border"
        } ${detail ? "cursor-pointer" : ""}`}
      >
        {method}
        {METHOD_TIPS[method] && <InfoTooltip text={METHOD_TIPS[method]} onClick={detail ? handleOpen : undefined} />}
      </span>
      {detail && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{detail.title}</DialogTitle>
            </DialogHeader>
            {detail.content}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

interface Segment {
  segment: string;
  name: string;
  method: string;
  sku_count: number;
  demand: number;
  demand_pct: number;
}

interface SegmentationData {
  total_skus: number;
  forecasted_skus: number;
  forecasted_pct: number;
  total_demand: number;
  forecasted_demand: number;
  forecasted_demand_pct: number;
  weeks: number;
  period_start: string;
  period_end: string;
  segments: Segment[];
  pareto: ParetoData;
}

const METHOD_STYLES: Record<string, string> = {
  StatsForecast:    "bg-blue-50 text-blue-700 border border-blue-200",
  V1:               "bg-violet-50 text-violet-700 border border-violet-200",
  "Restock policy": "bg-amber-50 text-amber-700 border border-amber-200",
};

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const WEEK_OPTIONS = [4, 8, 10, 13, 26, 52];
const PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"] as const;

function zeroedData(weeks: number): SegmentationData {
  return {
    total_skus: 0, forecasted_skus: 0, forecasted_pct: 0,
    total_demand: 0, forecasted_demand: 0, forecasted_demand_pct: 0,
    weeks, period_start: "", period_end: "",
    segments: [
      { segment: "smooth_full",  name: "Smooth",                  method: "StatsForecast",  sku_count: 0, demand: 0, demand_pct: 0 },
      { segment: "smooth_short", name: "Smooth / Short history",  method: "V1",             sku_count: 0, demand: 0, demand_pct: 0 },
      { segment: "intermittent", name: "Intermittent",            method: "Restock policy", sku_count: 0, demand: 0, demand_pct: 0 },
    ],
    pareto: { x: [], y: [], annotation: null },
  };
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function SegmentationOverview() {
  const router = useRouter();
  const [weeks, setWeeks] = useState(10);
  const [customInput, setCustomInput] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([...PRODUCT_TYPES]);
  const [serverReady, setServerReady] = useState(false);
  const [data, setData] = useState<SegmentationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wait for the forecast server (started by the layout) to be ready
  useEffect(() => {
    let cancelled = false;
    async function waitForServer() {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const res = await fetch(apiPath("/api/forecast-server/start"), { method: "POST" });
          if (res.ok) { if (!cancelled) setServerReady(true); return; }
          const json = await res.json().catch(() => ({})) as { error?: string };
          if (!cancelled) setError(json.error ?? `Forecast server error ${res.status}`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!cancelled) setError("Forecast server did not start in time");
    }
    void waitForServer();
    return () => { cancelled = true; };
  }, []);

  const toggleType = (pt: string) => {
    setSelectedTypes((prev) =>
      prev.includes(pt) ? prev.filter((t) => t !== pt) : [...prev, pt]
    );
  };

  // Fetch segmentation data once server is ready, re-fetch on weeks/selectedTypes change
  useEffect(() => {
    if (!serverReady) return;
    if (selectedTypes.length === 0) {
      setData(zeroedData(weeks));
      return;
    }
    setData(null);
    const allSelected = selectedTypes.length === PRODUCT_TYPES.length;
    const productType = allSelected ? "All" : selectedTypes.join(",");
    const params = new URLSearchParams({ weeks: String(weeks), product_type: productType });
    fetch(apiPath(`/api/forecast/segmentation?${params}`))
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as SegmentationData);
      })
      .catch((err: Error) => setError(err.message));
  }, [weeks, selectedTypes, serverReady]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Failed to load segmentation data: {error}
      </div>
    );
  }

  if (!serverReady && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting to forecast server…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse py-5">
              <CardHeader className="pb-0">
                <div className="h-3 w-24 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="mt-2 h-7 w-16 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse">
          <CardContent className="pt-6">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 w-full rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="animate-pulse">
          <CardContent className="pt-6">
            <div className="h-56 w-full rounded bg-muted" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="flex flex-col gap-2">
        {/* Lookback window */}
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-muted-foreground">Lookback window:</span>
          <div className="flex gap-1">
            {WEEK_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => { setWeeks(w); setCustomInput(""); }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  weeks === w && customInput === ""
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {w}W
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={104}
            placeholder="custom"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = parseInt(customInput);
                if (!isNaN(v) && v >= 1 && v <= 104) setWeeks(v);
              }
            }}
            onBlur={() => {
              const v = parseInt(customInput);
              if (!isNaN(v) && v >= 1 && v <= 104) setWeeks(v);
              else setCustomInput("");
            }}
            className="w-20 rounded border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Product type */}
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-sm text-muted-foreground">Product type:</span>
          <div className="flex flex-wrap gap-2">
            <ToggleBtn
              active={selectedTypes.length === PRODUCT_TYPES.length}
              onClick={() =>
                setSelectedTypes(
                  selectedTypes.length === PRODUCT_TYPES.length ? [] : [...PRODUCT_TYPES]
                )
              }
            >
              All
            </ToggleBtn>
            {PRODUCT_TYPES.map((pt) => (
              <ToggleBtn key={pt} active={selectedTypes.includes(pt)} onClick={() => toggleType(pt)}>
                {pt}
              </ToggleBtn>
            ))}
          </div>
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Total SKUs"
          value={fmt.format(data.total_skus)}
        />
        <MetricCard
          label="Forecasted SKUs"
          value={fmt.format(data.forecasted_skus)}
          sub={`${data.forecasted_pct}% of total`}
        />
        <MetricCard
          label="Demand Coverage"
          value={`${data.forecasted_demand_pct}%`}
          sub="of demand from forecasted SKUs"
        />
        <MetricCard
          label={`${data.weeks}-Week Demand`}
          value={fmt.format(data.total_demand)}
          sub={`${data.period_start} – ${data.period_end}`}
        />
      </div>

      {/* ── Segment table ── */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="px-5 py-3">Segment</th>
                <th className="px-5 py-3">Method</th>
                <th className="px-5 py-3 text-right">SKUs</th>
                <th className="px-5 py-3 text-right">{data.weeks}-Week Demand</th>
                <th className="w-48 px-5 py-3">% of Demand</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.segments.map((seg) => (
                <tr
                  key={seg.segment}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => {
                    const q = selectedTypes.length === PRODUCT_TYPES.length
                      ? ""
                      : `?types=${encodeURIComponent(selectedTypes.join(","))}`;
                    router.push(`/planning/demand-forecast/segment/${seg.segment}${q}`);
                  }}
                >
                  <td className="px-5 py-3 font-medium">
                    <span className="inline-flex items-center">
                      {seg.name}
                      {SEGMENT_TIPS[seg.segment] && <InfoTooltip text={SEGMENT_TIPS[seg.segment]} />}
                    </span>
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <MethodBadge method={seg.method} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {fmt.format(seg.sku_count)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {fmt.format(seg.demand)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${seg.demand_pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right tabular-nums text-xs text-muted-foreground">
                        {seg.demand_pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Demand concentration ── */}
      <DemandConcentration pareto={data.pareto} />
    </div>
  );
}
