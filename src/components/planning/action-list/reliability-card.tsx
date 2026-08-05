"use client";

/**
 * Code Guide:
 * Forecast reliability, with the per-window evidence behind the headline.
 *
 * A single error percentage hides the thing a planner most needs: whether the
 * misses run one way or both. The window table is what turns "±37%" into a
 * decision about how far to trust the recommended quantity.
 *
 * Where the error is not measured, the card says so and names the basis rather
 * than presenting an inherited figure as though it belonged to this SKU. Most
 * unmeasured SKUs were promoted from intermittent, which resets their training
 * start and makes them ineligible for every pinned backtest window, so "none"
 * here means not measurable rather than not yet measured.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";
import type { BacktestWindow, SkuComparison } from "./types";

const nf = new Intl.NumberFormat("en-US");

const TIER_STYLE: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  fair: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
  none: "text-neutral-400",
};
const TIER_GLYPH: Record<string, string> = {
  good: "●●●", fair: "●●○", poor: "●○○", none: "○○○",
};

/** Colour a signed miss by direction and severity: warm when the model was
 *  under, cool when it was over. Two directions rather than one severity scale,
 *  because over-forecasting and under-forecasting call for opposite responses. */
function missColour(pct: number): string {
  if (pct < -0.5) return "text-red-500";
  if (pct < -0.25) return "text-orange-500";
  if (pct < -0.1) return "text-yellow-600 dark:text-yellow-500";
  if (pct <= 0.1) return "text-emerald-600 dark:text-emerald-400";
  if (pct <= 0.25) return "text-teal-500";
  if (pct <= 0.5) return "text-sky-500";
  return "text-blue-500";
}

export function ReliabilityCard({
  wape,
  tier,
  errorUsed,
  errorBasis,
  windows,
  orderQty,
  comparison,
}: {
  wape: number | null;
  tier: string;
  errorUsed: number;
  errorBasis: string;
  windows: BacktestWindow[];
  orderQty: number;
  /** This SKU's model against the spreadsheet. Null where either has no scored
   *  window here, which is normal rather than an error. */
  comparison?: SkuComparison | null;
}) {
  const { pick } = useI18n();
  const measured = wape !== null && Number.isFinite(wape);
  // Lower WAPE wins. Ties are possible and read as neither winning, which is
  // the honest rendering of two methods that performed the same.
  const modelWins = comparison ? comparison.model.wape < comparison.baseline.wape : null;

  const basisLabel: Record<string, string> = {
    measured: pick("측정값", "measured"),
    "promoted cohort": pick("승격 SKU 평균", "promoted-SKU cohort"),
    "segment median": pick("세그먼트 중앙값", "segment median"),
  };

  return (
    <div className="flex h-full flex-col rounded-md border p-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pick("예측 신뢰도", "Forecast reliability")}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-mono text-lg ${TIER_STYLE[tier] ?? TIER_STYLE.none}`}>
          {TIER_GLYPH[tier] ?? TIER_GLYPH.none}
        </span>
        <span className="text-3xl font-bold leading-none">
          {measured ? `±${Math.round((wape as number) * 100)}%` : pick("미측정", "not measured")}
        </span>
      </div>

      {measured ? (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {pick(
            `${windows.length}개 백테스트 구간에서 측정된 이 SKU의 평균 오차`,
            `this SKU's own error, measured over ${windows.length} backtest window${windows.length === 1 ? "" : "s"}`,
          )}
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          {pick(
            `이 SKU는 백테스트 대상이 아니어서 자체 오차가 없습니다. 안전재고는 ${basisLabel[errorBasis] ?? errorBasis} ±${Math.round(errorUsed * 100)}% 를 사용합니다.`,
            `No backtest window covers this SKU, so it has no error of its own. Safety stock uses the ${basisLabel[errorBasis] ?? errorBasis}, ±${Math.round(errorUsed * 100)}%.`,
          )}
        </p>
      )}

      {windows.length > 0 && (
        <table className="mt-3 w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 text-left font-medium">{pick("구간", "Window")}</th>
              <th className="pb-1 text-right font-medium">{pick("예측", "Predicted")}</th>
              <th className="pb-1 text-right font-medium">{pick("실제", "Actual")}</th>
              <th className="pb-1 text-right font-medium">{pick("차이", "Miss")}</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w) => {
              const miss = w.y_total ? (w.yhat_total - w.y_total) / w.y_total : null;
              return (
                <tr key={`${w.window}-${w.cutoff}`} className="border-t">
                  <td className="py-1.5 text-[12.5px]">{w.window}</td>
                  <td className="py-1.5 text-right text-[12.5px]">{nf.format(Math.round(w.yhat_total))}</td>
                  <td className="py-1.5 text-right text-[12.5px]">{nf.format(Math.round(w.y_total))}</td>
                  <td className={`py-1.5 text-right text-[12.5px] font-semibold ${miss === null ? "" : missColour(miss)}`}>
                    {miss === null ? "—" : `${miss > 0 ? "+" : ""}${Math.round(miss * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* This SKU against the spreadsheet it replaces.
          The chart below plots both curves and the weekly table lists both
          columns, and until now nothing said which had been closer for THIS
          SKU. The portfolio figure does not answer it: V1's error is
          season-dependent, so an individual SKU can run opposite to the
          aggregate, and on the current report plenty do. Three figures because
          one is not enough: WAPE for how far off, bias for which way, units for
          whether the difference is worth anything. */}
      {comparison && (
        <div className="mt-3 rounded-md border bg-muted/30 p-2">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("이 SKU: 모델 대 스프레드시트", "This SKU: model vs spreadsheet")}
          </p>
          <table className="mt-1.5 w-full border-collapse tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 text-left font-medium">{pick("방식", "Method")}</th>
                <th className="pb-1 text-right font-medium">{pick("오차", "Error")}</th>
                <th className="pb-1 text-right font-medium">{pick("편향", "Bias")}</th>
                <th className="pb-1 text-right font-medium">{pick("빗나간 수량", "Units off")}</th>
              </tr>
            </thead>
            <tbody>
              {([
                [comparison.model, pick("모델", "Model"), modelWins === true],
                [comparison.baseline, pick("스프레드시트", "Spreadsheet"), modelWins === false],
              ] as const).map(([m, label, wins]) => (
                <tr key={m.version} className="border-t">
                  <td className="py-1 text-[12.5px]">
                    {label} <span className="opacity-60">{m.version}</span>
                  </td>
                  <td className={`py-1 text-right text-[12.5px] ${wins ? "font-semibold" : ""}`}>
                    ±{Math.round(m.wape * 100)}%
                  </td>
                  <td className={`py-1 text-right text-[12.5px] ${missColour(m.bias_pct / 100)}`}>
                    {m.bias_pct > 0 ? "+" : ""}{Math.round(m.bias_pct)}%
                  </td>
                  <td className="py-1 text-right text-[12.5px] text-muted-foreground">
                    {nf.format(Math.round(m.ae_units))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {pick(
              `${comparison.windows.join(", ")} 구간, 실판매 ${nf.format(Math.round(comparison.model.actual_units))}개 기준. 두 값 모두 같은 실판매로 나누므로 직접 비교할 수 있습니다.`,
              `Over ${comparison.windows.join(", ")}, against ${nf.format(Math.round(comparison.model.actual_units))} units actually sold. Both errors divide by the same actual, so they compare directly.`,
            )}
            {modelWins === false && (
              <>
                {" "}
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {pick(
                    "이 SKU에서는 기존 스프레드시트가 더 정확했습니다. 포트폴리오 전체 결과와 반대입니다.",
                    "The spreadsheet has been more accurate on this SKU, against the portfolio result.",
                  )}
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Legend for the Miss column. Seven colour steps in two directions is
          more than a reader can infer, and the direction is the part that
          matters: over and under call for opposite responses, so a single
          severity ramp would have implied they cost the same. The Action List
          gives its four reliability tiers a legend for the same reason. */}
      {windows.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="font-medium">{pick("차이", "Miss")}:</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-red-500">●</span>
            {pick("과소 예측 (실제보다 적게)", "under-forecast")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-emerald-600 dark:text-emerald-400">●</span>
            {pick("±10% 이내", "within ±10%")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-blue-500">●</span>
            {pick("과다 예측 (실제보다 많게)", "over-forecast")}
          </span>
          <span className="opacity-70">
            {pick("색이 진할수록 차이가 큽니다.", "deeper colour, larger miss")}
          </span>
        </div>
      )}

      {measured && orderQty > 0 && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          {pick(
            `이 오차 수준에서 실제 필요량은 권장 ${nf.format(orderQty)}개를 중심으로 상당히 달라질 수 있습니다.`,
            `At this error level the real requirement can sit some way either side of the ${nf.format(orderQty)} recommended.`,
          )}
        </p>
      )}
    </div>
  );
}
