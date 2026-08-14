"use client";

/**
 * Code Guide:
 * Fetches both validation payloads and lays out the page.
 *
 * The three requests are independent and issued together, so each section
 * renders as its own data arrives and a failure in one does not blank the
 * others. That holds whatever their relative speed, which is the point of
 * issuing them in parallel rather than a claim about any one of them.
 *
 * This comment previously asserted that demand patterns was the slowest,
 * because it scans full sales history. Observed behaviour is the opposite: it
 * is the quickest of the three. The inference was plausible and wrong, and it
 * had been repeated into two other files before anyone checked it against the
 * page. Left recorded here rather than quietly deleted, since the same
 * reasoning would produce the same wrong answer again.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { ForecastServerStatus } from "@/components/planning/forecast-server-status";
import {
  PlanningError,
  planningErrorFrom,
  type PlanningErrorBody,
} from "@/components/planning/planning-error";
import { ComparisonSection } from "./comparison-section";
import { DemandVsForecastSection } from "./demand-vs-forecast-section";
import { DEFAULT_WEEKS, DemandPatternsSection } from "./demand-patterns-section";
import { EmptySection } from "./empty-section";
import { FinalTestSection } from "./final-test-section";
import { OutliersSection } from "./outliers-section";
import { ModelCard } from "@/components/planning/model-card";
import { OverTimeSection } from "./over-time-section";
import { SectionHeading } from "./section-heading";
import type {
  DemandPatternsResponse,
  DemandVsForecastResponse,
  ValidationResponse,
} from "./types";

interface Fetched<T> {
  done: boolean;
  data: T | null;
  error: PlanningErrorBody | null;
  /** True when `data` belongs to a previous request that is being replaced. */
  stale?: boolean;
}

/**
 * Fetch a planning endpoint, refetching whenever `nonce` changes.
 *
 * `done` is derived from whether the stored result belongs to the current
 * request rather than reset by the effect. Clearing it with a setState at the
 * top of the effect is the same cascading-render pattern the lint rule catches,
 * and keying the result gives the better behaviour anyway: a retry leaves the
 * previous content on screen until the new answer arrives.
 */
function useEndpoint<T>(path: string, nonce: number): Fetched<T> {
  const key = `${path}|${nonce}`;
  const [state, setState] = useState<Fetched<T> & { key: string }>({
    key: "",
    done: false,
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiPath(path), { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        // Carried whole rather than flattened to a message, so the card can say
        // which failure this is and what fixes it.
        if (!res.ok) throw planningErrorFrom(body, `HTTP ${res.status}`);
        return body as T;
      })
      .then((data) => setState({ key, done: true, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          done: true,
          data: null,
          error: planningErrorFrom(err, err instanceof Error ? err.message : String(err)),
        });
      });
    return () => controller.abort();
  }, [path, key]);

  // While a new request is in flight the previous answer stays on screen. The
  // alternative blanks the chart to a spinner on every timeframe click, which
  // reads as the section breaking rather than loading. `stale` lets the caller
  // dim it so nobody mistakes the old window for the new one.
  const stale = state.key !== key;
  return {
    done: state.done && !stale,
    data: state.data,
    error: stale ? null : state.error,
    stale: stale && state.data !== null,
  };
}

function Loading() {
  const { pick } = useI18n();
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {pick("불러오는 중…", "Loading…")}
    </div>
  );
}

export function ValidationContent() {
  const { pick } = useI18n();
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = () => setReloadNonce((n) => n + 1);
  // The window is part of the request, so changing it refetches rather than
  // slicing client-side. The server holds the weekly series; sending two years
  // of it to trim in the browser would ship the data to discard most of it.
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const validation = useEndpoint<ValidationResponse>("/api/planning/validation", reloadNonce);
  // Fetched once. Every series carries its segment and the chart filters
  // client-side, matching the old page, so changing segment or lead is instant
  // rather than a round trip.
  const trend = useEndpoint<DemandVsForecastResponse>(
    "/api/planning/demand-vs-forecast",
    reloadNonce,
  );
  const patterns = useEndpoint<DemandPatternsResponse>(
    `/api/planning/demand-patterns?weeks=${weeks}`,
    reloadNonce,
  );

  const v = validation.data;

  return (
    // gap-12 rather than gap-8. Six sections of dense tables and charts ran
    // together at the old spacing: the gap between two sections was barely
    // larger than the gap between a heading and its own table, so the page read
    // as one continuous scroll rather than as six arguments. Each heading also
    // carries a top rule now, which needs room above it to separate rather than
    // to crowd.
    <div className="flex flex-col gap-12">
      <div className="flex justify-end">
        <ForecastServerStatus onRecovered={reload} />
      </div>

      {!validation.done && <Loading />}
      {validation.error && <PlanningError body={validation.error} onRetry={reload} />}

      {/* Provenance. This is the screen whose purpose is evidence, and it was
          the only one of the three not dating its own: the Action List says
          "Trained through" in its header and this said nothing, which is how a
          forecast three weeks stale went unnoticed while this page reported on
          it. Two dates because they answer different questions. The snapshot is
          pinned, so the accuracy figures deliberately do not move week to week
          and a reader seeing identical numbers twice should know that is by
          design. The training week does move, and the gap between the two is
          how you see whether the model being validated is the one being
          served. */}
      {v && (
        <div className="-mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Clickable: the page named a model and never said what the name
              meant, on the one screen where that detail belongs. */}
          <span>
            {pick("모델", "Model")}:{" "}
            {v.meta?.model ? (
              // This page already holds the payload, so the card is given it
              // rather than fetching a second copy of what is on screen.
              <ModelCard
                version={v.meta.model?.version ?? v.comparison.current}
                source={{
                  meta: v.meta,
                  baseline: v.comparison.baseline,
                  finalTestCutoff: v.final_test.cutoff,
                  windows: v.comparison.windows,
                }}
              />
            ) : (
              // An API that predates the model card still names its version.
              <strong>{v.comparison.current}</strong>
            )}
          </span>
          {v.meta?.snapshot && (
            <span title={pick(
              "평가에 사용한 데이터 스냅샷입니다. 고정되어 있어 기록된 정확도 수치가 주마다 달라지지 않습니다.",
              "The data snapshot the evaluation used. Pinned, so recorded accuracy figures cannot drift week to week.",
            )}>
              {pick("평가 데이터", "Evaluated on")}: <strong>{v.meta.snapshot}</strong>
            </span>
          )}
          {v.meta?.accuracy_computed && (
            <span>
              {pick("정확도 산출일", "Scored")}: <strong>{v.meta.accuracy_computed}</strong>
            </span>
          )}
          {v.meta?.trained_through && (
            <span title={pick(
              "현재 제공 중인 예측의 학습 기준 주입니다. 위 평가 스냅샷과 다르면, 검증한 모델과 제공 중인 예측의 시점이 다르다는 뜻입니다.",
              "The training week of the forecast currently served. When this differs from the snapshot above, the figures on this page describe a different week's data than the forecast in use.",
            )}>
              {pick("서비스 중 예측 학습 기준", "Forecast trained through")}:{" "}
              <strong>{v.meta.trained_through}</strong>
            </span>
          )}
        </div>
      )}

      {v && (
        <>
          <ComparisonSection
            comparison={v.comparison}
            coverage={v.coverage}
            basis={v.basis?.accuracy}
          />

          {/* Second, not last. This is the scope of the claim above it: which
              SKUs the model speaks for and how much of the volume they carry.
              It sat at the bottom of the page because it was built last, which
              meant the context for every figure above arrived after all of
              them. It renders its own loader in place, so however long it
              takes it cannot hold up the sections below it. */}
          {!patterns.done && !patterns.stale && !patterns.error && <Loading />}
          {patterns.error && !validation.error && (
            <PlanningError body={patterns.error} onRetry={reload} />
          )}
          {patterns.data && (
            <div className={patterns.stale ? "opacity-50 transition-opacity" : "transition-opacity"}>
              <DemandPatternsSection
                data={patterns.data}
                weeks={weeks}
                onWeeksChange={setWeeks}
              />
            </div>
          )}

          {/* The claim drawn over time, after the claim and its scope. Absent if
              it fails: the grid above already carries the claim, and a second
              error card for one outage is noise. */}
          {trend.data && trend.data.predicted.length > 0 && (
            <DemandVsForecastSection data={trend.data} />
          )}

          {/* The chart above already explains an empty history store, so the
              placeholder here would be the second panel on one page saying the
              same thing. Once runs exist the two are complementary: the chart
              is the trajectory, this is the per-run figure. */}
          {!(trend.data && trend.data.runs_stored === 0) && (
            <OverTimeSection
              runs={v.over_time.runs}
              performance={v.over_time.performance}
              lastCompleteWeek={v.over_time.last_complete_week}
              // So the table can say when its rows are not the served model's,
              // which is what the seeded fixture is. The chart above already
              // does this; the table did not.
              currentVersion={v.comparison.current}
            />
          )}

          {/* Per-SKU detail after the aggregate evidence, not before it. The
              pooled figure has to be on the page before "where it diverges
              from the pooled figure" means anything. */}
          <OutliersSection
            outliers={v.outliers}
            baseline={v.comparison.baseline}
            basis={v.basis?.accuracy}
          />

          <section className="flex flex-col gap-4">
            <SectionHeading
              id="final-test"
              title={pick("최종 테스트 구간", "Final test window")}
              description={pick(
                `개발 중에는 사용하지 않도록 격리해 둔 구간입니다. 기준일 ${v.final_test.cutoff}. 위의 모든 수치는 모델을 만드는 과정에서 반복해 확인한 구간에서 나온 것이므로, 그만큼 낙관적일 수 있습니다. 이 구간은 그 편향이 없는 단 한 번의 판정을 위해 남겨 둔 것입니다.`,
                `Quarantined from development so it can settle the question once. Cutoff ${v.final_test.cutoff}. Every figure above comes from windows that were looked at repeatedly while the model was being built, which is exactly the thing that makes a result optimistic. This window is held back so there is one measurement that has not been influenced that way.`,
              )}
            />
            {v.final_test.evaluated ? (
              <FinalTestSection result={v.final_test} />
            ) : (
              <EmptySection
                title={pick(
                  "아직 평가하지 않았습니다.",
                  "Not evaluated yet, deliberately.",
                )}
                waitingOn={pick(
                  "이 구간은 모델 개발이 끝날 때까지 한 번도 사용하지 않습니다. 개발 중에 확인하면 그 시점부터 더 이상 독립적인 검증이 아니게 되기 때문입니다.",
                  "This window is untouched until model development finishes. Looking at it during development would spend it: from that point on it is no longer independent evidence.",
                )}
                detail={pick(
                  "결과가 있는데도 이 자리가 비어 있다면 이 체크아웃에 outputs/reports/final_test.json 이 없는 것입니다. 이 테스트는 1회용이라 다시 실행해서 만들 수 없으므로, 파일을 가진 체크아웃에서 가져와야 합니다.",
                  "If a result exists and this panel is still empty, this checkout is missing outputs/reports/final_test.json. The test is single-use and re-running is not a recovery path, so the file has to come from a checkout that has it.",
                )}
              />
            )}
          </section>
        </>
      )}

    </div>
  );
}
