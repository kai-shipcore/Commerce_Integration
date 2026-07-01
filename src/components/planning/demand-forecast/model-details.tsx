"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/i18n-provider";

export function V1Detail() {
  const { pick } = useI18n();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {pick(
          "V1은 현재 Google Sheets 예측 도구와 동일한 공식입니다. 세 가지 독립적인 주문 흐름의 블렌딩된 일별 판매율을 계산하고, 갑작스러운 급등을 완화하는 감쇠 단계를 적용한 후, 계절성 승수를 사용하여 예측 기간에 맞게 확장합니다.",
          "V1 is the same formula used in the current Google Sheets forecasting tool. It computes a blended daily sales rate from three independent order streams, applies a dampening step to smooth sudden spikes, then scales up to the forecast horizon with a seasonal multiplier.",
        )}
      </p>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("1단계 — 세 가지 주문 흐름", "Step 1 — Three order streams")}</p>
        <p className="text-muted-foreground">{pick("주문은 세 개의 독립적인 채널로 분류되어 최종적으로 합산됩니다:", "Orders are split into three non-overlapping channels that are summed at the end:")}</p>
        <ul className="ml-4 space-y-0.5 text-muted-foreground list-disc">
          <li><span className="font-medium text-foreground">West</span> — {pick("일반 판매 + 사전 주문 (Amazon 제외)", "regular sales + preorders (non-Amazon)")}</li>
          <li><span className="font-medium text-foreground">East</span> — {pick("TTM (월별) 주문 + TTM 사전 주문", "TTM (through-the-month) orders + TTM preorders")}</li>
          <li><span className="font-medium text-foreground">FBA</span> — {pick("Amazon FBA 판매만", "Amazon FBA sales only")}</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("2단계 — 가중 블렌딩 (West & East)", "Step 2 — Weighted blend (West & East)")}</p>
        <p className="text-muted-foreground">{pick("각 흐름에 대해 6개의 조회 기간을 계산하여 단일 일별 판매율로 블렌딩합니다:", "For each stream, six lookback windows are computed and blended into a single daily rate:")}</p>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2">{pick("기간", "Window")}</th>
                <th className="px-3 py-2">{pick("유형", "Type")}</th>
                <th className="px-3 py-2 text-right">{pick("가중치", "Weight")}</th>
                <th className="px-3 py-2">{pick("비율 계산식", "Rate formula")}</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono">
              {[
                [pick("90일", "90 days"), pick("판매", "sales"),    "10%", "sum(sales, 90d) / 90"],
                [pick("60일", "60 days"), pick("판매", "sales"),    "15%", "sum(sales, 60d) / 60"],
                [pick("30일", "30 days"), pick("판매", "sales"),    "30%", "sum(sales, 30d) / 30"],
                [pick("15일", "15 days"), pick("판매", "sales"),    "20%", "sum(sales, 15d) / 15"],
                [ pick("7일",  "7 days"), pick("판매", "sales"),    "15%", "sum(sales, 7d) / 7"],
                [pick("30일", "30 days"), pick("사전 주문", "preorder"), "10%", "sum(preorder, 30d) / 30"],
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
        <p className="text-xs text-muted-foreground">
          {pick(
            "블렌딩 비율 = Σ (가중치 × 기간별 비율). FBA는 30일 평균만 사용하며 블렌딩 없음.",
            "Blended rate = Σ (weight × window_rate). FBA uses only a 30-day average with no blending.",
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("3단계 — 감쇠", "Step 3 — Dampening")}</p>
        <p className="text-muted-foreground">
          {pick(
            "갑작스러운 급등이나 급락에 과민 반응하지 않도록 현재 비율을 1주일 전 비율과 비교합니다:",
            "To avoid overreacting to sudden spikes or drops, the current rate is compared to the rate computed one week earlier:",
          )}
        </p>
        <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
          <p>change = |current − prev| / prev</p>
          <p className="mt-1">if change &lt; 50%: rate = 0.1 × prev + 0.9 × current</p>
          <p>if change ≥ 50%: rate = 0.2 × prev + 0.8 × current</p>
        </div>
        <p className="text-xs text-muted-foreground">{pick("FBA는 감쇠 적용 없음.", "FBA is not dampened.")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("4단계 — 예측", "Step 4 — Forecast")}</p>
        <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
          <p>daily_rate = west + east + fba</p>
          <p className="mt-1">forecast = daily_rate × horizon_days × seasonal_modifier</p>
        </div>
        <p className="text-muted-foreground text-xs">
          {pick(
            "계절성 승수는 예측 기간 내 각 월의 날수 비율에 따라 월별 요소(1월 0.75 → 12월 1.30)를 가중 평균하여 계산합니다.",
            "The seasonal modifier is a proportional blend of monthly factors (Jan 0.75 → Dec 1.30) weighted by how many days of the forecast window fall in each month.",
          )}
        </p>
      </div>
    </div>
  );
}

export function StatsForecastDetail() {
  const { pick } = useI18n();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {pick(
          "StatsForecast는 고성능 고전적 시계열 모델 라이브러리입니다. 모든 SKU에 하나의 모델을 적용하는 대신, 각 SKU를 교차 검증으로 개별 평가하여 자체 수요 패턴을 가장 잘 예측하는 모델을 선택합니다.",
          "StatsForecast is a high-performance library of classical time series models. Rather than using one model for all SKUs, each SKU is individually evaluated through cross-validation and assigned the model that best predicts its own demand pattern.",
        )}
      </p>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("SKU별 후보 모델", "Model candidates (per SKU)")}</p>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="px-3 py-2">{pick("모델", "Model")}</th>
                <th className="px-3 py-2">{pick("기능", "What it does")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                ["AutoETS",       pick("지수 평활화 — 최근 관측값과 과거 관측값에 얼마나 가중치를 둘지 학습합니다. 수준, 추세, 계절성을 자동으로 처리합니다.", "Exponential smoothing — learns how much weight to give recent vs. older observations. Handles level, trend, and seasonality automatically.")],
                ["AutoARIMA",     pick("지연값과 예측 오차에 대한 회귀 분석을 수행합니다. 수요의 모멘텀과 자기 상관을 잘 포착합니다.", "Fits a regression on lagged values and forecast errors. Good at capturing momentum and autocorrelation in demand.")],
                ["AutoTheta",     pick("시계열을 장기 추세와 단기 구성요소로 분해합니다. 노이즈가 많거나 변동성이 큰 시계열에 강합니다.", "Decomposes the series into a long-term trend and a short-term component. Often strong for noisy or volatile series.")],
                ["SeasonalNaive", pick("기준선: 지난해 동일 주의 수요를 반복합니다. 높은 계절성 상품에 놀랍도록 경쟁력 있습니다.", "Baseline: repeats last year's corresponding week. Surprisingly competitive for highly seasonal products.")],
                ["Naive",         pick("기준선: 마지막 관측된 주의 수요를 반복합니다 (랜덤 워크). 추세나 계절성 패턴이 없을 때 사용됩니다.", "Baseline: repeats the last observed week's demand (random walk). Used when no trend or seasonal pattern is detectable.")],
                ["WindowAverage", pick("기준선: 최근 고정 기간의 수요를 평균합니다. 단순하지만 강건한 대안입니다.", "Baseline: averages demand over a recent fixed window. A simple but robust fallback.")],
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
        <p className="font-medium">{pick("최적 모델 선택 방법", "How the best model is selected")}</p>
        <p className="text-muted-foreground">
          {pick(
            "각 SKU는 워크포워드 교차 검증으로 평가됩니다: 특정 기준일까지의 과거 데이터로 모델을 학습한 후 다음 13주를 예측하도록 요청하며, 이를 여러 기준일에 걸쳐 반복합니다. 모든 CV 기간에 걸쳐 평균한 ",
            "Each SKU is evaluated using walk-forward cross-validation: the model is fit on historical data up to a cutoff date, then asked to predict the next 13 weeks. This is repeated across several cutoff windows. The model with the lowest ",
          )}
          <span className="font-medium text-foreground">{pick("수평 WAPE", "horizon WAPE")}</span>
          {pick(
            " (전체 13주 기간의 가중 절대 백분율 오차)가 가장 낮은 모델이 선택됩니다. 재입고에는 총 수요 정확도가 중요합니다 — 상쇄되는 주별 오차는 모델에 불리하게 작용하지 않습니다.",
            " (weighted absolute percentage error over the full 13-week window, averaged across all CV windows) is selected. Total demand accuracy is what matters for restocking — per-week errors that cancel out don’t count against the model.",
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">{pick("예측 구간", "Prediction intervals")}</p>
        <p className="text-muted-foreground">
          {pick(
            "충분한 이력이 있는 SKU의 경우, 예측에는 순응형 예측으로 계산된 ",
            "Where the SKU has enough history, the forecast includes a ",
          )}
          <span className="font-medium text-foreground">{pick("P70 신뢰 구간", "P70 confidence band")}</span>
          {pick(
            " (실제 수요를 70% 확률로 포함하는 범위)이 포함됩니다. 구간을 신뢰성 있게 계산할 수 없는 SKU는 점 예측만 표시됩니다.",
            " (the range expected to contain actual demand 70% of the time), computed via conformal prediction. SKUs where the interval can’t be computed reliably show a point forecast only.",
          )}
        </p>
      </div>
    </div>
  );
}

export const MODEL_DETAIL_CONFIG: Record<string, { title: string; content: React.ReactNode }> = {
  StatsForecast: { title: "StatsForecast — How it works", content: <StatsForecastDetail /> },
  V1:            { title: "V1 Formula — How it works",    content: <V1Detail /> },
};

export function ModelInfoButton({ method }: { method: "StatsForecast" | "V1" }) {
  const { pick } = useI18n();
  const [open, setOpen] = React.useState(false);
  const config = MODEL_DETAIL_CONFIG[method];
  const title = method === "StatsForecast"
    ? pick("StatsForecast — 작동 원리", "StatsForecast — How it works")
    : pick("V1 공식 — 작동 원리", "V1 Formula — How it works");
  const label = method === "StatsForecast"
    ? pick("StatsForecast 작동 원리", "How StatsForecast works")
    : pick("V1 작동 원리", "How V1 works");
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {config.content}
        </DialogContent>
      </Dialog>
    </>
  );
}
