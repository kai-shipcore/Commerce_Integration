"use client";

/**
 * Code Guide:
 * Performance review: how each stored run scored once its weeks closed.
 *
 * The comparison above is a backtest, run against history the model was tuned
 * on the far side of. This section is the honest version: forecasts that were
 * served before the outcome was known, scored as the weeks settle. It will
 * eventually be the more trustworthy of the two.
 *
 * It is empty until runs accumulate, which is expected rather than broken, so
 * the placeholder says what fills it. Scoring counts only weeks that have
 * finished, so the newest run is measured on very little and `weeks_scored` is
 * shown beside every figure rather than buried.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";
import { EmptySection } from "./empty-section";
import type { PerformanceRow, RunRow } from "./types";

const nf = new Intl.NumberFormat("en-US");
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

export function OverTimeSection({
  runs,
  performance,
  lastCompleteWeek,
}: {
  runs: RunRow[];
  performance: PerformanceRow[];
  lastCompleteWeek: string;
}) {
  const { pick } = useI18n();

  const heading = (
    <div>
      <h2 className="text-base font-semibold">
        {pick("실제 운영 성적", "Performance on forecasts actually served")}
      </h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {pick(
          `저장된 각 예측을 결과가 확정된 주에 대해서만 채점합니다. 현재 확정된 마지막 주는 ${lastCompleteWeek} 입니다.`,
          `Each stored forecast, scored only against weeks that have finished. The last complete week is ${lastCompleteWeek}.`,
        )}
      </p>
    </div>
  );

  if (runs.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <EmptySection
          title={pick(
            "저장된 예측 실행이 아직 없습니다.",
            "No forecast runs stored yet.",
          )}
          waitingOn={pick(
            "주간 예측 파이프라인이 실행될 때마다 예측 내용이 기록되고, 해당 주가 끝나면 실판매와 대조되어 이 표가 채워집니다. 첫 수치는 첫 실행 이후 한 주가 지나면 나타납니다.",
            "Every forward run appends what it predicted. As each of those weeks finishes it is scored against actual sales and appears here. The first figures arrive a week after the first stored run.",
          )}
          detail={pick(
            "위의 비교와 달리 이 수치는 결과를 모르는 상태에서 만든 예측에 대한 것이므로, 시간이 쌓이면 더 신뢰할 수 있는 근거가 됩니다.",
            "Unlike the backtest above, these are forecasts made before the outcome was known, which makes them the stronger evidence once enough have settled.",
          )}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {heading}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/60 text-[9.5px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-3 pr-2 text-left font-medium">{pick("모델", "Model")}</th>
              <th className="py-2 pr-2 text-left font-medium">{pick("실행일", "Run")}</th>
              <th className="py-2 pr-2 text-left font-medium">{pick("세그먼트", "Segment")}</th>
              <th className="py-2 pr-3 text-right font-medium">SKUs</th>
              <th className="py-2 pr-3 text-right font-medium">{pick("채점된 주", "Weeks scored")}</th>
              <th className="py-2 pr-3 text-right font-medium">{pick("실판매", "Actual")}</th>
              <th className="py-2 pr-3 text-right font-medium">WAPE</th>
              <th className="py-2 pr-3 text-right font-medium">{pick("편향", "Bias")}</th>
            </tr>
          </thead>
          <tbody>
            {performance.map((r) => {
              const total = r.segment === "TOTAL";
              return (
                <tr
                  key={`${r.model_version}-${r.forecast_date}-${r.segment}`}
                  className={total ? "border-t bg-muted/40 font-medium" : "border-t"}
                >
                  <td className="py-1.5 pl-3 pr-2 text-[11.5px]">{r.model_version}</td>
                  <td className="py-1.5 pr-2 text-[11.5px] whitespace-nowrap">
                    {r.forecast_date.slice(0, 10)}
                  </td>
                  <td className="py-1.5 pr-2 text-[11.5px]">
                    {total ? pick("전체", "All") : r.segment}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                    {nf.format(r.n_skus)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                    {nf.format(r.weeks_scored)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                    {nf.format(Math.round(r.actual_units))}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11.5px] font-semibold tabular-nums">
                    {pct(r.pooled_wape)}
                  </td>
                  {/* Already in percentage points on the Python side, matching
                      the evaluation module. Do not scale it again here. */}
                  <td className="py-1.5 pr-3 text-right text-[11.5px] tabular-nums">
                    {r.bias_pct === null || !Number.isFinite(r.bias_pct)
                      ? "—"
                      : `${r.bias_pct > 0 ? "+" : ""}${r.bias_pct.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {pick(
          "채점된 주 수가 적은 실행은 그만큼 근거가 얕습니다. 편향은 양수면 과다 예측, 음수면 과소 예측입니다.",
          "A run with few weeks scored rests on correspondingly little evidence. Positive bias means over-forecasting, negative means under.",
        )}
      </p>
    </section>
  );
}
