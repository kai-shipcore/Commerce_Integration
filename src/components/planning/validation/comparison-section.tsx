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
import type { ValidationCell, ValidationComparison, ValidationCoverage } from "./types";

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

function Cell({ row, versions }: { row: ValidationCell; versions: string[] }) {
  const total = row.segment === "TOTAL";
  return (
    <tr className={total ? "border-t bg-muted/40 font-medium" : "border-t"}>
      <td className="py-1.5 pl-3 pr-2 text-[11.5px] whitespace-nowrap">
        {total ? "All segments" : row.segment}
      </td>
      <td className="py-1.5 pr-2 text-[11.5px] whitespace-nowrap">{row.window}</td>
      <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
        {row.n_skus === undefined || row.n_skus === null ? "—" : nf.format(row.n_skus)}
      </td>
      <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
        {row.actual_units === undefined || row.actual_units === null
          ? "—"
          : nf.format(Math.round(row.actual_units as number))}
      </td>
      {versions.map((v) => {
        const value = row[v];
        const best = row.winner === v;
        return (
          <td
            key={v}
            className={`py-1.5 pr-3 text-right text-[11.5px] tabular-nums ${best ? "font-semibold" : ""}`}
          >
            {typeof value === "number" ? pct(value) : "—"}
          </td>
        );
      })}
      <td className={`py-1.5 pr-3 text-right text-[11.5px] font-semibold tabular-nums ${
        typeof row.delta === "number" ? deltaStyle(row.delta) : ""
      }`}>
        {typeof row.delta === "number"
          ? `${row.delta > 0 ? "+" : ""}${(row.delta * 100).toFixed(1)}`
          : "—"}
      </td>
    </tr>
  );
}

export function ComparisonSection({
  comparison,
  coverage,
}: {
  comparison: ValidationComparison;
  coverage: ValidationCoverage;
}) {
  const { pick } = useI18n();
  const { headline, versions, current, baseline } = comparison;

  const rows = [...comparison.grid].sort((a, b) => {
    // "All segments" last: it is a summary of the rows above it, and reading it
    // first encourages stopping there.
    const at = a.segment === "TOTAL" ? 1 : 0;
    const bt = b.segment === "TOTAL" ? 1 : 0;
    if (at !== bt) return at - bt;
    if (a.segment !== b.segment) return a.segment.localeCompare(b.segment);
    return comparison.windows.indexOf(a.window) - comparison.windows.indexOf(b.window);
  });

  const lost = rows.filter((r) => r.winner && r.winner !== current && r.segment !== "TOTAL");

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">
          {pick("모델 대 스프레드시트", "Model versus spreadsheet")}
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {pick(
            "가중 절대 백분율 오차(WAPE), 낮을수록 좋습니다. SKU별 오차를 먼저 합산한 뒤 나누므로 수요가 큰 SKU가 더 크게 반영됩니다.",
            "Pooled WAPE, lower is better. Errors are summed across SKUs before dividing, so heavier-demand SKUs count more.",
          )}
        </p>
      </div>

      {headline && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("현재 모델", "Current model")} · {current}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums">
              {pct(headline.current)}
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {pick("평균 오차", "average error, demand-weighted")}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("기존 방식", "Spreadsheet")} · {baseline}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-muted-foreground">
              {pct(headline.baseline)}
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {pick("동일 SKU, 동일 구간", "same SKUs, same windows")}
            </p>
          </div>
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              {pick("오차 감소", "Error reduced by")}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-emerald-700 dark:text-emerald-400">
              {(headline.improvement * 100).toFixed(0)}%
            </div>
            <p className="mt-1 text-[10.5px] text-emerald-700/80 dark:text-emerald-400/80">
              {pick(
                `${headline.cells_total}개 구간 중 ${headline.cells_won}개에서 우세`,
                `ahead in ${headline.cells_won} of ${headline.cells_total} cells`,
              )}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/60 text-[9.5px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-3 pr-2 text-left font-medium">{pick("세그먼트", "Segment")}</th>
              <th className="py-2 pr-2 text-left font-medium">{pick("구간", "Window")}</th>
              <th className="py-2 pr-3 text-right font-medium">SKUs</th>
              <th className="py-2 pr-3 text-right font-medium">{pick("실판매", "Actual")}</th>
              {versions.map((v) => (
                <th key={v} className="py-2 pr-3 text-right font-medium">{v}</th>
              ))}
              <th className="py-2 pr-3 text-right font-medium">{pick("차이 (pp)", "Delta (pp)")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Cell key={`${r.segment}-${r.window}`} row={r} versions={versions} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-dashed p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("기존 방식이 앞서는 곳", "Where the spreadsheet still wins")}
          </p>
          {lost.length === 0 ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {pick("없습니다.", "No cell, on the windows measured.")}
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-[11.5px] leading-relaxed text-muted-foreground">
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
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick("이 비교가 포함하는 범위", "What this comparison covers")}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {pick(
              `예측 대상 ${nf.format(coverage.served)}개 SKU 중 ${nf.format(coverage.scored)}개(${Math.round(coverage.share * 100)}%)만 위 수치에 반영되어 있습니다. 나머지 ${nf.format(coverage.unscored)}개는 대부분 간헐 판매에서 승격된 SKU로, 승격 시 학습 시작일이 다시 잡혀 고정된 백테스트 구간에 들어오지 못합니다. 아직 측정되지 않은 것이 아니라 이 방식으로는 측정할 수 없습니다.`,
              `${nf.format(coverage.scored)} of the ${nf.format(coverage.served)} forecast SKUs (${Math.round(coverage.share * 100)}%) are in the figures above. The other ${nf.format(coverage.unscored)} are mostly SKUs promoted out of intermittent, which resets their training start and leaves them ineligible for windows pinned to a fixed cutoff. That is not measured yet, it is not measurable this way.`,
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
