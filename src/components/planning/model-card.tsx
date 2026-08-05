"use client";

/**
 * Code Guide:
 * What "v11" is, behind the version string. Shared by the Action List and the
 * Forecast Validation page.
 *
 * Both screens name a model version, and until now only one of them could say
 * what the name meant. The Action List linked out to the validation page
 * instead, which answers the question by making the reader leave the worklist
 * they were working through, and lands them on a different screen to read two
 * paragraphs.
 *
 * The description and the feature lists come from the served payload, read off
 * the registered model class in the forecasting repo, so this cannot describe a
 * version the API is not serving. That is also why this component fetches
 * rather than accepting a hardcoded description from whichever screen mounted
 * it: a second copy of the text, maintained by hand next to a version string it
 * does not control, is free to drift from the model it claims to describe.
 *
 * The structural notes below are properties of the whole ML track rather than
 * of one version, and are labelled as such: they would still be true of v12.
 *
 * Feature names are shown raw. They are the words used in the design doc and in
 * the experiment scripts, and a reader moving between the three should find the
 * same term rather than a friendlier synonym that matches nothing.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { ValidationMeta, ValidationResponse } from "./validation/types";

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      <dt className="text-[12.5px] font-medium text-muted-foreground">{term}</dt>
      <dd className="text-[13px] leading-relaxed">{children}</dd>
    </div>
  );
}

/** Everything the card renders, however it was obtained. */
interface CardSource {
  meta: ValidationMeta | undefined;
  baseline: string;
  finalTestCutoff: string;
  windows: string[];
}

export function ModelCard({
  version,
  source,
}: {
  /** Label for the trigger.
   *
   *  Passed separately so the Action List can print the version it already
   *  knows from its own payload without waiting on a fetch. A trigger that
   *  renders an em dash until a dialog nobody has opened resolves is worse
   *  provenance than the plain string it replaced. */
  version: string | null | undefined;
  /** The already-loaded payload, on the page that has one. Undefined means
   *  fetch it when the dialog is first opened.
   *
   *  Deliberately not fetched on mount. The Action List renders this in a
   *  provenance bar on every load, and most readers never open it; paying for
   *  the validation payload on every visit to buy a dialog that is usually not
   *  opened is the wrong trade. */
  source?: CardSource;
}) {
  const { pick } = useI18n();
  const [fetched, setFetched] = useState<CardSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const data = source ?? fetched;

  const openChanged = (open: boolean) => {
    if (!open || source || fetched || loading) return;
    setLoading(true);
    setFailed(false);
    fetch(apiPath("/api/planning/validation"))
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ValidationResponse;
      })
      .then((v) =>
        setFetched({
          meta: v.meta,
          baseline: v.comparison.baseline,
          finalTestCutoff: v.final_test.cutoff,
          windows: v.comparison.windows,
        }),
      )
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const model = data?.meta?.model;
  const title = model?.version ?? version ?? "—";

  return (
    <Dialog onOpenChange={openChanged}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          <strong>{version ?? "—"}</strong>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{title}</DialogTitle>
          <DialogDescription>
            {loading
              ? pick("불러오는 중…", "Loading…")
              : failed
                ? pick(
                    "모델 정보를 불러오지 못했습니다. 예측 서버가 응답하지 않는 것으로 보입니다.",
                    "Could not load the model description. The forecast service is not responding.",
                  )
                : model?.description ??
                  pick("등록된 설명이 없습니다.", "No registered description for this version.")}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {pick("모델 정보를 불러오는 중…", "Fetching the registered description…")}
          </div>
        )}

        {/* Rendered only once there is something to render. The track-level
            notes below are true regardless of which version is served, but
            printing them under a failed fetch would present a card that looks
            complete while the two version-specific lines are silently absent. */}
        {!loading && data && (
          <>
            <dl className="flex flex-col gap-2">
              {model?.features && (
                <>
                  <Term term={pick("단기 SKU 피처", "Short-SKU features")}>
                    <span className="font-mono text-[12.5px]">{model.features.short.join(", ")}</span>
                  </Term>
                  <Term term={pick("장기 SKU 피처", "Long-SKU features")}>
                    <span className="font-mono text-[12.5px]">{model.features.long.join(", ")}</span>
                  </Term>
                </>
              )}

              {/* Track-level, not version-level. Said so plainly, because these
                  would still hold for a future version and a reader should not
                  have to guess which lines change when the number does. */}
              <Term term={pick("예측 대상", "Predicts")}>
                {pick(
                  "주간 수요를 직접 예측하지 않고, 해당 SKU의 최근 12주 평균 대비 비율을 예측한 뒤 다시 곱합니다. 계절성은 학습 전에 나누고 예측 후에 되돌립니다.",
                  "Not weekly units directly, but a ratio to that SKU's own trailing 12-week average, multiplied back afterwards. Seasonality is divided out before fitting and multiplied back into the forecast.",
                )}
              </Term>
              <Term term={pick("horizon", "Horizon")}>
                {pick(
                  "13주를 한 번에 예측합니다. 주차(lead)를 피처로 넣어 한 모델이 모든 주를 처리하며, 예측을 이어 붙이지 않습니다.",
                  "All 13 weeks at once. The week ahead is a feature (lead), so one model covers every horizon rather than chaining a forecast onto its own output.",
                )}
              </Term>
              <Term term={pick("측정", "Measured on")}>
                {pick(
                  `${data.windows.length}개 백테스트 구간(${data.windows.join(", ")}), 고정된 데이터 스냅샷 ${data.meta?.snapshot ?? "—"} 기준. 비교 대상은 ${data.baseline}, 현재 사용 중인 스프레드시트 방식입니다.`,
                  `${data.windows.length} backtest windows (${data.windows.join(", ")}) on the pinned data snapshot ${data.meta?.snapshot ?? "—"}. Compared against ${data.baseline}, the spreadsheet method in use today.`,
                )}
              </Term>
              <Term term={pick("아직 미사용", "Held back")}>
                {pick(
                  `${data.finalTestCutoff} 이후 구간은 개발 중 한 번도 사용하지 않았습니다. 개발 중에 확인하면 그 시점부터 독립적인 검증이 아니게 되기 때문입니다.`,
                  `The window after ${data.finalTestCutoff} has never been looked at. Checking it during development would spend it: from that point on it is no longer independent evidence.`,
                )}
              </Term>
            </dl>

            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {pick(
                "버전 번호는 채택된 순서가 아니라 시도한 순서입니다. 중간 번호 대부분은 기준을 통과하지 못해 기각되었고, 그 기록도 남아 있습니다.",
                "Version numbers count attempts, not adoptions. Most of the numbers in between were tested and rejected, and the rejections are recorded alongside the adoptions.",
              )}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
