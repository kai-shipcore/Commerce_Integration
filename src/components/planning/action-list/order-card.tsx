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
 * The plausible band sits directly under the headline figure rather than below
 * the caption, because it qualifies that figure. Placed after the caption it
 * became the middle of three lines of small grey text and was read straight
 * past.
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
  band,
  breakdown,
  errorUsed,
  leadWeeks,
  reviewWeeks,
}: {
  total: number;
  band: { low: number; high: number } | null;
  breakdown: OrderBreakdownLine[];
  errorUsed: number | null;
  leadWeeks: number;
  reviewWeeks: number;
}) {
  const { pick } = useI18n();
  const lines = useMemo(() => renderLines(breakdown), [breakdown]);

  return (
    <div className="flex h-full flex-col rounded-md border p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pick("권장 발주량", "Recommended order")}
      </div>

      <div className="text-3xl font-bold leading-none text-indigo-600 dark:text-indigo-400">
        {nf.format(total)}
      </div>

      {band && (
        <div className="mt-2 inline-flex w-fit items-baseline gap-2 rounded-md border border-indigo-300/50 bg-indigo-50 px-2 py-1 dark:border-indigo-800/60 dark:bg-indigo-950/40">
          <span className="text-[8.5px] uppercase tracking-wider text-muted-foreground">
            {pick("타당 범위", "plausible")}
          </span>
          <span className="text-[13px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
            {nf.format(band.low)}–{nf.format(band.high)}
          </span>
          {errorUsed !== null && (
            <span className="text-[9.5px] text-muted-foreground">
              ±{Math.round(errorUsed * 100)}% {pick("오차", "error")}
            </span>
          )}
        </div>
      )}

      {band && total > band.high && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {pick(
            "선택한 서비스 수준을 유지하기 위해 이 범위보다 높게 권장됩니다.",
            "Recommended above this band to hold the chosen service level.",
          )}
        </p>
      )}

      <p className="mt-1 text-[10.5px] text-muted-foreground">
        {pick(
          `${leadWeeks}주 리드타임과 ${reviewWeeks}주 발주 주기를 포함한 수량`,
          `units, covering a ${leadWeeks}-week lead time plus a ${reviewWeeks}-week reorder cycle`,
        )}
      </p>

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
                <td className={`w-4 py-1.5 text-center text-[11.5px] ${colour || "opacity-70"}`}>{line.op}</td>
                <td className="py-1.5 pl-1.5 text-[11.5px]">{line.component}</td>
                <td className={`py-1.5 pr-1 text-right text-[11.5px] ${colour}`}>
                  {nf.format(Math.round(line.shown))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground opacity-80">
        {pick(
          "발주량 = 미지급 수량 + 판매 예상 수량 + 예측 오차 대비 여유분 − 보유 재고 및 입고 예정분",
          "what to buy = what is owed + what will sell + a cushion for forecast error, less what is already here or on its way",
        )}
      </p>
    </div>
  );
}
