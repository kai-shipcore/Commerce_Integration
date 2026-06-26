"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemandConcentration, type ParetoData, type SegmentThreshold } from "./demand-concentration";

const fmt = new Intl.NumberFormat("en-US");

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

export function SegmentationOverview() {
  const router = useRouter();
  const [weeks, setWeeks] = useState(10);
  const [customInput, setCustomInput] = useState("");
  const [serverReady, setServerReady] = useState(false);
  const [data, setData] = useState<SegmentationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wait for the forecast server (started by the layout) to be ready
  useEffect(() => {
    let cancelled = false;
    async function waitForServer() {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const res = await fetch("/api/forecast-server/start", { method: "POST" });
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

  // Fetch segmentation data once server is ready, re-fetch on weeks change
  useEffect(() => {
    if (!serverReady) return;
    setData(null);
    fetch(`/api/forecast/segmentation?weeks=${weeks}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json as SegmentationData);
      })
      .catch((err: Error) => setError(err.message));
  }, [weeks, serverReady]);

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
      {/* ── Week selector ── */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Lookback window:</span>
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
                  onClick={() => router.push(`/planning/demand-forecast/segment/${seg.segment}`)}
                >
                  <td className="px-5 py-3 font-medium">{seg.name}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        METHOD_STYLES[seg.method] ?? "bg-muted text-muted-foreground border"
                      }`}
                    >
                      {seg.method}
                    </span>
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
      <DemandConcentration pareto={data.pareto} thresholds={(() => {
        let cum = 0;
        return data.segments.map((seg): SegmentThreshold => {
          const start_pct = cum / data.total_skus * 100;
          cum += seg.sku_count;
          return { segment: seg.segment, name: seg.name, start_pct, end_pct: Math.min(100, cum / data.total_skus * 100) };
        });
      })()} />
    </div>
  );
}
