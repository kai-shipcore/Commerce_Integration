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
import { V1Detail, StatsForecastDetail, WindowAverageDetail } from "./model-details";
import { useI18n } from "@/lib/i18n/i18n-provider";

const fmt = new Intl.NumberFormat("en-US");

const SEGMENT_TIPS_EN: Record<string, string> = {
  smooth_full:  "SKUs with consistent, predictable sales and at least a year of history. These are your core products — demand is stable enough that a statistical model can reliably forecast week-by-week quantities.",
  smooth_short: "Same consistent demand pattern as Smooth, but with less than a year of sales history. The model is less confident here — forecasts improve automatically as more history accumulates.",
  intermittent: "SKUs that sell sporadically or rarely. Demand is too irregular to forecast week-by-week, so these are managed with a restock policy (e.g. reorder when stock drops below a threshold) rather than a time series model.",
};
const SEGMENT_TIPS_KO: Record<string, string> = {
  smooth_full:  "일관되고 예측 가능한 판매 패턴을 가진 최소 1년 이상의 이력이 있는 SKU입니다. 핵심 제품으로, 수요가 충분히 안정적이어서 통계 모델이 주별 수량을 신뢰성 있게 예측할 수 있습니다.",
  smooth_short: "스무스와 동일한 일관된 수요 패턴을 보이지만, 1년 미만의 판매 이력을 가집니다. 확신도가 낮으며, 이력이 쌓일수록 예측 정확도가 자동으로 향상됩니다.",
  intermittent: "산발적으로 또는 드물게 판매되는 SKU입니다. 수요가 너무 불규칙하여 주별 예측이 어려우므로, 시계열 모델 대신 재입고 정책(예: 재고가 임계값 이하로 떨어지면 재주문)으로 관리됩니다.",
};

const METHOD_TIPS_EN: Record<string, string> = {
  "StatsForecast": "A library of statistical time series models (ETS, ARIMA, Theta, etc.). The best-fitting model is selected per SKU through cross-validation, then refit on all available data to produce the forward forecast.",
  "V1":            "A simpler fallback model used when a SKU doesn't have enough history to run full cross-validation. It produces a reasonable baseline forecast that gets replaced by a StatsForecast model once enough data accumulates.",
  "WindowAverage": "Averages the last 8 weeks of sales and repeats that value for each forecast week. Used when a SKU doesn't have enough history to run full cross-validation; replaced by a StatsForecast model once enough data accumulates.",
  "Restock policy": "No time series forecast is generated. Instead, stock is replenished reactively — typically when on-hand inventory drops below a set threshold. Suitable for slow-moving or unpredictable items where a forecast would be unreliable.",
};
const METHOD_TIPS_KO: Record<string, string> = {
  "StatsForecast": "통계적 시계열 모델 라이브러리(ETS, ARIMA, Theta 등)입니다. 교차 검증을 통해 SKU별 최적 모델을 선택한 후, 전체 데이터로 재학습하여 포워드 예측을 생성합니다.",
  "V1":            "SKU의 이력이 충분하지 않아 전체 교차 검증을 수행하기 어려울 때 사용하는 간단한 기준 모델입니다. 데이터가 충분히 쌓이면 StatsForecast 모델로 자동으로 교체됩니다.",
  "WindowAverage": "최근 8주 판매량의 평균을 계산하여 예측 기간의 매주에 동일하게 적용합니다. SKU의 이력이 부족해 전체 교차 검증을 수행하기 어려울 때 사용하며, 데이터가 충분히 쌓이면 StatsForecast 모델로 자동으로 교체됩니다.",
  "Restock policy": "시계열 예측을 생성하지 않습니다. 대신 현재고가 특정 임계값 이하로 떨어지면 재입고하는 반응적 방식으로 관리됩니다. 느리게 움직이거나 수요가 예측 불가능한 제품에 적합합니다.",
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

const METHOD_DETAILS: Record<string, { title: string; content: React.ReactNode }> = {
  "StatsForecast": { title: "StatsForecast — How it works",  content: <StatsForecastDetail /> },
  "V1":            { title: "V1 Formula — How it works",     content: <V1Detail /> },
  "WindowAverage": { title: "Window Average — How it works", content: <WindowAverageDetail /> },
};

function MethodBadge({ method }: { method: string }) {
  const { pick, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const detail = METHOD_DETAILS[method];
  const METHOD_TIPS = locale === "ko" ? METHOD_TIPS_KO : METHOD_TIPS_EN;
  const dialogTitle = method === "StatsForecast"
    ? pick("StatsForecast — 작동 원리", "StatsForecast — How it works")
    : method === "V1"
    ? pick("V1 공식 — 작동 원리", "V1 Formula — How it works")
    : method === "WindowAverage"
    ? pick("Window Average — 작동 원리", "Window Average — How it works")
    : method;
  const methodLabel = method === "Restock policy" ? pick("재입고 정책", "Restock policy") : method;

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
        {methodLabel}
        {METHOD_TIPS[method] && <InfoTooltip text={METHOD_TIPS[method]} onClick={detail ? handleOpen : undefined} />}
      </span>
      {detail && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
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
  WindowAverage:    "bg-violet-50 text-violet-700 border border-violet-200",
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
      { segment: "smooth_short", name: "Smooth / Short history",  method: "WindowAverage",  sku_count: 0, demand: 0, demand_pct: 0 },
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

export function SegmentationOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const { pick, locale } = useI18n();
  const SEGMENT_TIPS = locale === "ko" ? SEGMENT_TIPS_KO : SEGMENT_TIPS_EN;
  const SEGMENT_NAMES: Record<string, string> = {
    smooth_full:  pick("스무스", "Smooth"),
    smooth_short: pick("스무스 / 단기", "Smooth / Short history"),
    intermittent: pick("비정기", "Intermittent"),
  };
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
  }, [weeks, selectedTypes, serverReady, refreshKey]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {pick("세그멘테이션 데이터 로드 실패:", "Failed to load segmentation data:")} {error}
      </div>
    );
  }

  if (!serverReady && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {pick("예측 서버에 연결 중…", "Connecting to forecast server…")}
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
          <span className="w-28 shrink-0 text-sm text-muted-foreground">{pick("조회 기간:", "Lookback window:")}</span>
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
                {w}{pick("주", "W")}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={104}
            placeholder={pick("직접 입력", "custom")}
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
          <span className="w-28 shrink-0 text-sm text-muted-foreground">{pick("제품 유형:", "Product type:")}</span>
          <div className="flex flex-wrap gap-2">
            <ToggleBtn
              active={selectedTypes.length === PRODUCT_TYPES.length}
              onClick={() =>
                setSelectedTypes(
                  selectedTypes.length === PRODUCT_TYPES.length ? [] : [...PRODUCT_TYPES]
                )
              }
            >
              {pick("전체", "All")}
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
          label={pick("전체 SKU", "Total SKUs")}
          value={fmt.format(data.total_skus)}
        />
        <MetricCard
          label={pick("예측된 SKU", "Forecasted SKUs")}
          value={fmt.format(data.forecasted_skus)}
          sub={pick(`전체의 ${data.forecasted_pct}%`, `${data.forecasted_pct}% of total`)}
        />
        <MetricCard
          label={pick("수요 커버리지", "Demand Coverage")}
          value={`${data.forecasted_demand_pct}%`}
          sub={pick("예측된 SKU의 수요 비율", "of demand from forecasted SKUs")}
        />
        <MetricCard
          label={pick(`${data.weeks}주 수요`, `${data.weeks}-Week Demand`)}
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
                <th className="px-5 py-3">{pick("세그먼트", "Segment")}</th>
                <th className="px-5 py-3">{pick("방법", "Method")}</th>
                <th className="px-5 py-3 text-right">SKU</th>
                <th className="px-5 py-3 text-right">{pick(`${data.weeks}주 수요`, `${data.weeks}-Week Demand`)}</th>
                <th className="w-48 px-5 py-3">{pick("수요 비율", "% of Demand")}</th>
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
                      {SEGMENT_NAMES[seg.segment] ?? seg.name}
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
