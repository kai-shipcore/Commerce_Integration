"use client";

/**
 * Code Guide:
 * Per-SKU extremes behind the pooled figures.
 *
 * A pooled metric is a portfolio statement and says nothing about any single
 * SKU. These two lists are where the aggregate comes apart: the SKUs the model
 * handles far better than the spreadsheet, and the ones where it is worse. The
 * second list matters more, because it is the one a planner will be burned by,
 * and each row links through to the SKU so the reason can be looked at.
 *
 * The minimum-volume control is the point of the section, not a convenience.
 * Rows rank by the difference between two per-SKU WAPEs, and both are divided by
 * the same actual, so the difference is bounded by that denominator: on the
 * 2026-07-30 report the largest absolute delta is 4.94 below 50 units against
 * 0.48 above 500. Ranking the unfiltered pool therefore sorts by smallness, and
 * the thirty rows it surfaces carry 1.8% of scored demand beneath a headline
 * that is demand-weighted. The threshold is a judgement rather than a fact, so
 * it is shown, moveable, and always stated alongside what it leaves.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { OutlierRow, ValidationOutliers } from "./types";

const nf = new Intl.NumberFormat("en-US");
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—");

/** Selectable minimums, in units over a scored window. 0 is kept so the
 *  unfiltered view stays reachable: it is what the section used to show, and
 *  removing it would make the filtered lists impossible to check against it. */
const MIN_UNITS_PRESETS = [0, 100, 200, 300, 500];

function OutlierTable({
  rows,
  title,
  note,
  tone,
}: {
  rows: OutlierRow[];
  title: string;
  note: string;
  tone: "good" | "bad";
}) {
  const { pick } = useI18n();
  const accent = tone === "good"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";

  return (
    <div className="flex min-w-0 flex-col rounded-md border">
      <div className="border-b px-3 py-2">
        <p className="text-[11px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">{note}</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-[11.5px] text-muted-foreground">
          {pick("해당 SKU가 없습니다.", "No SKU falls in this group.")}
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted text-[9.5px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pl-3 pr-2 text-left font-medium">SKU</th>
                <th className="py-1.5 pr-2 text-left font-medium">{pick("구간", "Window")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{pick("실판매", "Units")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{pick("모델", "Model")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">V1</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.unique_id}-${r.window}`} className="border-t hover:bg-muted/40">
                  <td className="py-1.5 pl-3 pr-2 text-[11px]">
                    <Link
                      href={`/planning/action-list/${encodeURIComponent(r.unique_id)}`}
                      className="hover:text-sky-600 hover:underline dark:hover:text-sky-400"
                    >
                      {r.unique_id}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-[11px] whitespace-nowrap text-muted-foreground">
                    {r.window}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
                    {nf.format(Math.round(r.y_total_cur))}
                  </td>
                  <td className={`py-1.5 pr-2 text-right text-[11px] font-semibold tabular-nums ${accent}`}>
                    {pct(r.wape_cur)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                    {pct(r.wape_base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OutliersSection({
  outliers,
  baseline,
}: {
  outliers: ValidationOutliers;
  baseline: string;
}) {
  const { pick } = useI18n();
  const { rows, top_n: topN, default_min_units: defaultMin, scored_units: scoredUnits } = outliers;

  // Seeded from the endpoint rather than a literal here, so the default is
  // stated in exactly one place and the two cannot drift apart.
  const [minUnits, setMinUnits] = useState(defaultMin);

  const { worst, best, eligible, listUnits } = useMemo(() => {
    const eligible = rows.filter((r) => r.y_total_cur >= minUnits);
    // Sorted copies: the endpoint sends the pool in delta order, but relying on
    // that would make this silently wrong the day the endpoint stops sorting.
    const byDelta = [...eligible].sort((a, b) => b.delta - a.delta);
    const worst = byDelta.slice(0, topN);
    const best = byDelta.slice(-topN).reverse();
    const sum = (xs: OutlierRow[]) => xs.reduce((t, r) => t + r.y_total_cur, 0);
    return { worst, best, eligible, listUnits: sum(worst) + sum(best) };
  }, [rows, minUnits, topN]);

  // What the two lists on screen actually account for. The headline above this
  // section is demand-weighted, so without this a reader has no way to tell
  // whether they are looking at most of the portfolio or a rounding error.
  const listShare = scoredUnits > 0 ? listUnits / scoredUnits : 0;
  const eligibleUnits = eligible.reduce((t, r) => t + r.y_total_cur, 0);
  const eligibleShare = scoredUnits > 0 ? eligibleUnits / scoredUnits : 0;

  // Both lists come from one pool, so when it holds fewer than 2 x topN rows they
  // overlap and the same SKU appears as a win and a loss. Saying so is better
  // than either silently splitting the pool or dropping rows.
  const overlapping = eligible.length > 0 && eligible.length < topN * 2;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{pick("SKU 단위 편차", "Where it breaks down")}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {pick(
            "합산 오차는 포트폴리오 전체에 대한 진술이며 개별 SKU를 보장하지 않습니다. 아래는 그 평균이 가장 크게 갈리는 지점입니다.",
            `The pooled figure is a statement about the portfolio, not a promise about any SKU. These are the rows where it diverges most from ${baseline}.`,
          )}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium">
            {pick("최소 판매량", "Minimum volume")}
          </span>
          <div className="flex flex-wrap gap-1">
            {MIN_UNITS_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setMinUnits(v)}
                aria-pressed={minUnits === v}
                className={`rounded border px-2 py-0.5 text-[10.5px] tabular-nums transition-colors ${
                  minUnits === v
                    ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                    : "border-transparent text-muted-foreground hover:bg-muted"
                }`}
              >
                {v === 0 ? pick("전체", "No minimum") : `${nf.format(v)}+`}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          {pick(
            `구간별 실판매 ${nf.format(minUnits)}units 이상만 순위에 포함합니다. 대상 ${nf.format(eligible.length)}/${nf.format(rows.length)}행, 채점 수요의 ${(eligibleShare * 100).toFixed(0)}%. 아래 두 표는 채점 수요의 ${(listShare * 100).toFixed(1)}%를 차지합니다.`,
            `Ranking only rows that sold at least ${nf.format(minUnits)} units in their window: ${nf.format(eligible.length)} of ${nf.format(rows.length)} scored rows, ${(eligibleShare * 100).toFixed(0)}% of scored demand. The two lists below carry ${(listShare * 100).toFixed(1)}% of it.`,
          )}
          {minUnits === 0 && (
            <>
              {" "}
              <span className="text-amber-600 dark:text-amber-400">
                {pick(
                  "최소 판매량이 없으면 분모가 작은 SKU가 상위를 차지합니다. 순위는 오차가 아니라 판매량 규모를 반영합니다.",
                  "With no minimum, a small denominator lets the difference swing freely, so the ranking reflects size rather than error.",
                )}
              </span>
            </>
          )}
          {overlapping && (
            <>
              {" "}
              <span className="text-amber-600 dark:text-amber-400">
                {pick(
                  `대상이 ${nf.format(topN * 2)}행 미만이라 두 표에 같은 SKU가 나타날 수 있습니다.`,
                  `Fewer than ${nf.format(topN * 2)} rows are eligible, so a SKU can appear in both lists.`,
                )}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <OutlierTable
          rows={worst}
          tone="bad"
          title={pick("모델이 더 나쁜 SKU", "Model does worse")}
          note={pick(
            "재고 판단에 직접 영향을 주므로 먼저 확인할 대상입니다.",
            "The list to read first: these are where trusting the model costs more than trusting the sheet.",
          )}
        />
        <OutlierTable
          rows={best}
          tone="good"
          title={pick("모델이 더 나은 SKU", "Model does better")}
          note={pick(
            "기존 방식 대비 개선폭이 가장 큰 SKU입니다.",
            "The largest improvements over the spreadsheet method.",
          )}
        />
      </div>
    </section>
  );
}
