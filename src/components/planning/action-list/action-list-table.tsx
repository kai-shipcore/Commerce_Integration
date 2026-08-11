"use client";

/**
 * Code Guide:
 * The action list table — one row per forecastable SKU, banded into what a
 * planner reads in order: POSITION (what is here), DEMAND (what will sell) and
 * ACTION (what to do about it).
 *
 * The banding is not decoration. Ten columns of undifferentiated numbers is the
 * thing this page exists to avoid; grouping them means a row can be read as a
 * sentence rather than scanned. The SKU column is sticky because the table
 * scrolls horizontally on a narrow window, and a horizontally scrolled table
 * with no anchor leaves the reader unable to tell which SKU a row belongs to.
 *
 * Status is never carried by colour alone: every priority badge and reliability
 * marker pairs its colour with a glyph and a text label, so the table survives
 * being printed, screenshotted, or read by someone with colour blindness.
 */

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ColumnHeaderMenu } from "@/components/planning/column-header-menu";
import type { ColumnFilter, DistinctValue } from "@/lib/planning/column-filter";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { ActionListRow } from "./types";

const nf = new Intl.NumberFormat("en-US");

/** `ColumnHeaderMenu` renders a bare `<th>`, not the styled `TableHead`
 *  primitive it replaces on sortable columns, so this table's headers carry
 *  the same base look `TableHead` would otherwise have supplied (copied from
 *  `src/components/ui/table.tsx`). */
const TABLE_HEAD_BASE =
  "text-foreground px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]";

/** Column bands: what is here, what will sell, what to do about it.
 *
 *  Each band gets a tinted header and a coloured edge that runs the full height
 *  of the table, so the three groups stay legible once the reader has scrolled
 *  past the header row. Ten columns of undifferentiated numbers is the thing
 *  this table exists to avoid, and a border alone at the top was not enough to
 *  hold the grouping together further down.
 *
 *  Written as complete class strings rather than assembled from a colour name,
 *  because Tailwind scans source text and cannot see a class built at runtime. */
const BAND = {
  pos: {
    head: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200",
    sub: "bg-sky-50 dark:bg-sky-950",
    edge: "border-l-2 border-l-sky-300 dark:border-l-sky-800",
  },
  dem: {
    head: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200",
    sub: "bg-teal-50 dark:bg-teal-950",
    edge: "border-l-2 border-l-teal-300 dark:border-l-teal-800",
  },
  act: {
    head: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200",
    sub: "bg-indigo-50 dark:bg-indigo-950",
    edge: "border-l-2 border-l-indigo-300 dark:border-l-indigo-800",
  },
} as const;

/** Stacking order for the cells that stick.
 *
 *  Four layers, because two axes stick independently and the corner cell has to
 *  beat both. Backgrounds on every sticky cell are opaque rather than tinted
 *  with an alpha: a translucent header lets the rows scrolling underneath show
 *  through it, which is worse than no header at all.
 *
 *  Every sticky header cell needs an opaque background of its own. A cell that
 *  inherits nothing is transparent, and the rows scrolling underneath it stay
 *  visible through the header, which is how the Priority column came to show
 *  body content through it while scrolling. */
export const Z = {
  headCorner: "z-40", // sticky in both axes
  head: "z-30", // sticky vertically
  bodyLeft: "z-20", // sticky horizontally
} as const;

/** The band row's height, and the offset the column-name row sticks at.
 *
 *  The second row is pinned one pixel higher than the first row is tall, so the
 *  two overlap rather than abut. Abutting assumes the rendered height equals the
 *  declared height, and it does not: the row's bottom border sits outside the
 *  28px, so a hairline opened between the two sticky rows and body content was
 *  visible through it on every scroll. Both rows are opaque, so a one-pixel
 *  overlap cannot be seen, where the one-pixel gap plainly could.
 *
 *  Written as literals because Tailwind scans source text and cannot see a class
 *  assembled from a number at runtime. Change one and change the other. */
export const BAND_ROW_H = "h-[30px]";
export const NAME_ROW_TOP = "top-[29px]";

/** The rule under the band row.
 *
 *  A border is the obvious choice and is the wrong one here. The table collapses
 *  its borders, and a collapsed border belongs to the table's border grid rather
 *  than to the cell, so it does not travel with a cell that has been lifted out
 *  of flow by `position: sticky`. An inset shadow is painted by the cell itself
 *  and stays with it. */
export const BAND_ROW_RULE = "shadow-[inset_0_-1px_0_var(--border)]";

/** Height of the scrolling table window, shared by both planning tables.
 *
 *  Sized to show about twenty rows. A row is roughly 46px: 16px of cell padding
 *  from the table primitive's p-2, plus two lines in the SKU cell (the SKU at
 *  11px and the category subtitle at 10px), plus the row border. Twenty of those
 *  is ~920px, and the two header rows add 68px, so ~62rem.
 *
 *  Capped by the viewport as well, because 62rem exceeds the usable height of a
 *  laptop screen once the page header, summary counts and filters are above it,
 *  and a table taller than the window makes the page itself scroll, which is the
 *  thing the sticky header exists to avoid. Tall monitors get twenty rows;
 *  shorter ones get as many as fit. */
export const TABLE_WINDOW = "max-h-[min(62rem,78vh)]";

/** The optional columns, in render order, grouped by the band they sit under.
 *
 *  SKU and Priority are absent on purpose: SKU is the row's identity and the
 *  pinned column the horizontal scroll is anchored to, and Priority is the
 *  order the worklist is built around. Neither is a detail a reader chooses to
 *  see, so offering to hide them would be offering to break the screen.
 *
 *  Eleven columns do not fit a laptop, which is what forced the horizontal
 *  scroll this exists to relieve. Hiding rather than dropping, because every
 *  one of these was added for a reason and which three matter depends on what
 *  the reader is doing: someone checking coverage wants demand and trend,
 *  someone placing an order wants position and quantity, and the screen cannot
 *  know which. */
export const OPTIONAL_COLUMNS: {
  key: SortKey;
  band: "pos" | "dem" | "act";
  label: [string, string];
}[] = [
  { key: "available_inventory", band: "pos", label: ["가용", "Available"] },
  { key: "preorder_backlog", band: "pos", label: ["선주문", "Preorder"] },
  { key: "confirmed_inbound", band: "pos", label: ["입고예정", "Inbound"] },
  { key: "recent_units", band: "dem", label: ["4주 판매", "4-week sales"] },
  { key: "ramp", band: "dem", label: ["추세", "Trend"] },
  { key: "coverage_demand", band: "dem", label: ["기간 수요", "Demand in window"] },
  { key: "days_to_stockout", band: "act", label: ["품절 시점", "Stocks out"] },
  { key: "recommended_order_qty", band: "act", label: ["발주", "Order"] },
  { key: "wape", band: "act", label: ["신뢰도", "Reliability"] },
];

/** Shown when nothing has been chosen. Everything: the table has always shown
 *  every column, and starting people somewhere narrower would hide figures they
 *  are used to without saying so. The control is the opt-in. */
export const ALL_COLUMNS: SortKey[] = OPTIONAL_COLUMNS.map((c) => c.key);

/** Priority labels exactly as src/planning/calc.py emits them. The casing is
 *  load-bearing: these are dictionary keys, so "No stock" instead of "No Stock"
 *  does not fail, it silently falls through to the Routine style and the badge
 *  looks deliberate. Kept in one place and imported by the filter so the two
 *  cannot drift apart.
 *
 *  Three values of one variable: what the stock situation is. "Best Seller"
 *  used to sit between No Stock and Routine and was removed (BACKLOG.md item
 *  14), because it answers a different question, how much the SKU matters, and
 *  every SKU has both a supply state and an importance at once. One slot could
 *  hold only one of them, and importance always lost, to exactly the queues a
 *  top seller is most likely to be in. Importance is now `best_seller` on the
 *  row, drawn as a star beside the badge, so it is legible in every queue. */
export const PRIORITY = {
  preorder: "Preorder",
  noStock: "No Stock",
  routine: "Routine",
} as const;

export const PRIORITY_STYLE: Record<string, string> = {
  [PRIORITY.preorder]: "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300",
  [PRIORITY.noStock]: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  [PRIORITY.routine]: "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400",
};
export const PRIORITY_GLYPH: Record<string, string> = {
  [PRIORITY.preorder]: "◆",
  [PRIORITY.noStock]: "●",
  [PRIORITY.routine]: "○",
};

/** Direction as a glyph, so trend is never carried by colour alone. */
const TREND_GLYPH: Record<string, string> = {
  rising: "\u2197", steady: "\u2192", falling: "\u2198", collapsing: "\u21ca",
};

const TIER_STYLE: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  fair: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
  none: "text-neutral-400",
};
const TIER_GLYPH: Record<string, string> = {
  good: "●●●", fair: "●●○", poor: "●○○", none: "○○○",
};

export type SortKey =
  | "unique_id" | "product_category" | "priority_label"
  | "available_inventory" | "preorder_backlog" | "confirmed_inbound"
  | "recent_units" | "coverage_demand" | "ramp"
  | "days_to_stockout" | "recommended_order_qty" | "wape";
export type SortDir = "asc" | "desc";
export interface SortCriterion { key: SortKey; dir: SortDir }

/** Columns that can never be hidden: SKU is the row's identity, priority is
 *  the order the worklist is built around. Same rule `OPTIONAL_COLUMNS`
 *  already encodes by omission. */
export const NON_HIDEABLE = new Set<SortKey>(["unique_id", "priority_label"]);

/** Raw value each column filters and sorts on. Rounded to match what the
 *  cell displays, so two rows that render identically also filter as the
 *  same value rather than as two single-row entries apart by float noise. */
export const ACCESSORS: Record<SortKey, (r: ActionListRow) => unknown> = {
  unique_id: (r) => r.unique_id,
  product_category: (r) => r.product_category,
  priority_label: (r) => r.priority_label,
  available_inventory: (r) => Math.round(r.available_inventory),
  preorder_backlog: (r) => Math.round(r.preorder_backlog),
  confirmed_inbound: (r) => Math.round(r.confirmed_inbound),
  recent_units: (r) => Math.round(r.recent_units),
  coverage_demand: (r) => Math.round(r.coverage_demand),
  ramp: (r) => (r.ramp === null || !Number.isFinite(r.ramp) ? null : Number(r.ramp.toFixed(2))),
  days_to_stockout: (r) =>
    r.days_to_stockout === null || !Number.isFinite(r.days_to_stockout) ? null : Math.round(r.days_to_stockout),
  recommended_order_qty: (r) => r.recommended_order_qty,
  wape: (r) => (r.wape === null ? null : Math.round(r.wape * 100)),
};

/** Same figure as the cell prints, for the filter checkbox list's labels. */
export const FORMATTERS: Record<SortKey, (r: ActionListRow) => string> = {
  unique_id: (r) => r.unique_id,
  product_category: (r) => r.product_category ?? "",
  priority_label: (r) => r.priority_label,
  available_inventory: (r) => nf.format(Math.round(r.available_inventory)),
  preorder_backlog: (r) => nf.format(Math.round(r.preorder_backlog)),
  confirmed_inbound: (r) => nf.format(Math.round(r.confirmed_inbound)),
  recent_units: (r) => nf.format(Math.round(r.recent_units)),
  coverage_demand: (r) => nf.format(Math.round(r.coverage_demand)),
  ramp: (r) => (r.ramp === null || !Number.isFinite(r.ramp) ? "" : r.ramp.toFixed(2)),
  days_to_stockout: (r) =>
    r.days_to_stockout === null || !Number.isFinite(r.days_to_stockout) ? "" : String(Math.round(r.days_to_stockout)),
  recommended_order_qty: (r) => nf.format(r.recommended_order_qty),
  wape: (r) => (r.wape === null ? "" : `±${Math.round(r.wape * 100)}%`),
};

/** No criteria means the server's own order: priority, then order quantity
 *  within it. That is the worklist order, and it is not reproducible from any
 *  single column, so it is represented as the absence of a sort rather than as
 *  an entry in this list. */
export const DEFAULT_SORT: SortCriterion[] = [];

/** Column names as they read inside a sentence, for the line that states the
 *  table's current order.
 *
 *  Deliberately not reused from the header labels. A header is a noun squeezed
 *  into a narrow column ("Order", "Trend"); a sentence needs the unabbreviated
 *  phrase, and sharing one string would force one of the two to read badly. */
const SORT_LABEL: Record<SortKey, [string, string]> = {
  unique_id: ["SKU", "SKU"],
  product_category: ["카테고리", "category"],
  priority_label: ["우선순위", "priority"],
  available_inventory: ["가용 재고", "available stock"],
  preorder_backlog: ["예약 주문", "preorder backlog"],
  confirmed_inbound: ["입고 예정", "confirmed inbound"],
  recent_units: ["최근 판매량", "recent units"],
  coverage_demand: ["기간 수요", "demand in the window"],
  ramp: ["수요 추세", "demand trend"],
  days_to_stockout: ["품절까지 일수", "days to stockout"],
  recommended_order_qty: ["권장 발주량", "order quantity"],
  wape: ["예측 신뢰도", "forecast reliability"],
};

const DIR_LABEL: Record<SortDir, [string, string]> = {
  asc: ["오름차순", "low to high"],
  desc: ["내림차순", "high to low"],
};

/** The table's current order, written out.
 *
 *  This replaced a dropdown of named orders. Every entry in that list was also
 *  reachable from a header's own sort menu, including the default: choosing
 *  the opposite direction on an already-sorted column just re-sorts it. So the
 *  control offered no ordering the columns did not already give, while
 *  occupying the width of one and implying it was the way sorting was done.
 *
 *  What was worth keeping is the naming, and only the naming. The default is
 *  the server's priority-then-quantity sequence, is not reproducible from any
 *  one column, and was previously described on screen only as "worklist order"
 *  while being the most load-bearing ordering on the page. A sentence also
 *  covers the case the dropdown could not: a shift-clicked multi-sort had no
 *  entry and displayed as "custom (2 columns)", which names how many criteria
 *  are in force and not one of them.
 */
export function describeSort(sort: SortCriterion[]): [string, string] {
  if (!sort.length) {
    return ["우선순위, 그다음 발주량", "priority, then order quantity"];
  }
  // Direction is spelled out for the first criterion only. Past that it is a
  // tie-break, and naming every direction makes the line longer than the table
  // state it describes.
  const parts = sort.map((c, i): [string, string] => {
    const [ko, en] = SORT_LABEL[c.key];
    const [dirKo, dirEn] = DIR_LABEL[c.dir];
    return i === 0 ? [`${ko} ${dirKo}`, `${en}, ${dirEn}`] : [ko, en];
  });
  return [
    parts.map((p) => p[0]).join(", 그다음 "),
    parts.map((p) => p[1]).join(", then "),
  ];
}

/** Sort a copy by the given criteria, most significant first.
 *  Nulls always sort last regardless of direction: a SKU with no stockout date
 *  is not the most urgent one, and letting it lead an ascending sort would put
 *  the least informative rows at the top.
 *
 *  The reliability column sorts on `wape`, the SKU's own measured error, which
 *  is the figure the cell prints. It previously sorted on `error_used`, the
 *  value safety stock spends, which for an unmeasured SKU is a substituted
 *  cohort or segment figure rather than anything observed about it. Those rows
 *  print "n/a" but carried a real number to sort by, so they interleaved with
 *  measured rows at whatever the substitute happened to be, and the rule above
 *  never fired because the substitute is never null. Sorting on the printed
 *  figure puts every unmeasured SKU at the end in both directions, which is
 *  what "no measurement" should look like in an ordering. Do not point this
 *  back at `error_used` without also displaying it. */
export function sortRows(rows: ActionListRow[], criteria: SortCriterion[]): ActionListRow[] {
  if (!criteria.length) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const { key, dir } of criteria) {
      const av = a[key] as string | number | null | undefined;
      const bv = b[key] as string | number | null | undefined;
      const aNull = av === null || av === undefined || (typeof av === "number" && !Number.isFinite(av));
      const bNull = bv === null || bv === undefined || (typeof bv === "number" && !Number.isFinite(bv));
      if (aNull && bNull) continue;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

function Urgency({
  days,
  date,
  gapDays,
}: {
  days: number | null;
  date: string | null;
  gapDays: number | null;
}) {
  const { pick } = useI18n();
  if (days === null || !Number.isFinite(days)) {
    return <span className="text-neutral-400">—</span>;
  }
  const urgent = days <= 14;
  const label = days < 1 ? pick("오늘", "today") : `${Math.round(days)}d`;
  const gap = gapDays === null ? null : gapDays < 1 ? "<1" : String(Math.round(gapDays));
  return (
    <span className={urgent ? "font-semibold text-red-600 dark:text-red-400" : ""}>
      {label}
      {/* The days at zero, not the container's arrival date. This used to print
          the arrival, which the Inbound column now carries, so it was the same
          number twice and the figure that actually matters, the span between
          running dry and being refilled, was left for the reader to subtract.
          Kept here rather than moved to Inbound because it qualifies the
          stockout: it is the difference between "out in 12 days, and covered"
          and "out in 12 days, then at zero for another 12". On the current table
          none of the 128 rows carrying a gap can close it by ordering today, so
          this is also the only mark on the row saying the recommended quantity
          will not help. */}
      {gap !== null ? (
        <span className="ml-1 whitespace-nowrap text-[11.5px] font-normal text-amber-600 dark:text-amber-400">
          {pick(`· ${gap}일 공백`, `· ${gap}d dry`)}
        </span>
      ) : (
        date && <span className="ml-1 text-[11.5px] font-normal opacity-60">{date}</span>
      )}
    </span>
  );
}

export function ActionListTable({
  rows,
  coverageWeeks,
  skuHref,
  onOpenSku,
  sort = DEFAULT_SORT,
  onSort,
  visible,
  onHideColumn,
  columnFilters = new Map(),
  openFilterKey = null,
  onOpenFilterKeyChange,
  getColumnValues,
  onColumnFilterChange,
}: {
  rows: ActionListRow[];
  /** Lead time plus reorder cycle, for labelling the demand column. The figure
   *  in it is the demand the recommendation is actually built on, so the header
   *  has to name the window rather than the forecast horizon. */
  coverageWeeks: number;
  /** Builds the detail URL for a row, including the planning parameters the
   *  list is currently showing. Passed in rather than built here so the table
   *  stays unaware of what those parameters are. */
  skuHref: (sku: string) => string;
  onOpenSku?: (sku: string) => void;
  sort?: SortCriterion[];
  onSort?: (key: SortKey, dir: SortDir) => void;
  /** Optional columns to render. Undefined shows every one, so a caller that
   *  does not care about column visibility gets the table as it always was. */
  visible?: Set<SortKey>;
  onHideColumn?: (key: SortKey) => void;
  columnFilters?: Map<SortKey, ColumnFilter>;
  /** The one column whose Filter submenu is currently open, so the caller can
   *  compute its distinct values from the full row set rather than this
   *  table's already-paginated `rows`. */
  openFilterKey?: SortKey | null;
  onOpenFilterKeyChange?: (key: SortKey | null) => void;
  getColumnValues?: () => DistinctValue[];
  onColumnFilterChange?: (key: SortKey, next: ColumnFilter | null) => void;
}) {
  const { pick } = useI18n();

  const headers = useMemo(
    () => ({
      sku: pick("SKU", "SKU"),
      priority: pick("우선순위", "Priority"),
      available: pick("가용", "Available"),
      preorder: pick("선주문", "Preord."),
      inbound: pick("입고예정", "Inbound"),
      // Four weeks, not 30 days. `recent_units` sums four W-MON buckets, and the
      // column header said 30d while the SKU detail page said "30-day sales" for
      // the same 28-day figure.
      recent: pick("4주", "4wk"),
      trend: pick("추세", "Trend"),
      // "Next 9w" rather than "9w demand". The band above already says DEMAND,
      // so the word was repeating its own heading, and it was the widest header
      // on the table for a column of four-digit numbers. "Next" is what the
      // column adds over the "4wk" beside it, which is the same measure looking
      // backwards; the exact phrase is on hover.
      forecast: pick(`향후 ${coverageWeeks}주`, `Next ${coverageWeeks}w`),
      forecastHint: pick(
        `발주가 감당해야 할 ${coverageWeeks}주(리드타임 + 발주 주기) 동안의 예측 수요입니다.`,
        `Forecast demand over the ${coverageWeeks} weeks an order has to cover, lead time plus reorder cycle.`,
      ),
      stockout: pick("품절 시점", "Stocks out"),
      order: pick("발주", "Order"),
      reliability: pick("신뢰도", "Reliability"),
      position: pick("재고 현황", "POSITION"),
      demand: pick("수요", "DEMAND"),
      action: pick("조치", "ACTION"),
    }),
    [pick, coverageWeeks],
  );

  // Undefined means "no opinion", which is every column, rather than none.
  const vis = (key: SortKey) => !visible || visible.has(key);

  // Columns still showing in each band, so the band header spans the right
  // number and disappears entirely when its last column is hidden.
  const bandKeys = (band: "pos" | "dem" | "act") =>
    OPTIONAL_COLUMNS.filter((c) => c.band === band && vis(c.key)).map((c) => c.key);

  // The vertical rule that separates bands is drawn on the first column of
  // each, so it has to move when that column is hidden rather than vanishing
  // with it.
  const edge = (band: "pos" | "dem" | "act", key: SortKey) =>
    bandKeys(band)[0] === key ? BAND[band].edge : "";

  const th = (key: SortKey, label: string, right = false, extra = "", hint?: string) => {
    // ColumnHeaderMenu renders a bare <th>, not the styled TableHead
    // primitive, so its base look has to travel in the className passed to
    // it rather than coming from the component itself.
    const cls = `${TABLE_HEAD_BASE} sticky ${NAME_ROW_TOP} ${Z.head} h-10 whitespace-nowrap ${right ? "text-right" : ""} ${extra}`;
    if (!onSort) {
      return (
        <TableHead
          title={hint}
          className={`sticky ${NAME_ROW_TOP} ${Z.head} h-10 whitespace-nowrap ${right ? "text-right" : ""} ${extra}`}
        >
          {label}
        </TableHead>
      );
    }
    const filterSet = columnFilters.get(key) ?? null;
    return (
      <ColumnHeaderMenu
        title={hint}
        className={cls}
        sortDir={sort.find((c) => c.key === key)?.dir ?? null}
        onSortAsc={() => onSort(key, "asc")}
        onSortDesc={() => onSort(key, "desc")}
        filter={
          onColumnFilterChange && onOpenFilterKeyChange && getColumnValues
            ? {
                active: filterSet !== null,
                committed: filterSet,
                getValues: () => (openFilterKey === key ? getColumnValues() : []),
                onApply: (next) => onColumnFilterChange(key, next),
                onOpenChange: (open) => onOpenFilterKeyChange(open ? key : null),
              }
            : undefined
        }
        hide={
          onHideColumn
            ? { canHide: !NON_HIDEABLE.has(key), onHide: () => onHideColumn(key) }
            : undefined
        }
      >
        {label}
      </ColumnHeaderMenu>
    );
  };

  return (
    // Scrolls in both axes with the header and the SKU column pinned. Height is
    // capped rather than growing without limit: the controls above stay useful
    // while reading the table, and pushing them off screen to show more rows is
    // a bad trade.
    <div className={`relative ${TABLE_WINDOW} overflow-auto rounded-md border`}>
      <Table>
        <TableHeader>
          {/* Band row. Sits above the column names so the three groups read as
              headings rather than as another row of labels. */}
          <TableRow className="hover:bg-transparent">
            <TableHead className={`sticky left-0 top-0 ${Z.headCorner} ${BAND_ROW_H} ${BAND_ROW_RULE} bg-background`} />
            <TableHead className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} bg-background`} />
            {bandKeys("pos").length > 0 && (
              <TableHead
                colSpan={bandKeys("pos").length}
                className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} text-center text-[11.5px] font-semibold uppercase tracking-wider ${BAND.pos.head} ${BAND.pos.edge}`}
              >
                {headers.position}
              </TableHead>
            )}
            {bandKeys("dem").length > 0 && (
              <TableHead
                colSpan={bandKeys("dem").length}
                className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} text-center text-[11.5px] font-semibold uppercase tracking-wider ${BAND.dem.head} ${BAND.dem.edge}`}
              >
                {headers.demand}
              </TableHead>
            )}
            {bandKeys("act").length > 0 && (
              <TableHead
                colSpan={bandKeys("act").length}
                className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} text-center text-[11.5px] font-semibold uppercase tracking-wider ${BAND.act.head} ${BAND.act.edge}`}
              >
                {headers.action}
              </TableHead>
            )}
          </TableRow>
          <TableRow className="hover:bg-transparent">
            {th("unique_id", headers.sku, false, `left-0 ${Z.headCorner} bg-background`)}
            {/* Opaque, like every other cell in this row. Without it the rows
                scrolling underneath show through the header. */}
            {th("priority_label", headers.priority, false, "bg-background")}
            {vis("available_inventory") && th("available_inventory", headers.available, true, `${BAND.pos.sub} ${edge("pos", "available_inventory")}`)}
            {vis("preorder_backlog") && th("preorder_backlog", headers.preorder, true, `${BAND.pos.sub} ${edge("pos", "preorder_backlog")}`)}
            {vis("confirmed_inbound") && th("confirmed_inbound", headers.inbound, true, `${BAND.pos.sub} ${edge("pos", "confirmed_inbound")}`)}
            {vis("recent_units") && th("recent_units", headers.recent, true, `${BAND.dem.sub} ${edge("dem", "recent_units")}`)}
            {vis("ramp") && th("ramp", headers.trend, true, `${BAND.dem.sub} ${edge("dem", "ramp")}`)}
            {vis("coverage_demand") && th("coverage_demand", headers.forecast, true, `${BAND.dem.sub} ${edge("dem", "coverage_demand")}`, headers.forecastHint)}
            {vis("days_to_stockout") && th("days_to_stockout", headers.stockout, true, `${BAND.act.sub} ${edge("act", "days_to_stockout")}`)}
            {vis("recommended_order_qty") && th("recommended_order_qty", headers.order, true, `${BAND.act.sub} ${edge("act", "recommended_order_qty")}`)}
            {vis("wape") && th("wape", headers.reliability, true, `${BAND.act.sub} ${edge("act", "wape")}`)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sub = r.product_category ?? "";
            return (
              <TableRow key={r.unique_id} className="group">
                <TableCell className={`sticky left-0 ${Z.bodyLeft} bg-background align-top group-hover:bg-muted/50`}>
                  <Link
                    href={skuHref(r.unique_id)}
                    onClick={(e) => {
                      if (onOpenSku) {
                        e.preventDefault();
                        onOpenSku(r.unique_id);
                      }
                    }}
                    className="block"
                  >
                    <span className="font-mono text-[12.5px] underline-offset-2 group-hover:text-sky-600 group-hover:underline dark:group-hover:text-sky-400">
                      {r.unique_id}
                    </span>
                    {r.flags.length > 0 && (
                      <AlertTriangle
                        className="ml-1 inline h-3 w-3 text-amber-500"
                        aria-label={r.flags.join("; ")}
                      />
                    )}
                    {/* Capped and truncated. Uncapped, this column was the widest on the
                        table and the reason the other eleven were pushed off the
                        right edge: a product name has no length limit, so one long
                        one set the width for every row. The full text is on hover,
                        and the SKU above it is never truncated. */}
                    {sub && (
                      <span
                        className="block max-w-[15rem] truncate text-[11.5px] text-muted-foreground"
                        title={sub}
                      >
                        {sub}
                      </span>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="align-top">
                  <span
                    className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] ${
                      PRIORITY_STYLE[r.priority_label] ?? PRIORITY_STYLE.Routine
                    }`}
                  >
                    {PRIORITY_GLYPH[r.priority_label] ?? "○"} {r.priority_label}
                  </span>
                  {/* Beside the badge rather than inside it: a second fact about
                      the row, not another value of the first. This is what item
                      14 bought. The star now appears on Preorder and No Stock
                      rows, where the old ladder could never show it. */}
                  {r.best_seller && (
                    <span
                      className="ml-1 text-[13px] text-amber-500"
                      title={pick(
                        "최근 4주 판매량의 절반을 차지하는 소수 SKU에 속합니다. 재고 상태와는 별개의 속성입니다.",
                        "One of the products that together make up half of recent demand. An attribute of the product, independent of its stock situation.",
                      )}
                    >
                      ★
                    </span>
                  )}
                </TableCell>
                {vis("available_inventory") && (
                  <TableCell className={`text-right tabular-nums ${edge("pos", "available_inventory")}`}>{nf.format(Math.round(r.available_inventory))}</TableCell>
                )}
                {vis("preorder_backlog") && (
                  <TableCell className={`text-right tabular-nums ${edge("pos", "preorder_backlog")}`}>{r.preorder_backlog ? nf.format(Math.round(r.preorder_backlog)) : "—"}</TableCell>
                )}
                {/* Quantity with the date it lands. The ETA used to appear only
                    in the stockout cell, and only when the container arrives too
                    late, so 248 of the 376 rows carrying inbound showed a
                    quantity with no date anywhere: "500 units, at some point".
                    Days rather than the calendar date, because the question
                    being asked of this cell is whether it beats the stockout
                    figure a few columns over, which is also in days. The date
                    itself is on hover, for anyone coordinating against a
                    specific week. */}
                {vis("confirmed_inbound") && (
                <TableCell className={`text-right align-top tabular-nums ${edge("pos", "confirmed_inbound")}`}>
                  {r.confirmed_inbound ? (
                    <>
                      <span>{nf.format(Math.round(r.confirmed_inbound))}</span>
                      {r.days_to_inbound !== null && Number.isFinite(r.days_to_inbound) && (
                        <span
                          className="block text-[11.5px] font-normal text-muted-foreground"
                          title={r.inbound_eta ?? undefined}
                        >
                          {pick(`${Math.round(r.days_to_inbound)}일 후`, `in ${Math.round(r.days_to_inbound)}d`)}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                )}
                {vis("recent_units") && (
                  <TableCell className={`text-right tabular-nums ${edge("dem", "recent_units")}`}>{nf.format(Math.round(r.recent_units))}</TableCell>
                )}
                {/* The list could filter on trend but never showed it, so a
                    reader could select "falling" and see nothing on the rows
                    saying which way anything was moving. Glyph as well as
                    colour, and the ratio itself, matching the SKU page. */}
                {vis("ramp") && (
                <TableCell className={`text-right tabular-nums ${edge("dem", "ramp")}`}>
                  <span
                    className={`mr-1 ${
                      r.demand_state === "rising" ? "text-emerald-600 dark:text-emerald-400"
                        : r.demand_state === "falling" ? "text-amber-600 dark:text-amber-400"
                        : r.demand_state === "collapsing" ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                    }`}
                    aria-label={r.demand_state}
                  >
                    {TREND_GLYPH[r.demand_state] ?? "·"}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {r.ramp === null || !Number.isFinite(r.ramp) ? "—" : r.ramp.toFixed(2)}
                  </span>
                </TableCell>
                )}
                {/* Demand over the window the order actually covers, not the
                    whole 13-week horizon. The recommendation is built from this
                    figure, so showing the horizon total put a number on the row
                    that nothing else on it adds up to. */}
                {vis("coverage_demand") && (
                  <TableCell className={`text-right tabular-nums ${edge("dem", "coverage_demand")}`}>
                    {nf.format(Math.round(r.coverage_demand))}
                  </TableCell>
                )}
                {vis("days_to_stockout") && (
                <TableCell className={`text-right tabular-nums ${edge("act", "days_to_stockout")}`}>
                  <Urgency
                    days={r.days_to_stockout}
                    date={r.estimated_stockout_date}
                    gapDays={r.supply_gap_days}
                  />
                </TableCell>
                )}
                {/* Draft coverage sits under the recommendation rather than in
                    the Position band with confirmed inbound, because it is a
                    caveat about this number specifically: someone may already
                    have ordered these units. Position is where committed supply
                    lives, and a draft is not committed.
                    Italic and muted, the same treatment the order breakdown
                    gives its aside lines, because this figure is beside the
                    arithmetic and not inside it: the recommendation continues to
                    assume these units will not arrive. Partial coverage is the
                    case that matters, so it is a quantity rather than a badge.
                    A badge would read as "handled" on a SKU drafted for 300
                    against a recommended 1,117, and stop someone looking. */}
                {vis("recommended_order_qty") && (
                <TableCell className={`text-right align-top text-[14px] font-semibold tabular-nums ${edge("act", "recommended_order_qty")}`}>
                  {nf.format(r.recommended_order_qty)}
                  {r.draft_inbound > 0 && (
                    <span
                      className="block text-[11.5px] font-normal italic text-muted-foreground"
                      title={pick(
                        `초안 상태 컨테이너에 ${nf.format(Math.round(r.draft_inbound))}개가 잡혀 있습니다${r.draft_eta ? ` (ETA ${r.draft_eta})` : ""}. 확정 전이므로 권장 수량에서 차감하지 않았습니다.`,
                        `${nf.format(Math.round(r.draft_inbound))} units sit on a container still in draft${r.draft_eta ? `, ETA ${r.draft_eta}` : ""}. Not committed, so it is not subtracted from the recommendation.`,
                      )}
                    >
                      {pick(
                        `초안 ${nf.format(Math.round(r.draft_inbound))}`,
                        `${nf.format(Math.round(r.draft_inbound))} drafted`,
                      )}
                    </span>
                  )}
                </TableCell>
                )}
                {vis("wape") && (
                <TableCell className={`text-right tabular-nums ${edge("act", "wape")}`}>
                  <span className={`font-mono text-[12.5px] ${TIER_STYLE[r.tier] ?? TIER_STYLE.none}`}>
                    {TIER_GLYPH[r.tier] ?? TIER_GLYPH.none}
                  </span>
                  {/* The substituted figure is no longer reachable by sorting
                      this column, so an unmeasured row says on hover what its
                      safety stock was actually sized on. Without it the stand-in
                      is invisible from the list entirely. */}
                  <span
                    className="ml-1.5 text-[12.5px] text-muted-foreground"
                    title={
                      r.wape === null
                        ? pick(
                            `백테스트 구간 없음 · 안전재고는 ${r.error_basis} ±${Math.round(r.error_used * 100)}% 사용`,
                            `No backtest window covers this SKU · safety stock uses the ${r.error_basis}, ±${Math.round(r.error_used * 100)}%`,
                          )
                        : pick(
                            `백테스트 ${r.n_windows}개 구간에서 측정`,
                            `measured over ${r.n_windows} backtest window${r.n_windows === 1 ? "" : "s"}`,
                          )
                    }
                  >
                    {r.wape === null ? pick("미측정", "n/a") : `±${Math.round(r.wape * 100)}%`}
                  </span>
                </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
