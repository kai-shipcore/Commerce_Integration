"use client";

/**
 * Code Guide:
 * The quarantined window's result, which is the strongest evidence on the page
 * and the only figure here that was not looked at while the model was built.
 *
 * This panel has one hard constraint, and it is the reason the section is not
 * three cards and a number. The result has two halves: the model beats the
 * spreadsheet it would replace by a wide margin, and it ties a twelve-week
 * moving average on this same window. Rendering only the first is the failure
 * mode `comparison-section.tsx` refuses in its own guide, and it applies harder
 * here, because the section description tells the reader to weight this above
 * everything above it. So both verdicts render at the same size, side by side,
 * and the prose underneath explains why the tie is the expected result rather
 * than a disappointment.
 *
 * Significance is computed from the interval rather than passed in as a flag.
 * A delta whose 95% interval straddles zero is a reading and not a result, and
 * that distinction is the whole content of the second panel.
 *
 * No version is named in this file. `methods` tells it which key in `scores` is
 * the model, the spreadsheet and the baseline, the same way the comparison
 * section reads its versions from the payload.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";
import type { FinalTest, FinalTestComparison } from "./types";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}`;

/** The interval excluding zero is what separates a result from a reading. */
const isSignificant = (c: FinalTestComparison) =>
  (c.ci_lo > 0 && c.ci_hi > 0) || (c.ci_lo < 0 && c.ci_hi < 0);

/** Segments in the order the rest of the page uses them: TOTAL last, because it
 *  summarises the rows above it and reading it first encourages stopping there. */
function orderSegments(names: string[]): string[] {
  return [...names].sort((a, b) => {
    if (a === "TOTAL") return 1;
    if (b === "TOTAL") return -1;
    return a.localeCompare(b);
  });
}

function Verdict({
  rows,
  heading,
  blurb,
  tone,
}: {
  rows: FinalTestComparison[];
  heading: string;
  blurb: string;
  tone: "decisive" | "tied";
}) {
  const { pick } = useI18n();
  const frame =
    tone === "decisive"
      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-muted-foreground/30 bg-muted/30";

  return (
    <div className={`rounded-md border p-4 ${frame}`}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </p>

      <table className="mt-2 w-full border-collapse">
        <tbody>
          {rows.map((c) => {
            const sig = isSignificant(c);
            return (
              <tr key={`${c.against}-${c.segment}`} className="border-t first:border-t-0">
                <th
                  scope="row"
                  className="py-1.5 pr-2 text-left text-[12.5px] font-medium capitalize"
                >
                  {c.segment}
                </th>
                <td className="py-1.5 pr-2 text-right text-[13px] font-semibold tabular-nums">
                  {pp(c.delta)}
                  <span className="ml-0.5 text-[11px] font-normal opacity-70">pp</span>
                </td>
                <td className="py-1.5 pr-2 text-right text-[11.5px] tabular-nums text-muted-foreground">
                  [{pp(c.ci_lo)}, {pp(c.ci_hi)}]
                </td>
                <td className="py-1.5 text-right text-[11.5px] font-medium">
                  {sig ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {pick("유의함", "significant")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {pick("구분 불가", "indistinguishable")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 border-t pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {blurb}
      </p>
    </div>
  );
}

export function FinalTestSection({ result }: { result: Extract<FinalTest, { evaluated: true }> }) {
  const { pick } = useI18n();
  const { scores, methods, comparisons, test_weeks } = result;

  const model = methods.model ?? "";
  const sheet = methods.spreadsheet ?? "";
  const base = methods.structural_baseline ?? "";

  const segments = orderSegments(Object.keys(scores[model] ?? {}));
  const modelTotal = scores[model]?.TOTAL;
  const sheetTotal = scores[sheet]?.TOTAL;
  const improvement =
    typeof modelTotal === "number" && typeof sheetTotal === "number" && sheetTotal > 0
      ? 1 - modelTotal / sheetTotal
      : null;

  const vsSheet = comparisons.filter((c) => c.against === sheet);
  const vsBase = comparisons.filter((c) => c.against === base);

  const columns: { key: string; label: string; sub: string }[] = [
    {
      key: model,
      label: pick("현재 모델", "Current model"),
      sub: model,
    },
    {
      key: sheet,
      label: pick("기존 방식", "Spreadsheet"),
      sub: sheet,
    },
    {
      key: base,
      label: pick("구조적 베이스라인", "Structural baseline"),
      sub: pick("12주 이동평균", "12-week moving average"),
    },
  ].filter((c) => c.key && scores[c.key]);

  return (
    <div className="flex flex-col gap-4">
      {/* The headline mirrors the comparison section's three cards on purpose.
          A reader who has scrolled past that grid recognises the shape, and the
          only thing that should feel different here is which window it is. */}
      {improvement !== null && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("현재 모델", "Current model")} · {model}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums">
              {pct(modelTotal as number)}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {pick("격리 구간, 전체", "quarantined window, all segments")}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("기존 방식", "Spreadsheet")} · {sheet}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-muted-foreground">
              {pct(sheetTotal as number)}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {pick("동일 SKU, 동일 주", "same SKUs, same weeks")}
            </p>
          </div>
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              {pick("오차 감소", "Error reduced by")}
            </div>
            <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-emerald-700 dark:text-emerald-400">
              {(improvement * 100).toFixed(0)}%
            </div>
            <p className="mt-1 text-[11.5px] text-emerald-700/80 dark:text-emerald-400/80">
              {pick("단 한 번의 판정", "on a single, unrepeated measurement")}
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
              {columns.map((c) => (
                <th key={c.key} className="border-l py-2 px-3 text-right">
                  <div className="text-[12.5px] font-semibold whitespace-nowrap">{c.label}</div>
                  <div className="text-[11px] font-normal text-muted-foreground whitespace-nowrap">
                    {c.sub}
                  </div>
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
                    className={`py-2 pl-3 pr-2 text-left text-[12.5px] ${
                      total ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {total ? pick("전체", "All segments") : seg}
                  </th>
                  {columns.map((c) => {
                    const v = scores[c.key]?.[seg];
                    const best =
                      typeof v === "number" &&
                      v ===
                        Math.min(
                          ...columns
                            .map((x) => scores[x.key]?.[seg])
                            .filter((n): n is number => typeof n === "number"),
                        );
                    return (
                      <td
                        key={c.key}
                        className={`border-l px-3 py-2 text-right text-[13.5px] tabular-nums ${
                          best ? "font-semibold" : ""
                        }`}
                      >
                        {typeof v === "number" ? pct(v) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Both verdicts, same size, side by side. This is the constraint. */}
      <div className="grid gap-3 md:grid-cols-2">
        {vsSheet.length > 0 && (
          <Verdict
            rows={vsSheet}
            tone="decisive"
            heading={pick(
              `기존 방식(${sheet}) 대비`,
              `Against the spreadsheet (${sheet})`,
            )}
            blurb={pick(
              "이 프로젝트가 실제로 답해야 하는 질문입니다. 두 세그먼트 모두 신뢰구간이 0에서 멀리 떨어져 있으므로, 모델이 회사가 현재 쓰는 방식보다 낫다는 것은 이 구간에서 확인된 결과입니다.",
              "This is the question the business actually faces, and the one the adoption decision rests on. Both intervals sit clear of zero, so on this window the model is better than what it would replace.",
            )}
          />
        )}
        {vsBase.length > 0 && (
          <Verdict
            rows={vsBase}
            tone="tied"
            heading={pick(
              "구조적 베이스라인 대비",
              "Against the structural baseline",
            )}
            blurb={pick(
              "두 차이 모두 표준오차 1개보다 작습니다. 이 구간에서는 모델과 12주 이동평균이 사실상 같은 예측기입니다. 이긴 쪽만 보고하면 증거가 아니므로 같은 크기로 표시합니다.",
              "Both deltas are smaller than one standard error. On this window the model and a twelve-week moving average are the same forecaster. It renders at the same size as the panel beside it because a comparison that only reports its wins is not evidence.",
            )}
          />
        )}
      </div>

      <div className="rounded-md border border-dashed p-3">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {pick("이 결과를 어떻게 읽어야 하는가", "How to read this")}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {pick(
            "동률은 실망스러운 결과가 아니라 예상된 결과입니다. 이 구간은 5월부터 7월까지의 평탄한 시기이고, 평탄한 시기에는 후행 평균과 모델이 같은 답을 냅니다. 모델이 값어치를 하는 곳은 후행 평균이 아직 보지 못한 모퉁이, 즉 계절 전환점입니다. 네 구간 여덟 개 칸 전체에서 모델은 베이스라인보다 유의하게 나쁜 적이 없고 두 칸에서 유의하게 나으며, 그 두 칸이 4분기 상승기와 연휴 이후 하락기입니다. 여전히 입증되지 않은 것은 평범한 분기에서의 이득입니다.",
            "The tie is the expected result rather than a disappointment. This window is May to July, a flat stretch, and in flat stretches a trailing average and the model give the same answer. The model earns its keep at the corners a trailing average cannot turn. Across all four windows and eight segment cells it is never significantly worse than the baseline and is significantly better in two, both of them seasonal turning points: the Q4 ramp-up and the post-holiday collapse. What stays unproven is whether it helps in an ordinary quarter.",
          )}
        </p>
        {!result.has_bias && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {pick(
              "캘리브레이션(편향) 수치는 실행 결과 파일에 기록되지 않아 이 화면에 표시하지 않습니다. 해당 수치는 ML_FORECAST_DESIGN.md 4.35절에 있습니다.",
              "Calibration figures are not shown here because the runner did not record them in the result file. They are in ML_FORECAST_DESIGN.md Section 4.35, and this panel omits them rather than restating numbers it cannot read from the measurement.",
            )}
          </p>
        )}
      </div>

      {/* Provenance. The point of a single-use measurement is that someone can
          check it, and checking it means knowing which code and which data
          produced it. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {pick(
          `실행 ${result.run_at?.slice(0, 10) ?? "—"} · 커밋 ${result.commit?.slice(0, 7) ?? "—"} · 스냅샷 ${result.snapshot ?? "—"} · 기준일 ${result.cutoff} · 테스트 주 ${test_weeks.length}주${test_weeks.length ? ` (${test_weeks[0]} ~ ${test_weeks[test_weeks.length - 1]})` : ""} · 출처 outputs/reports/final_test.json`,
          `Run ${result.run_at?.slice(0, 10) ?? "—"} · commit ${result.commit?.slice(0, 7) ?? "—"} · snapshot ${result.snapshot ?? "—"} · cutoff ${result.cutoff} · ${test_weeks.length} test weeks${test_weeks.length ? ` (${test_weeks[0]} to ${test_weeks[test_weeks.length - 1]})` : ""} · served from outputs/reports/final_test.json`,
        )}
      </p>
    </div>
  );
}
