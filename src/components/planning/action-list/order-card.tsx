"use client";

/**
 * Code Guide:
 * The recommended order shown as arithmetic, so it can be checked by hand.
 *
 * Rendered as a sum rather than a list of figures: a leading operator column and
 * the running signs make the table itself the formula, so no separate
 * explanation of how the number was reached is needed. The operator and its
 * figure share a colour, so a row reads as one movement — green adds to what
 * must be bought, red takes away from it. The total is left neutral, being
 * neither.
 *
 * There is no plausible band. It flexed coverage demand by the SKU's own error,
 * which is the same quantity safety stock adds, so at the default service level
 * its upper edge was the recommendation itself. It read as a range containing
 * the decision while actually ending at it. Uncertainty belongs to the
 * reliability card beside this one, where it is measured over the backtest
 * windows rather than restated from the error term this card already spent.
 */

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { OrderBreakdownLine } from "./types";

const nf = new Intl.NumberFormat("en-US");

interface RenderedLine {
  component: string;
  op: string;
  shown: number;
  isTotal: boolean;
  aside: boolean;
  sign: 1 | -1 | 0 | null;
}

/** Resolve each line's operator up front rather than while mapping to JSX.
 *
 *  The leading term carries no sign, so deciding one line's operator depends on
 *  the lines before it. Tracking that with a variable mutated inside the render
 *  map is a real hazard, not a style preference: React may re-enter a render,
 *  and the flag would carry its previous value in. Derived here instead, so the
 *  render is a pure function of this array. */
function renderLines(breakdown: OrderBreakdownLine[]): RenderedLine[] {
  let firstTerm = true;
  return breakdown.map((line) => {
    const isTotal = line.Sign === 0;
    const aside = line.Sign === null || line.Sign === undefined;
    let op = "";
    let shown = line.Units;
    if (isTotal) {
      op = "=";
    } else if (!aside) {
      op = firstTerm ? "" : line.Sign === -1 ? "−" : "+";
      shown = Math.abs(line.Units);
      firstTerm = false;
    }
    return { component: line.Component, op, shown, isTotal, aside, sign: line.Sign };
  });
}

export function OrderCard({
  total,
  breakdown,
  leadWeeks,
  reviewWeeks,
  draftInbound = 0,
}: {
  total: number;
  breakdown: OrderBreakdownLine[];
  leadWeeks: number;
  reviewWeeks: number;
  /** Units on a container still in draft. Not part of the sum below, so this is
   *  only used to state what the requirement becomes if the draft stands. */
  draftInbound?: number;
}) {
  const { pick } = useI18n();
  const lines = useMemo(() => renderLines(breakdown), [breakdown]);
  // The same subtraction a purchaser would otherwise do in their head, done
  // here so it is not done wrongly. Deliberately not the headline: the model
  // does not know whether the draft will ship, so the committed figure stays
  // the recommendation and this is offered beside it as the other case.
  const netOfDraft = Math.max(0, total - draftInbound);

  return (
    <div className="flex h-full flex-col rounded-md border p-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pick("권장 발주량", "Recommended order")}
      </div>

      <div className="text-3xl font-bold leading-none text-indigo-600 dark:text-indigo-400">
        {nf.format(total)}
      </div>

      {/* No plausible band. It flexed coverage demand by this SKU's error, which
          is the same quantity safety stock adds, so at the default service level
          its upper edge was the recommendation itself: one figure shown twice,
          once as a decision and once as a range that appeared to contain it but
          ended at it. The reliability card beside this one carries uncertainty,
          measured over the backtest windows rather than restated from the same
          error term. */}
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {pick(
          `${leadWeeks}주 리드타임과 ${reviewWeeks}주 발주 주기를 포함한 수량`,
          `units, covering a ${leadWeeks}-week lead time plus a ${reviewWeeks}-week reorder cycle`,
        )}
      </p>

      {/* Sits under the caption rather than beside the headline, because it is a
          conditional answer and the headline is not. Given its own box so it is
          not read as another line of qualifying grey text, which is what
          happened to the plausible band before it moved up. */}
      {draftInbound > 0 && (
        <div className="mt-2 rounded-md border border-sky-300/50 bg-sky-50 px-2 py-1.5 dark:border-sky-800/60 dark:bg-sky-950/40">
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] uppercase tracking-wider text-muted-foreground">
              {pick("초안 반영 시", "if the draft stands")}
            </span>
            <span className="text-[16px] font-semibold tabular-nums text-sky-700 dark:text-sky-300">
              {nf.format(netOfDraft)}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {pick(
              `${nf.format(total)} − 초안 ${nf.format(draftInbound)}. 초안은 확정이 아니므로 위 권장 수량에는 반영되어 있지 않습니다. 그 컨테이너가 예정대로 출고된다면 실제 필요량은 이 수치입니다.`,
              `${nf.format(total)} less ${nf.format(draftInbound)} already drafted. The recommendation above does not assume that container ships, because a draft can be cancelled. If it does ship, this is the real requirement.`,
            )}
          </p>
        </div>
      )}

      <table className="mt-3 w-full border-collapse tabular-nums">
        <tbody>
          {lines.map((line) => {
            const colour = line.isTotal || line.aside
              ? ""
              : line.sign === 1
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-500 dark:text-red-400";
            return (
              <tr
                key={line.component}
                className={`${line.isTotal ? "border-t font-semibold" : ""} ${line.aside ? "italic opacity-55" : ""}`}
              >
                <td className={`w-4 py-1.5 text-center text-[12.5px] ${colour || "opacity-70"}`}>{line.op}</td>
                <td className="py-1.5 pl-1.5 text-[12.5px]">{line.component}</td>
                <td className={`py-1.5 pr-1 text-right text-[12.5px] ${colour}`}>
                  {nf.format(Math.round(line.shown))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground opacity-80">
        {pick(
          "발주량 = 미지급 수량 + 판매 예상 수량 + 예측 오차 대비 여유분 − 보유 재고 및 입고 예정분",
          "what to buy = what is owed + what will sell + a cushion for forecast error, less what is already here or on its way",
        )}
      </p>
    </div>
  );
}
