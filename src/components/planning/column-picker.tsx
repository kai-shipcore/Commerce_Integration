"use client";

/**
 * Code Guide:
 * Choose which of a table's optional columns are shown.
 *
 * Generalized off the Action List worklist, which carries eleven columns and
 * does not fit a laptop, so it scrolls sideways and whichever columns fall
 * off the right edge are invisible until someone thinks to look for them.
 * Every planning table with more optional columns than fit a screen shares
 * that problem, so this is the one control for all of them rather than a
 * copy per table.
 *
 * A control rather than a decision, since a table cannot know which three
 * columns matter to a given reader on a given day. Grouped by band when the
 * caller supplies one, because hiding a whole band is often the change
 * actually wanted; a table with no natural bands just gets a flat list. The
 * count in the closed summary is the affordance: a reader who has hidden
 * columns and forgotten needs the closed control to say so, since a missing
 * column is otherwise indistinguishable from a column that never existed.
 *
 * This is also the recovery path for the per-column "Hide column" menu item
 * in `ColumnHeaderMenu`: hiding a column from its header has no undo of its
 * own, so whichever table offers Hide must render this alongside it.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";

export interface ColumnPickerColumn<Key extends string> {
  key: Key;
  /** Omit to render every column as one flat, ungrouped list. */
  band?: string;
  label: [string, string];
}

export function ColumnPicker<Key extends string>({
  columns,
  bandLabels,
  visible,
  onChange,
}: {
  columns: ColumnPickerColumn<Key>[];
  /** Display label per band, keyed the same way `columns[].band` is.
   *  Required only when at least one column carries a band. */
  bandLabels?: Record<string, [string, string]>;
  visible: Set<Key>;
  onChange: (next: Set<Key>) => void;
}) {
  const { pick } = useI18n();
  const hidden = columns.length - visible.size;
  const bands = bandLabels ? (Object.keys(bandLabels) as string[]) : [];

  const toggle = (key: Key) => {
    const next = new Set(visible);
    // The last column cannot be removed. A table with only its identity
    // column left is not a narrower view, it is a different screen, and the
    // reader who got there by unticking boxes has no clue which one to tick
    // to get back.
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const setBand = (band: string, on: boolean) => {
    const keys = columns.filter((c) => c.band === band).map((c) => c.key);
    const next = new Set(visible);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    if (next.size === 0) return;
    onChange(next);
  };

  const renderColumn = (c: ColumnPickerColumn<Key>) => (
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
  );

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

      {/* z-50 so the panel clears the sticky table headers beneath it.
       *
       *  Every table that renders this control has a sticky header, and the
       *  scale those headers use is `Z` in `action-list/action-list-table.tsx`:
       *  z-30 for the column-name row and z-40 for the corner cell. This panel
       *  was z-30, which tied the name row and lost to the corner outright, and
       *  a tie is decided by document order, which the table wins because it
       *  comes after the toolbar. So the panel opened underneath the headers it
       *  overlaps and the top two rows of checkboxes were unreadable.
       *
       *  Written as a literal rather than imported from `Z`, for two reasons.
       *  Tailwind scans source text and cannot see a class assembled at runtime,
       *  which is the same reason `Z` itself holds literals. And this component
       *  is generic across planning tables, so importing a constant from one
       *  specific table would couple it to that table's file. If `Z` ever grows
       *  a layer above z-40, this number moves with it. */}
      <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border bg-background p-2 shadow-lg">
        {bands.length > 0
          ? bands.map((band) => {
              const cols = columns.filter((c) => c.band === band);
              if (cols.length === 0) return null;
              const allOn = cols.every((c) => visible.has(c.key));
              return (
                <div key={band} className="mb-2 last:mb-0">
                  <div className="flex items-center justify-between px-1 py-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {pick(bandLabels![band][0], bandLabels![band][1])}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBand(band, !allOn)}
                      className="rounded px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {allOn ? pick("모두 숨기기", "hide all") : pick("모두 보기", "show all")}
                    </button>
                  </div>
                  {cols.map(renderColumn)}
                </div>
              );
            })
          : columns.map(renderColumn)}

        <button
          type="button"
          onClick={() => onChange(new Set(columns.map((c) => c.key)))}
          className="mt-1 w-full rounded border px-2 py-1 text-[12px] hover:bg-muted/60"
        >
          {pick("모든 열 보기", "Show every column")}
        </button>
      </div>
    </details>
  );
}
