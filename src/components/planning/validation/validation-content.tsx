"use client";

/**
 * Code Guide:
 * Fetches both validation payloads and lays out the page.
 *
 * The two requests are independent and issued together. Demand patterns scans
 * full sales history and is the slower of the two, so chaining them would make
 * the comparison wait on data it does not need. Each section renders as its own
 * data arrives, and a failure in one does not blank the other.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { ComparisonSection } from "./comparison-section";
import { DemandPatternsSection } from "./demand-patterns-section";
import { EmptySection } from "./empty-section";
import { OutliersSection } from "./outliers-section";
import { OverTimeSection } from "./over-time-section";
import type { DemandPatternsResponse, ValidationResponse } from "./types";

interface Fetched<T> { done: boolean; data: T | null; error: string | null }
const PENDING = { done: false, data: null, error: null } as const;

function useEndpoint<T>(path: string): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>(PENDING);
  useEffect(() => {
    const controller = new AbortController();
    fetch(apiPath(path), { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        return body as T;
      })
      .then((data) => setState({ done: true, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ done: true, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [path]);
  return state;
}

function SectionError({ message }: { message: string }) {
  const { pick } = useI18n();
  return (
    <Card><CardContent className="p-5 text-sm">
      <p className="font-medium text-red-600 dark:text-red-400">
        {pick("불러올 수 없습니다.", "Could not load this section.")}
      </p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {pick(
          "예측 API가 실행 중인지 확인하세요.",
          "Check that the forecasting API is running.",
        )}
      </p>
    </CardContent></Card>
  );
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
  const validation = useEndpoint<ValidationResponse>("/api/planning/validation");
  const patterns = useEndpoint<DemandPatternsResponse>("/api/planning/demand-patterns?weeks=52");

  const v = validation.data;

  return (
    <div className="flex flex-col gap-8">
      {!validation.done && <Loading />}
      {validation.error && <SectionError message={validation.error} />}

      {v && (
        <>
          <ComparisonSection comparison={v.comparison} coverage={v.coverage} />

          <OutliersSection
            best={v.outliers.best}
            worst={v.outliers.worst}
            baseline={v.comparison.baseline}
          />

          <OverTimeSection
            runs={v.over_time.runs}
            performance={v.over_time.performance}
            lastCompleteWeek={v.over_time.last_complete_week}
          />

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold">
                {pick("최종 테스트 구간", "Final test window")}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {pick(
                  `개발 중에는 사용하지 않도록 격리해 둔 구간입니다. 기준일 ${v.final_test.cutoff}.`,
                  `Quarantined from development so it can settle the question once. Cutoff ${v.final_test.cutoff}.`,
                )}
              </p>
            </div>
            {v.final_test.evaluated ? (
              <EmptySection
                title={pick("결과 표시 준비 중", "Results not rendered yet")}
                waitingOn={pick(
                  "최종 테스트가 실행되었습니다. 이 자리에 결과 표가 들어갑니다.",
                  "The final test has been run. Its results belong in this space.",
                )}
              />
            ) : (
              <EmptySection
                title={pick(
                  "아직 평가하지 않았습니다.",
                  "Not evaluated yet, deliberately.",
                )}
                waitingOn={pick(
                  "모델 개발이 끝날 때까지 이 구간은 한 번도 사용하지 않습니다. 개발 중에 확인하면 그 시점부터 더 이상 독립적인 검증이 아니게 되기 때문입니다.",
                  "This window is untouched until model development finishes. Looking at it during development would spend it: from that point on it is no longer independent evidence.",
                )}
                detail={pick(
                  "평가가 끝나면 위 비교와 같은 형식의 결과가 이 자리에 표시되며, 그것이 모델 채택 여부를 판단하는 근거가 됩니다.",
                  "Once it is run, results in the same shape as the comparison above will appear here, and those are the figures the adoption decision rests on.",
                )}
              />
            )}
          </section>
        </>
      )}

      {!patterns.done && !patterns.error && validation.done && <Loading />}
      {patterns.error && <SectionError message={patterns.error} />}
      {patterns.data && <DemandPatternsSection data={patterns.data} />}
    </div>
  );
}
