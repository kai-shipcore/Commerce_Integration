"use client";

/**
 * Code Guide:
 * The central question: is the model better than the spreadsheet it replaces.
 *
 * The headline is one number, and one number is exactly what invites the wrong
 * conclusion, so the grid underneath is not optional detail. It shows every
 * segment and every window including the cells the spreadsheet still wins,
 * because a comparison that only reports its wins is not evidence.
 *
 * Versions are read from the payload rather than named here. When the current
 * model changes, this file does not.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";
import { SectionHeading } from "./section-heading";
import { AccuracyDriftBanner, PinnedBasisLine } from "./section-basis";
import type {
  AccuracyBasis,
  ValidationCell,
  ValidationComparison,
  ValidationCoverage,
} from "./types";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const nf = new Intl.NumberFormat("en-US");

/** Deltas are current minus baseline, so negative is an improvement. Colour by
 *  direction only. A shaded magnitude scale would imply a precision these
 *  figures do not have, since each cell rests on a different number of SKUs. */
function deltaStyle(delta: number): string {
  if (delta < -0.005) return "text-emerald-600 dark:text-emerald-400";
  if (delta > 0.005) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

/** Bias is a direction, not a severity, so it gets two colour ramps rather than
 *  one. Over-forecasting leaves stock on the shelf; under-forecasting loses the
 *  sale. A single "bad" scale would suggest those cost the same. */
function biasStyle(pp: number): string {
  const m = Math.abs(pp);
  if (m < 2) return "text-muted-foreground";
  if (pp > 0) return m >= 8 ? "text-sky-600 dark:text-sky-400" : "text-sky-500/80";
  return m >= 8 ? "text-amber-600 dark:text-amber-400" : "text-amber-500/80";
}

/**
 * One segment-and-window result.
 *
 * The flat table this replaces repeated the segment on every row and the window
 * on every third, so nine results took nine rows and four columns of labels.
 * As a matrix the labels appear once each on the edges and the cell carries
 * only what differs.
 */
function MatrixCell({
  cell,
  current,
  baseline,
}: {
  cell: ValidationCell | undefined;
  current: string;
  baseline: string;
}) {
  const { pick } = useI18n();
  if (!cell) {
    return <td className="border-l p-2 text-center text-[12.5px] text-muted-foreground">—</td>;
  }

  const value = cell[current];
  const delta = cell.delta;
  const bias = cell.bias_pct;
  const lost = cell.winner === baseline;

  return (
    <td
      className={`border-l p-2 align-top ${
        lost ? "bg-red-50/60 dark:bg-red-950/20" : ""
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold leading-none tabular-nums">
          {typeof value === "number" ? pct(value) : "—"}
        </span>
        {typeof delta === "number" && (
          <span className={`text-[12.5px] font-medium tabular-nums ${deltaStyle(delta)}`}>
            {delta > 0 ? "+" : ""}
            {(delta * 100).toFixed(1)}
            <span className="ml-0.5 font-normal opacity-70">pp</span>
          </span>
        )}
      </div>

      <div className="mt-1 space-y-0.5 text-[11.5px] leading-tight text-muted-foreground">
        <div>
          {baseline} {typeof cell[baseline] === "number" ? pct(cell[baseline] as number) : "—"}
        </div>
        {typeof bias === "number" && (
          <div className={biasStyle(bias)}>
            {bias > 0 ? "+" : ""}
            {bias.toFixed(1)}%{" "}
            {Math.abs(bias) < 2
              ? pick("편향 적음", "balanced")
              : bias > 0
                ? pick("과다 예측", "over")
                : pick("과소 예측", "under")}
          </div>
        )}
        <div className="opacity-80">
          {cell.n_skus ? `${nf.format(cell.n_skus)} SKU` : ""}
          {cell.actual_units
            ? ` · ${nf.format(Math.round(cell.actual_units as number))}u`
            : ""}
        </div>
      </div>
    </td>
  );
}

export function ComparisonSection({
  comparison,
  coverage,
  basis,
}: {
  comparison: ValidationComparison;
  coverage: ValidationCoverage;
  /** Optional: a running API that predates the basis block renders the section
   *  exactly as it did before rather than blanking it. */
  basis?: AccuracyBasis | null;
}) {
  const { pick } = useI18n();
  // `versions` is no longer read: the matrix shows the current model's figure
  // and the baseline underneath it, rather than a column per version. A third
  // version would need a deliberate decision about what a cell shows, not
  // another column appearing on its own.
  const { headline, current, baseline } = comparison;

  // Segments as rows, windows as columns. "All segments" last, because it
  // summarises the rows above it and reading it first encourages stopping there.
  const segments = Array.from(new Set(comparison.grid.map((r) => r.segment))).sort((a, b) => {
    if (a === "TOTAL") return 1;
    if (b === "TOTAL") return -1;
    return a.localeCompare(b);
  });

  const at = (segment: string, window: string) =>
    comparison.grid.find((r) => r.segment === segment && r.window === window);

  const lost = comparison.grid.filter(
    (r) => r.winner && r.winner !== current && r.segment !== "TOTAL",
  );

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id="comparison"
        title={pick("모델 대 스프레드시트", "Model versus spreadsheet")}
        description={pick(
          "가중 절대 백분율 오차(WAPE), 낮을수록 좋습니다. SKU별 오차를 먼저 합산한 뒤 나누므로 수요가 큰 SKU가 더 크게 반영됩니다. 아래 수치는 모두 고정된 백테스트 구간에서 두 방식을 같은 주에 대해 채점한 결과입니다.",
          "Pooled WAPE, lower is better. Errors are summed across SKUs before dividing, so heavier-demand SKUs count more. Both methods are scored on the same weeks of the same backtest windows, so the two figures are directly comparable rather than each measured against its own base.",
        )}
      />

      {/* Directly under the heading, before any figure. A reader who sees the
          numbers first has already formed a view by the time they reach a
          caption explaining what the numbers are of. */}
      <PinnedBasisLine basis={basis} />
      <AccuracyDriftBanner basis={basis} />

      {headline && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("현재 모델", "Current model")} · {current}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums">
              {pct(headline.current)}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {pick("평균 오차", "average error, demand-weighted")}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("기존 방식", "Spreadsheet")} · {baseline}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-muted-foreground">
              {pct(headline.baseline)}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {pick("동일 SKU, 동일 구간", "same SKUs, same windows")}
            </p>
          </div>
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              {pick("오차 감소", "Error reduced by")}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-emerald-700 dark:text-emerald-400">
              {(headline.improvement * 100).toFixed(0)}%
            </div>
            <p className="mt-1 text-[11.5px] text-emerald-700/80 dark:text-emerald-400/80">
              {pick(
                `${headline.cells_total}개 구간 중 ${headline.cells_won}개에서 우세`,
                `ahead in ${headline.cells_won} of ${headline.cells_total} cells`,
              )}
            </p>
            {/* The caveat travels with the number. This is the card that gets
                screenshotted, and three cards away from its coverage note it
                reads as a claim about the whole catalogue.

                The two counts come from different clocks and the sentence now
                says so. `scored` is from the pinned report, `served` is today's
                planning table, and the ratio of the two is not a fact about any
                single moment. Written without the dates it read as one, which
                is how a report left unregenerated across a re-profile showed a
                rising coverage percentage while coverage was in fact falling.
                Dates in the tooltip rather than the card: the caption has to
                stay one line at this size, and the basis line above the cards
                already carries the pinned date in full. */}
            <p
              className="mt-1.5 border-t border-emerald-300/60 pt-1.5 text-[11.5px] leading-snug text-emerald-700/70 dark:border-emerald-800/60 dark:text-emerald-400/70"
              title={pick(
                `측정 기준일 ${coverage.scored_as_of?.slice(0, 10) ?? "기록 없음"} (스냅샷 ${coverage.scored_snapshot ?? "—"}) · 예측 대상 집계일 ${coverage.served_as_of ?? "—"}`,
                `scored ${coverage.scored_as_of?.slice(0, 10) ?? "date not recorded"} on snapshot ${coverage.scored_snapshot ?? "—"} · forecast set counted ${coverage.served_as_of ?? "—"}`,
              )}
            >
              {pick(
                `현재 예측 대상 ${nf.format(coverage.served)}개 중, 고정 구간에서 측정된 ${nf.format(coverage.scored)}개(${Math.round(coverage.share * 100)}%) 기준`,
                `measured on ${nf.format(coverage.scored)} SKUs, of ${nf.format(coverage.served)} forecast today (${Math.round(coverage.share * 100)}%)`,
              )}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/60">
              <th className="w-40 py-2 pl-3 pr-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {pick("세그먼트", "Segment")}
              </th>
              {comparison.windows.map((w) => (
                <th
                  key={w}
                  className="border-l py-2 px-2 text-left text-[12.5px] font-semibold whitespace-nowrap"
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => {
              const total = seg === "TOTAL";
              return (
                <tr key={seg} className={`border-t ${total ? "bg-muted/40" : ""}`}>
                  <th
                    scope="row"
                    className={`py-2 pl-3 pr-2 text-left align-top text-[12.5px] ${
                      total ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {total ? pick("전체", "All segments") : seg}
                  </th>
                  {comparison.windows.map((w) => (
                    <MatrixCell
                      key={w}
                      cell={at(seg, w)}
                      current={current}
                      baseline={baseline}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        {pick(
          `각 칸의 큰 숫자는 ${current} 의 오차이고, 옆의 pp 는 ${baseline} 대비 차이입니다(음수가 개선). 그 아래는 ${baseline} 의 오차와 편향입니다. 편향은 방향이 다르므로 색을 나눴습니다. 과다 예측은 재고가 남고, 과소 예측은 판매를 놓칩니다. 붉은 칸은 ${baseline} 가 앞선 구간입니다.`,
          `The large figure is ${current}'s error; the pp beside it is the difference against ${baseline}, where negative is better. Underneath: ${baseline}'s error, then bias. Bias is coloured by direction rather than size, because over-forecasting leaves stock on the shelf and under-forecasting loses the sale. Shaded cells are where ${baseline} is ahead.`,
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-dashed p-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("기존 방식이 앞서는 곳", "Where the spreadsheet still wins")}
          </p>
          {lost.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {pick("없습니다.", "No cell, on the windows measured.")}
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {lost.map((r) => (
                <li key={`${r.segment}-${r.window}`}>
                  <span className="font-medium text-foreground">{r.segment} · {r.window}</span>
                  {" — "}
                  {pick(
                    `${baseline} ${pct(r[baseline] as number)} 대 ${current} ${pct(r[current] as number)}`,
                    `${baseline} at ${pct(r[baseline] as number)} against ${pct(r[current] as number)}`,
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-dashed p-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("이 비교가 포함하는 범위", "What this comparison covers")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {pick(
              `현재 예측 대상 ${nf.format(coverage.served)}개 SKU 중 ${nf.format(coverage.scored)}개(${Math.round(coverage.share * 100)}%)가 위 수치에 반영되어 있습니다. 나머지 ${nf.format(coverage.unscored)}개는 대부분 간헐 판매에서 승격된 SKU로, 승격 시 학습 시작일이 다시 잡혀 고정된 백테스트 구간에 들어오지 못합니다. 아직 측정되지 않은 것이 아니라 이 방식으로는 측정할 수 없습니다.`,
              `${nf.format(coverage.scored)} of the ${nf.format(coverage.served)} SKUs forecast today (${Math.round(coverage.share * 100)}%) are in the figures above. The other ${nf.format(coverage.unscored)} are mostly SKUs promoted out of intermittent, which resets their training start and leaves them ineligible for windows pinned to a fixed cutoff. That is not measured yet, it is not measurable this way.`,
            )}
          </p>
          {/* The other direction, and the reason it is stated separately.
              `share` cannot express it: a scored SKU that stops being forecast
              leaves the numerator and the denominator at once, so coverage
              creeps upward while the report describes more products that are no
              longer in the forecast set. Only shown when it is happening, since
              a line reading "0 no longer forecast" is noise on a normal week. */}
          {(coverage.scored_not_served ?? 0) > 0 && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {pick(
                `또한 측정 대상이었던 ${nf.format(coverage.scored_not_served ?? 0)}개 SKU는 현재 예측 대상이 아닙니다. 위 수치에는 이들이 포함되어 있으므로, 그만큼은 현재 서비스 중인 대상에 대한 평가가 아닙니다.`,
                `A further ${nf.format(coverage.scored_not_served ?? 0)} SKUs that were scored are no longer forecast at all. They are still inside the figures above, so that much of the comparison describes products the model no longer serves.`,
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
