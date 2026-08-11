"use client";

/**
 * Code Guide:
 * A column header that answers to right-click instead of left-click.
 *
 * Every planning table used to sort itself the instant a header was clicked,
 * which is a hazard on a screen built for purchasing decisions: a stray click
 * silently reorders the worklist. Right-clicking a header now opens a menu —
 * Sort A→Z, Sort Z→A, Filter, Hide column — Google-Sheets-style, so nothing
 * happens on this table until it's asked for on purpose. Left-clicking the
 * header text does nothing; a chevron that fades in on hover opens the same
 * menu for anyone who wouldn't think to right-click.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Funnel } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  CONDITION_OPERATORS, type ColumnFilter, type ConditionFilter, type DistinctValue,
} from "@/lib/planning/column-filter";

export type SortDir = "asc" | "desc";

export interface ColumnFilterProps {
  /** True when a filter (either mode) is committed — drives the funnel icon. */
  active: boolean;
  /** Currently committed filter, or null for "everything". Seeds the
   *  submenu when it opens. */
  committed: ColumnFilter | null;
  /** Computed lazily by the caller, only while this column's submenu is open —
   *  see the container components for why this must stay lazy. Only used by
   *  the "Filter by values" tab. */
  getValues: () => DistinctValue[];
  /** null clears the filter. */
  onApply: (next: ColumnFilter | null) => void;
  /** Fires as the Filter submenu opens and closes, so the caller knows which
   *  column's distinct values `getValues` needs to be able to answer for
   *  before this submenu actually mounts and calls it. */
  onOpenChange?: (open: boolean) => void;
}

const TEXT_CONDITION_GROUP = CONDITION_OPERATORS.filter((o) => o.group === 2);
const NUMBER_CONDITION_GROUP = CONDITION_OPERATORS.filter((o) => o.group === 3);
const NO_INPUT_CONDITIONS = CONDITION_OPERATORS.filter((o) => o.group === 1);

function ConditionFilterFields({
  condition,
  onChange,
}: {
  condition: ConditionFilter | null;
  onChange: (next: ConditionFilter | null) => void;
}) {
  const { pick } = useI18n();
  const meta = condition ? CONDITION_OPERATORS.find((o) => o.operator === condition.operator) : undefined;

  return (
    <div className="space-y-1.5 px-1">
      <select
        value={condition?.operator ?? "none"}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "none") { onChange(null); return; }
          onChange({ operator: next as ConditionFilter["operator"], value: "", value2: "" });
        }}
        className="h-7 w-full rounded border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="none">{pick("없음", "None")}</option>
        {NO_INPUT_CONDITIONS.map((o) => (
          <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
        ))}
        <optgroup label={pick("텍스트", "Text")}>
          {TEXT_CONDITION_GROUP.map((o) => (
            <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
          ))}
        </optgroup>
        <optgroup label={pick("숫자", "Number")}>
          {NUMBER_CONDITION_GROUP.map((o) => (
            <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
          ))}
        </optgroup>
      </select>
      {meta && meta.inputs > 0 && (
        <div className="flex items-center gap-1">
          <input
            type={meta.inputType}
            value={condition?.value ?? ""}
            onChange={(e) => onChange({ ...(condition as ConditionFilter), value: e.target.value })}
            placeholder={pick("값", "Value")}
            className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => e.stopPropagation()}
          />
          {meta.inputs === 2 && (
            <>
              <span className="text-xs text-muted-foreground">~</span>
              <input
                type={meta.inputType}
                value={condition?.value2 ?? ""}
                onChange={(e) => onChange({ ...(condition as ConditionFilter), value2: e.target.value })}
                placeholder={pick("값", "Value")}
                className="h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnFilterBody({
  committed,
  getValues,
  onApply,
  onDone,
}: ColumnFilterProps & { onDone: () => void }) {
  const { pick } = useI18n();
  const [mode, setMode] = useState<"values" | "condition">(committed?.mode ?? "values");
  // Computed once per mount, i.e. once per time the submenu opens — not on
  // every keystroke of the search box below.
  const values = useMemo(() => getValues(), [getValues]);
  const [staged, setStaged] = useState<Set<string>>(
    () => new Set(committed?.mode === "values" ? committed.values : values.map((v) => v.value)),
  );
  const [condition, setCondition] = useState<ConditionFilter | null>(
    committed?.mode === "condition" ? committed.condition : null,
  );
  const [search, setSearch] = useState("");
  const shown = values.filter((v) => v.label.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="w-64 p-1">
      <div className="mb-1 flex gap-1 border-b pb-1 text-[11px]">
        <button
          type="button"
          onClick={() => setMode("condition")}
          className={`rounded px-1.5 py-0.5 ${mode === "condition" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {pick("조건별 필터", "Filter by condition")}
        </button>
        <button
          type="button"
          onClick={() => setMode("values")}
          className={`rounded px-1.5 py-0.5 ${mode === "values" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {pick("값별 필터", "Filter by values")}
        </button>
      </div>
      {mode === "condition" ? (
        <ConditionFilterFields condition={condition} onChange={setCondition} />
      ) : (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={pick("값 검색…", "Search values…")}
            className="mb-1 h-7 w-full rounded border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="flex justify-between px-1 pb-1 text-[11px] text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setStaged(new Set(values.map((v) => v.value)))}
            >
              {pick("모두 선택", "Select all")}
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setStaged(new Set())}
            >
              {pick("모두 지우기", "Clear")}
            </button>
          </div>
          <div className="max-h-56 overflow-auto">
            {shown.map((v) => (
              <DropdownMenuCheckboxItem
                key={v.value}
                checked={staged.has(v.value)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) =>
                  setStaged((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(v.value);
                    else next.delete(v.value);
                    return next;
                  })
                }
              >
                <span className="truncate">{v.label}</span>
                <span className="ml-auto tabular-nums text-muted-foreground/70">{v.count}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {shown.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {pick("일치하는 값 없음", "No matching values")}
              </p>
            )}
          </div>
        </>
      )}
      <div className="mt-1 flex justify-end gap-1 border-t pt-1">
        <DropdownMenuItem onSelect={onDone}>{pick("취소", "Cancel")}</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (mode === "condition") {
              onApply(condition === null ? null : { mode: "condition", condition });
            } else {
              onApply(staged.size === values.length ? null : { mode: "values", values: staged });
            }
            onDone();
          }}
        >
          {pick("적용", "Apply")}
        </DropdownMenuItem>
      </div>
    </div>
  );
}

export function ColumnHeaderMenu({
  children,
  className,
  title,
  sortDir,
  onSortAsc,
  onSortDesc,
  filter,
  hide,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  sortDir: SortDir | null;
  onSortAsc: () => void;
  onSortDesc: () => void;
  /** Omit to disable the Filter item on this column. */
  filter?: ColumnFilterProps;
  /** Omit to disable Hide entirely (no way to re-show the column otherwise). */
  hide?: { canHide: boolean; onHide: () => void };
}) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    // `open` is fully controlled: a right-click anywhere on the header cell
    // sets it directly, and the chevron button below is the only element
    // wrapped by DropdownMenuTrigger (Radix needs a trigger in the tree to
    // anchor DropdownMenuContent's position, but the trigger's own built-in
    // click-to-open behavior must land on the small chevron, not the whole
    // `<th>` — the header cell itself must stay inert to a left-click).
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <th
        title={title}
        className={`group relative ${className ?? ""}`}
        aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none"}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
        {sortDir === "asc" && <ArrowUp className="ml-1 inline h-3 w-3" />}
        {sortDir === "desc" && <ArrowDown className="ml-1 inline h-3 w-3" />}
        {filter?.active && (
          <Funnel
            className="ml-1 inline h-3 w-3 text-sky-600 dark:text-sky-400"
            aria-label={pick("필터 적용됨", "Filtered")}
          />
        )}
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={pick("열 옵션", "Column options")}
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 outline-none group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
      </th>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onSortAsc}>{pick("오름차순 정렬 (A→Z)", "Sort A → Z")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onSortDesc}>{pick("내림차순 정렬 (Z→A)", "Sort Z → A")}</DropdownMenuItem>
        {filter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub onOpenChange={filter.onOpenChange}>
              <DropdownMenuSubTrigger>{pick("필터", "Filter")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <ColumnFilterBody {...filter} onDone={() => setOpen(false)} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hide || !hide.canHide} onSelect={hide?.onHide}>
          {pick("열 숨기기", "Hide column")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
