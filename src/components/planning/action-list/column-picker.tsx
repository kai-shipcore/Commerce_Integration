"use client";

/**
 * Code Guide:
 * Choose which of the table's optional columns are shown.
 *
 * The worklist carries eleven columns and does not fit a laptop, so it scrolls
 * sideways and whichever columns fall off the right edge are invisible until
 * someone thinks to look for them. That defeats the reason the column order was
 * chosen, which was for a row to read as a sentence.
 *
 * A control rather than a decision. Narrowing the columns helped and was not
 * enough, and picking a default set for everyone would have meant choosing
 * between two real readings of this screen: checking coverage wants demand and
 * trend, placing an order wants position and quantity. The screen cannot know
 * which, so it asks once and remembers.
 *
 * Grouped by band, because the bands are how the table is organised and hiding
 * a whole band is the change most likely to be wanted. The count in the summary
 * is the affordance: a reader who has hidden columns and forgotten needs the
 * closed control to say so, since a missing column is otherwise indistinguishable
 * from a column that never existed.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";
import { ALL_COLUMNS, OPTIONAL_COLUMNS, type SortKey } from "./action-list-table";

const BAND_LABEL: Record<"pos" | "dem" | "act", [string, string]> = {
  pos: ["재고 현황", "Position"],
  dem: ["수요", "Demand"],
  act: ["조치", "Action"],
};

export function ColumnPicker({
  visible,
  onChange,
}: {
  visible: Set<SortKey>;
  onChange: (next: Set<SortKey>) => void;
}) {
  const { pick } = useI18n();
  const hidden = ALL_COLUMNS.length - visible.size;

  const toggle = (key: SortKey) => {
    const next = new Set(visible);
    // The last column cannot be removed. A table of SKU and Priority alone is
    // not a narrower view of the worklist, it is a different screen, and the
    // reader who got there by unticking boxes has no clue which one to tick to
    // get back.
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const setBand = (band: "pos" | "dem" | "act", on: boolean) => {
    const keys = OPTIONAL_COLUMNS.filter((c) => c.band === band).map((c) => c.key);
    const next = new Set(visible);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    if (next.size === 0) return;
    onChange(next);
  };

  return (
    <details className="group relative">
      <summary className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-muted/60">
        {pick("열", "Columns")}
        {hidden > 0 && (
          <span className="rounded bg-sky-100 px-1.5 tabular-nums text-sky-700 dark:bg-sky-900 dark:text-sky-200">
            {pick(`${hidden}개 숨김`, `${hidden} hidden`)}
          </span>
        )}
      </summary>

      <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border bg-background p-2 shadow-lg">
        {(["pos", "dem", "act"] as const).map((band) => {
          const cols = OPTIONAL_COLUMNS.filter((c) => c.band === band);
          const allOn = cols.every((c) => visible.has(c.key));
          return (
            <div key={band} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between px-1 py-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {pick(BAND_LABEL[band][0], BAND_LABEL[band][1])}
                </span>
                <button
                  type="button"
                  onClick={() => setBand(band, !allOn)}
                  className="rounded px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {allOn ? pick("모두 숨기기", "hide all") : pick("모두 보기", "show all")}
                </button>
              </div>
              {cols.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12.5px] hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={visible.has(c.key)}
                    onChange={() => toggle(c.key)}
                    className="h-3.5 w-3.5"
                  />
                  {pick(c.label[0], c.label[1])}
                </label>
              ))}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onChange(new Set(ALL_COLUMNS))}
          className="mt-1 w-full rounded border px-2 py-1 text-[12px] hover:bg-muted/60"
        >
          {pick("모든 열 보기", "Show every column")}
        </button>
      </div>
    </details>
  );
}
