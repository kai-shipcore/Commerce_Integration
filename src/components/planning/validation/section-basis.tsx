"use client";

/**
 * Code Guide:
 * One line under a section heading saying which clock that section runs on.
 *
 * This page has always carried two kinds of figure. Sections 02, 03 and 04 read
 * data/processed and move with the Tuesday cron, because they describe the
 * business as it is now: weekly demand, which SKUs are forecast, how much
 * volume they carry. Sections 01, 05 and 06 read the snapshot pinned by
 * ML_DATA_SNAPSHOT and deliberately do not move, because they are measurements
 * whose value is being comparable across model versions.
 *
 * Nothing on the page distinguished them. A reader had to assume one or the
 * other, and either assumption is wrong for half the page: assume live and the
 * comparison grid looks like it is failing to refresh, assume pinned and the
 * demand chart looks like it is describing history when it is describing now.
 *
 * The drift banner is the part that could not be said at all before. A pinned
 * section is only trustworthy while the thing it was pinned to still resembles
 * what is being served, and that stopped being true on 2026-08-11 without
 * anything noticing for two weeks.
 *
 * Deliberately not a card, a callout or an icon in the ordinary case. This is a
 * caption: it should be findable when questioned and invisible when not. The
 * banner is the exception and looks like one, because it is the one state where
 * the reader has to act.
 */

import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { AccuracyBasis, LiveBasis } from "./types";

/** A date, or a dash. Dates arrive as ISO strings and are rendered as their
 *  date part only: the accuracy manifest records a full timestamp with an
 *  offset, and the minute a training run finished is not information anyone
 *  reading this page needs. */
function day(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/** The caption under a live section's heading.
 *
 *  Turns into a warning when the weekly pipeline has not delivered. That state
 *  is otherwise undetectable from the page: last week's forecast renders
 *  identically to this week's, which is how a run that failed to advance the
 *  data went unnoticed for three days in August 2026. The date alone was not
 *  enough, because nobody reads a date unless something tells them to. */
export function LiveBasisLine({ basis }: { basis?: LiveBasis | null }) {
  const { pick } = useI18n();
  if (!basis) return null;

  const behind = basis.weeks_behind ?? 0;
  if (behind > 0) {
    return (
      <p className="flex items-start gap-1.5 text-[12px] font-medium leading-snug text-amber-700 dark:text-amber-500">
        <AlertTriangle aria-hidden className="mt-[1px] h-3.5 w-3.5 shrink-0" />
        <span>
          {pick(
            `${day(basis.as_of)}까지의 데이터입니다. 가장 최근 마감 주는 ${day(basis.expected_week)}이므로 ${behind}주 밀려 있습니다. 주간 파이프라인이 갱신되지 않았습니다.`,
            `Data ends ${day(basis.as_of)}, but the last complete week is ${day(basis.expected_week)}. ${behind} week${behind === 1 ? "" : "s"} behind: the weekly pipeline has not delivered.`,
          )}
        </span>
      </p>
    );
  }

  return (
    <p className="text-[12px] leading-snug text-muted-foreground/80">
      <span className="font-medium">{pick("현재 데이터", "Live")}</span>
      {" · "}
      {pick(
        `${day(basis.as_of)}까지의 주간 실적, 매주 화요일 갱신`,
        `weeks through ${day(basis.as_of)}, refreshed every Tuesday`,
      )}
    </p>
  );
}

/** The caption under a pinned section's heading.
 *
 *  `computed_at_is_mtime` is surfaced rather than hidden. A date derived from a
 *  file's modification time is rewritten by git checkout, cp and every deploy,
 *  so it is not evidence of when anything was measured, and presenting it in
 *  the same typeface as a recorded run time would make it look like one. */
export function PinnedBasisLine({ basis }: { basis?: AccuracyBasis | null }) {
  const { pick } = useI18n();
  if (!basis) return null;
  return (
    <p className="text-[12px] leading-snug text-muted-foreground/80">
      <span className="font-medium">{pick("고정 측정", "Pinned")}</span>
      {" · "}
      {pick(
        `스냅샷 ${basis.snapshot ?? "—"} 기준, ${day(basis.computed_at)} 산출`,
        `snapshot ${basis.snapshot ?? "—"}, scored ${day(basis.computed_at)}`,
      )}
      {basis.scored_skus != null && (
        <>
          {" · "}
          {pick(`SKU ${basis.scored_skus}개`, `${basis.scored_skus} SKUs`)}
        </>
      )}
      {basis.computed_at_is_mtime && (
        <span className="ml-1 text-amber-700 dark:text-amber-500">
          {pick(
            "(파일 수정 시각에서 추정한 날짜입니다)",
            "(date inferred from file mtime, not recorded)",
          )}
        </span>
      )}
      {" · "}
      <span className="text-muted-foreground/60">
        {pick(
          "모델 버전 간 비교를 위해 고정되어 있으며, 주마다 변하지 않습니다.",
          "pinned so versions stay comparable; it does not move weekly.",
        )}
      </span>
    </p>
  );
}

/**
 * Shown above the pinned sections when the report no longer describes what is
 * being served.
 *
 * Two conditions, reported separately because a reader who sees only "re-run
 * the report" cannot tell which of them they are looking at, and one of the two
 * is invisible to the obvious check. A renamed snapshot is caught by comparing
 * names. A re-profile that keeps the snapshot name is not, and that is the one
 * that actually happened.
 *
 * The figures underneath are deliberately still rendered. They are real
 * measurements of a real cohort and suppressing them would leave the page with
 * nothing where its central claim goes, which is a worse answer than the claim
 * plus the caveat. This is the same principle comparison-section.tsx states
 * about losing cells: the page shows what is true and lets the reader weigh it.
 */
export function AccuracyDriftBanner({ basis }: { basis?: AccuracyBasis | null }) {
  const { pick } = useI18n();
  const d = basis?.drift;
  if (!d) return null;

  const stale = d.snapshot_stale || d.population_stale;
  if (!stale && d.known) return null;

  // No manifest at all. Quieter than the drift case: nothing is known to be
  // wrong, the figures simply cannot be dated, and treating "undated" as
  // "stale" would put a warning on every correct pre-manifest deployment.
  if (!d.known) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
        {pick(
          "이 수치들이 언제, 어떤 대상에 대해 산출되었는지 기록이 없습니다. scripts/ml_accuracy_report.py 를 다시 실행하면 기록이 남습니다.",
          "There is no record of when these figures were computed or over which SKUs. Re-running scripts/ml_accuracy_report.py records it.",
        )}
      </p>
    );
  }

  const pct = d.population_drift == null ? null : Math.round(d.population_drift * 100);

  return (
    <div className="flex gap-2.5 rounded-md border border-amber-400/70 bg-amber-50/70 px-3 py-2.5 dark:border-amber-800/70 dark:bg-amber-950/30">
      <AlertTriangle
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
      />
      <div className="min-w-0 text-[12.5px] leading-relaxed">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          {pick(
            "아래 수치는 현재 서비스 중인 대상과 다른 집단에서 산출되었습니다.",
            "The figures below were measured on a different population than the one being served.",
          )}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-900/85 dark:text-amber-200/85">
          {d.snapshot_stale && (
            <li>
              {pick(
                `보고서는 스냅샷 ${d.report_snapshot} 기준이지만, 현재 고정된 스냅샷은 ${d.config_snapshot} 입니다.`,
                `The report was measured on snapshot ${d.report_snapshot}, but the pinned snapshot is now ${d.config_snapshot}.`,
              )}
            </li>
          )}
          {d.population_stale && pct != null && (
            <li>
              {pick(
                `예측 대상 집단이 측정 당시의 ${basis?.scored_skus ?? "—"}개 대비 ${pct}% 이동했습니다. 허용 범위는 ${Math.round(d.tolerance * 100)}% 입니다.`,
                `The forecast cohort has moved ${pct}% from the ${basis?.scored_skus ?? "—"} SKUs that were scored, against a ${Math.round(d.tolerance * 100)}% tolerance.`,
              )}
            </li>
          )}
        </ul>
        <p className="mt-1.5 text-amber-900/70 dark:text-amber-200/70">
          {pick(
            "수치 자체는 실제 측정값이므로 그대로 표시합니다. 다만 지금 서비스되는 대상에 대한 값은 아닙니다. scripts/ml_accuracy_report.py 를 다시 실행하고 결과를 커밋하면 해소됩니다.",
            "The figures are real measurements and are still shown, but they are not measurements of what is being forecast today. Re-running scripts/ml_accuracy_report.py and committing the result clears this.",
          )}
        </p>
      </div>
    </div>
  );
}
