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
 *
 * A scrolling list of runs, newest first, with the selected one shown in full
 * below it.
 *
 * This gains a run a week and never stops, so the layout has to hold hundreds.
 * A row per run does that once the list scrolls inside a fixed height rather
 * than growing the page, which is the same thing the action list does with its
 * own table. Two earlier attempts here were wrong in opposite directions: a flat
 * table of one row per run per segment, 36 rows for six runs, which multiplies;
 * then a horizontal strip of one bar per run, which scales but throws away
 * everything a row can carry and pushes the dates into 9px labels nobody can
 * read at fifty runs.
 *
 * The trend does not need its own shape. A bar drawn inside the error cell,
 * scaled against the worst run, reads down the column while every figure beside
 * it stays legible. That is one dimension of chart in a layout that is otherwise
 * a list, which is what this data is.
 *
 * Newest first, because this is a history and the question on opening it is how
 * the last run went. Selection defaults there for the same reason.
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { SectionHeading } from "./section-heading";
import { EmptySection } from "./empty-section";
import type { PerformanceRow, RunRow } from "./types";

const nf = new Intl.NumberFormat("en-US");
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

/** Bias is a direction, not a severity, so two ramps rather than one. Copied in
 *  spirit from the comparison grid on the same page, and for the same reason:
 *  over-forecasting leaves stock on the shelf, under-forecasting loses the sale,
 *  and one "bad" scale would suggest those cost the same. */
function biasStyle(pp: number): string {
  const m = Math.abs(pp);
  if (m < 2) return "text-muted-foreground";
  if (pp > 0) return m >= 8 ? "text-sky-600 dark:text-sky-400" : "text-sky-500/80";
  return m >= 8 ? "text-amber-600 dark:text-amber-400" : "text-amber-500/80";
}

export function OverTimeSection({
  runs,
  performance,
  lastCompleteWeek,
  currentVersion,
}: {
  runs: RunRow[];
  performance: PerformanceRow[];
  lastCompleteWeek: string;
  /** The model behind the forecast currently served. Rows from anything else
   *  are not this model's record, and on a fresh store they are the seeded
   *  fixture. */
  currentVersion?: string | null;
}) {
  const { pick } = useI18n();

  // Versions in the table that are not the served model.
  //
  // The heading says these are forecasts served before the outcome was known,
  // which is the strongest claim on the page, and until now the table rendered
  // whatever the store held without qualifying it. On a store holding only the
  // seeded fixture that meant fabricated figures under that heading, reading
  // about half the real error, with the version string in a small first column
  // as the only tell. The chart above has carried this warning since the seed
  // script was written; the table below it never did.
  const foreign = currentVersion
    ? Array.from(new Set(performance.map((r) => r.model_version))).filter(
        (v) => v !== currentVersion,
      )
    : [];

  const { segments, byRun } = useMemo(() => {
    // Columns from the union across runs rather than from the first one, so a
    // segment that appears or empties between runs does not silently drop.
    // TOTAL last, matching the grid above: it summarises the columns beside it,
    // and reading it first encourages stopping there.
    const segs = Array.from(new Set(performance.map((r) => r.segment))).sort((a, b) => {
      if (a === "TOTAL") return 1;
      if (b === "TOTAL") return -1;
      return a.localeCompare(b);
    });

    // One entry per (version, run date). Keyed on both because a store can hold
    // two versions for the same date, which is exactly the seeded-fixture case,
    // and collapsing them would average two models into one row.
    const runsMap = new Map<
      string,
      { version: string; date: string; weeks: number; cells: Map<string, PerformanceRow> }
    >();
    for (const r of performance) {
      const date = r.week_of.slice(0, 10);
      const key = `${r.model_version}|${date}`;
      let entry = runsMap.get(key);
      if (!entry) {
        entry = { version: r.model_version, date, weeks: r.weeks_scored, cells: new Map() };
        runsMap.set(key, entry);
      }
      // Weeks scored is a property of the run, not of a segment: every segment
      // in a run closes the same weeks. It moved to the row header rather than
      // being printed once per cell.
      entry.weeks = Math.max(entry.weeks, r.weeks_scored);
      entry.cells.set(r.segment, r);
    }
    // Newest first: this is a history, and the question on opening it is how the
    // last run went.
    const rows = [...runsMap.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || a.version.localeCompare(b.version),
    );
    return { segments: segs, byRun: rows };
  }, [performance]);

  // Which run the detail panel describes. Held by key rather than index so it
  // survives a refetch that prepends history, and resolved against the current
  // list on every render so a selection that no longer exists falls back to the
  // newest run rather than blanking the panel.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const keyOf = (r: { version: string; date: string }) => `${r.version}|${r.date}`;
  const selected = byRun.find((r) => keyOf(r) === selectedKey) ?? byRun[0] ?? null;

  // Bars are scaled against the worst run rather than against zero-to-one, so
  // the differences between runs stay visible. WAPE clusters in a narrow band
  // once a model settles, and a full-scale axis would flatten every bar to the
  // same nub.
  const worst = Math.max(
    ...byRun.map((r) => r.cells.get("TOTAL")?.pooled_wape ?? 0),
    0.0001,
  );

  const heading = (
    <SectionHeading
      id="over-time"
      title={pick("실제 운영 성적", "Performance on forecasts actually served")}
      description={pick(
        `저장된 각 예측을 결과가 확정된 주에 대해서만 채점합니다. 현재 확정된 마지막 주는 ${lastCompleteWeek} 입니다. 위 백테스트와 달리 여기에는 사후 판단이 개입할 여지가 없습니다. 각 행은 그 주에 실제로 내보낸 예측이며, 시간이 지날수록 근거가 쌓입니다.`,
        `Each stored forecast, scored only against weeks that have finished. The last complete week is ${lastCompleteWeek}. Unlike the backtest above, nothing here was chosen after the fact: every row is a forecast that was actually issued that week, and the evidence accumulates on its own as weeks complete.`,
      )}
    />
  );

  // Stored but not yet scorable, which is every run's first week and will be the
  // state the Monday after the first real run lands. `runs` earns its place
  // here: without it this case is indistinguishable from having no runs at all,
  // and the section would render an empty matrix under a heading promising
  // results.
  if (runs.length > 0 && byRun.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <EmptySection
          title={pick(
            `${runs.length}개 실행이 저장되었으나 아직 채점할 수 있는 주가 없습니다.`,
            `${runs.length} run${runs.length === 1 ? "" : "s"} stored, none scorable yet.`,
          )}
          waitingOn={pick(
            `예측은 앞으로의 주에 대한 것이므로, 그 주가 끝나야 실판매와 대조할 수 있습니다. 현재 확정된 마지막 주는 ${lastCompleteWeek} 이며, 그 이후 주가 끝나는 대로 이 표가 채워집니다.`,
            `A forecast is about weeks ahead, so it cannot be scored until those weeks finish. The last complete week is ${lastCompleteWeek}; figures appear here as the weeks after it close.`,
          )}
        />
      </section>
    );
  }

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
      {foreign.length > 0 && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">
            {pick("이 표에는 샘플 데이터가 포함되어 있습니다.", "This table contains sample data.")}
          </span>{" "}
          {pick(
            `${foreign.join(", ")} 의 행은 현재 모델 ${currentVersion} 의 실제 실행 기록이 아닙니다. 실제 실행이 쌓이기 전에 이 화면을 확인할 수 있도록 만들어 넣은 값이므로 정확도를 판단하는 데 쓰면 안 됩니다. 실제 실행이 저장되면 자동으로 대체됩니다.`,
            `Rows from ${foreign.join(", ")} are not real runs of the current model (${currentVersion}). They were fabricated so this section could be reviewed before runs accumulate, and say nothing about accuracy. They are replaced automatically once real runs are stored.`,
          )}
        </div>
      )}
      {/* Fixed height with internal scroll, so a hundred runs is a scrollbar
          rather than a longer page. Sized to show about ten rows, which is a
          quarter of a year at one run a week. */}
      <div className="max-h-[22rem] overflow-y-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-3 pr-2 text-left font-medium">{pick("실행", "Run")}</th>
              <th className="py-2 pr-3 text-right font-medium">{pick("채점된 주", "Weeks")}</th>
              <th className="py-2 pr-3 text-left font-medium">
                {pick("전체 오차 (WAPE)", "Error, all segments")}
              </th>
              <th className="py-2 pr-3 text-right font-medium">{pick("편향", "Bias")}</th>
              <th className="py-2 pr-3 text-right font-medium">SKUs</th>
            </tr>
          </thead>
          <tbody>
            {byRun.map((run) => {
              const total = run.cells.get("TOTAL");
              const w = total?.pooled_wape ?? null;
              const bias = total?.bias_pct ?? null;
              const hasBias = bias !== null && Number.isFinite(bias);
              const isSel = selected != null && keyOf(run) === keyOf(selected);
              const isForeign = run.version !== currentVersion;
              return (
                // Reachable by keyboard, not only by pointer. A row that selects
                // on click and does nothing on Enter is the defect the action
                // list's sortable headers still have, and there is no reason to
                // write it again here.
                <tr
                  key={keyOf(run)}
                  tabIndex={0}
                  onClick={() => setSelectedKey(keyOf(run))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedKey(keyOf(run));
                    }
                  }}
                  aria-selected={isSel}
                  className={`cursor-pointer border-t transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-inset ${
                    isSel ? "bg-sky-50 dark:bg-sky-950/50" : "hover:bg-muted/50"
                  }`}
                >
                  <td className="py-2 pl-3 pr-2">
                    <span className={`text-[12.5px] tabular-nums ${isSel ? "font-semibold" : ""}`}>
                      {run.date}
                    </span>
                    {isForeign && (
                      <span className="ml-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">
                        {run.version}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {run.weeks}
                  </td>
                  {/* The trend, drawn where the number already is. A bar scaled
                      against the worst run reads down the column without the
                      figures beside it losing any room. Scaled against that
                      worst rather than zero-to-one because pooled WAPE clusters
                      narrowly once a model settles, and a full-scale axis would
                      flatten every bar to the same nub. */}
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-sm bg-muted">
                        <span
                          className={`block h-full rounded-sm ${
                            isSel ? "bg-sky-500" : "bg-muted-foreground/40"
                          }`}
                          style={{ width: `${Math.max(3, ((w ?? 0) / worst) * 100)}%` }}
                        />
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums">{pct(w)}</span>
                    </div>
                  </td>
                  <td
                    className={`py-2 pr-3 text-right text-[12.5px] tabular-nums ${
                      hasBias ? biasStyle(bias) : "text-muted-foreground"
                    }`}
                  >
                    {hasBias ? `${bias > 0 ? "+" : ""}${bias.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {total ? nf.format(total.n_skus) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="-mt-1 text-[11.5px] text-muted-foreground">
        {pick(
          `최신 실행이 위에 있습니다. 행을 클릭하면 아래에 해당 실행의 세그먼트별 상세가 나옵니다. 총 ${byRun.length}개 실행.`,
          `Newest first. Click a row for that run's per-segment detail below. ${byRun.length} run${byRun.length === 1 ? "" : "s"} stored.`,
        )}
      </p>

      {/* The selected run in full. This is where the figures a table had to
          compress get room: every segment, with the SKU count and the units
          behind each error rather than hidden on hover. */}
      {selected && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-[14px] font-semibold">
              {pick(`${selected.date} 실행`, `Run of ${selected.date}`)}
            </h3>
            <span className="text-[12.5px] text-muted-foreground">
              {pick(
                `${selected.weeks}주 채점 · 모델 ${selected.version}`,
                `${selected.weeks} week${selected.weeks === 1 ? "" : "s"} scored · model ${selected.version}`,
              )}
            </span>
            {selected.weeks <= 2 && (
              <span className="text-[12.5px] font-medium text-amber-600 dark:text-amber-400">
                {pick(
                  "채점된 주가 적어 근거가 얕습니다.",
                  "Few weeks closed, so this rests on little evidence.",
                )}
              </span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {segments.map((s) => {
              const cell = selected.cells.get(s);
              if (!cell) return null;
              const isTotal = s === "TOTAL";
              const bias = cell.bias_pct;
              const hasBias = bias !== null && Number.isFinite(bias);
              return (
                <div
                  key={s}
                  className={`rounded-md border p-3 ${isTotal ? "border-foreground/25 bg-muted/40" : ""}`}
                >
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {isTotal ? pick("전체", "All segments") : s}
                  </p>
                  <p className="mt-1 text-2xl font-bold leading-none tabular-nums">
                    {pct(cell.pooled_wape)}
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {pick("가중 절대 오차", "weighted absolute error")}
                  </p>
                  <p className={`mt-2 text-[12.5px] tabular-nums ${hasBias ? biasStyle(bias) : "text-muted-foreground"}`}>
                    {hasBias
                      ? `${bias > 0 ? "+" : ""}${bias.toFixed(1)}% ${
                          Math.abs(bias) < 2
                            ? pick("편향 적음", "balanced")
                            : bias > 0
                              ? pick("과다 예측", "over-forecast")
                              : pick("과소 예측", "under-forecast")
                        }`
                      : "—"}
                  </p>
                  <p className="mt-1.5 border-t pt-1.5 text-[11.5px] text-muted-foreground">
                    {pick(
                      `SKU ${nf.format(cell.n_skus)}개 · 실판매 ${nf.format(Math.round(cell.actual_units))}개`,
                      `${nf.format(cell.n_skus)} SKUs · ${nf.format(Math.round(cell.actual_units))} units sold`,
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        {pick(
          "편향은 방향이 다르므로 색을 나눴습니다. 과다 예측은 재고가 남고, 과소 예측은 판매를 놓칩니다. 채점된 주 수가 적은 실행은 그만큼 근거가 얕습니다.",
          "Bias is coloured by direction rather than size, because over-forecasting leaves stock on the shelf and under-forecasting loses the sale. A run with few weeks scored rests on correspondingly little evidence.",
        )}
      </p>
    </section>
  );
}
