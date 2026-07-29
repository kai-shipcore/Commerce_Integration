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
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { ActionListRow } from "./types";

const nf = new Intl.NumberFormat("en-US");

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
    head: "bg-sky-100/70 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    sub: "bg-sky-50/60 dark:bg-sky-950/25",
    edge: "border-l-2 border-l-sky-300 dark:border-l-sky-800",
  },
  dem: {
    head: "bg-teal-100/70 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
    sub: "bg-teal-50/60 dark:bg-teal-950/25",
    edge: "border-l-2 border-l-teal-300 dark:border-l-teal-800",
  },
  act: {
    head: "bg-indigo-100/70 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
    sub: "bg-indigo-50/60 dark:bg-indigo-950/25",
    edge: "border-l-2 border-l-indigo-300 dark:border-l-indigo-800",
  },
} as const;

/** Priority labels exactly as src/planning/calc.py emits them. The casing is
 *  load-bearing: these are dictionary keys, so "Best seller" instead of
 *  "Best Seller" does not fail, it silently falls through to the Routine style
 *  and the badge looks deliberate. Kept in one place and imported by the filter
 *  so the two cannot drift apart. */
export const PRIORITY = {
  preorder: "Preorder",
  noStock: "No Stock",
  bestSeller: "Best Seller",
  routine: "Routine",
} as const;

const PRIORITY_STYLE: Record<string, string> = {
  [PRIORITY.preorder]: "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300",
  [PRIORITY.noStock]: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  [PRIORITY.bestSeller]: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  [PRIORITY.routine]: "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400",
};
const PRIORITY_GLYPH: Record<string, string> = {
  [PRIORITY.preorder]: "◆",
  [PRIORITY.noStock]: "●",
  [PRIORITY.bestSeller]: "★",
  [PRIORITY.routine]: "○",
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
  | "recent_units" | "forecast_total"
  | "days_to_stockout" | "recommended_order_qty" | "error_used";
export type SortDir = "asc" | "desc";
export interface SortCriterion { key: SortKey; dir: SortDir }

/** Columns whose first click should sort ascending. Text sorts A-Z, and
 *  days-to-stockout sorts soonest-first, because "which runs out next" is the
 *  question being asked of it. Everything else is a quantity, where the
 *  interesting end is the large one. */
const DEFAULT_ASC: SortKey[] = ["unique_id", "product_category", "days_to_stockout"];

/** No criteria means the server's own order: priority, then order quantity
 *  within it. That is the worklist order, and it is not reproducible from any
 *  single column, so it is represented as the absence of a sort rather than as
 *  an entry in this list. */
export const DEFAULT_SORT: SortCriterion[] = [];

export function nextSort(
  prev: SortCriterion[],
  key: SortKey,
  shiftKey: boolean,
): SortCriterion[] {
  const idx = prev.findIndex((c) => c.key === key);
  const firstDir: SortDir = DEFAULT_ASC.includes(key) ? "asc" : "desc";
  if (shiftKey) {
    if (idx !== -1) {
      return prev.map((c, i) =>
        i === idx ? { ...c, dir: c.dir === "asc" ? "desc" : "asc" } : c,
      );
    }
    return [...prev, { key, dir: firstDir }];
  }
  // Third click on a single-sorted column clears back to the worklist order,
  // so the default is reachable without hunting for a reset control.
  if (idx !== -1 && prev.length === 1) {
    return prev[0].dir === firstDir
      ? [{ key, dir: firstDir === "asc" ? "desc" : "asc" }]
      : [];
  }
  return [{ key, dir: firstDir }];
}

/** Sort a copy by the given criteria, most significant first.
 *  Nulls always sort last regardless of direction: a SKU with no stockout date
 *  is not the most urgent one, and letting it lead an ascending sort would put
 *  the least informative rows at the top. */
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

function Urgency({ days, date }: { days: number | null; date: string | null }) {
  const { pick } = useI18n();
  if (days === null || !Number.isFinite(days)) {
    return <span className="text-neutral-400">—</span>;
  }
  const urgent = days <= 14;
  const label = days < 1 ? pick("오늘", "today") : `${Math.round(days)}d`;
  return (
    <span className={urgent ? "font-semibold text-red-600 dark:text-red-400" : ""}>
      {label}
      {date && <span className="ml-1 text-[10px] font-normal opacity-60">{date}</span>}
    </span>
  );
}

export function ActionListTable({
  rows,
  skuHref,
  onOpenSku,
  sort = DEFAULT_SORT,
  onSort,
}: {
  rows: ActionListRow[];
  /** Builds the detail URL for a row, including the planning parameters the
   *  list is currently showing. Passed in rather than built here so the table
   *  stays unaware of what those parameters are. */
  skuHref: (sku: string) => string;
  onOpenSku?: (sku: string) => void;
  sort?: SortCriterion[];
  onSort?: (key: SortKey, shiftKey: boolean) => void;
}) {
  const { pick } = useI18n();

  const headers = useMemo(
    () => ({
      sku: pick("SKU", "SKU"),
      priority: pick("우선순위", "Priority"),
      available: pick("가용", "Available"),
      preorder: pick("선주문", "Preord."),
      inbound: pick("입고예정", "Inbound"),
      recent: pick("30일", "30d"),
      forecast: pick("13주 예측", "13w fcst"),
      stockout: pick("품절 시점", "Stocks out"),
      order: pick("발주", "Order"),
      reliability: pick("신뢰도", "Reliability"),
      position: pick("재고 현황", "POSITION"),
      demand: pick("수요", "DEMAND"),
      action: pick("조치", "ACTION"),
    }),
    [pick],
  );

  const sortIcon = (key: SortKey) => {
    const idx = sort.findIndex((c) => c.key === key);
    if (idx === -1) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
    }
    const Arrow = sort[idx].dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <span className="ml-1 inline-flex items-center gap-px align-middle">
        <Arrow className="h-3 w-3" />
        {/* Position marker, shown only when more than one criterion is active,
            so a single sort is not cluttered by a permanent "1". */}
        {sort.length > 1 && (
          <span className="text-[9px] font-semibold leading-none text-primary/70">{idx + 1}</span>
        )}
      </span>
    );
  };

  const th = (key: SortKey, label: string, right = false, extra = "") => (
    <TableHead
      onClick={onSort ? (e) => onSort(key, e.shiftKey) : undefined}
      className={`h-10 whitespace-nowrap ${right ? "text-right" : ""} ${extra} ${
        onSort ? "cursor-pointer select-none hover:text-foreground" : ""
      }`}
      aria-sort={
        sort.find((c) => c.key === key)
          ? sort.find((c) => c.key === key)!.dir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      {label}
      {onSort && sortIcon(key)}
    </TableHead>
  );

  return (
    <div className="relative overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          {/* Band row. Sits above the column names so the three groups read as
              headings rather than as another row of labels. */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-20 h-7 bg-background" />
            <TableHead className="h-7" />
            <TableHead
              colSpan={3}
              className={`h-7 text-center text-[10px] font-semibold uppercase tracking-wider ${BAND.pos.head} ${BAND.pos.edge}`}
            >
              {headers.position}
            </TableHead>
            <TableHead
              colSpan={2}
              className={`h-7 text-center text-[10px] font-semibold uppercase tracking-wider ${BAND.dem.head} ${BAND.dem.edge}`}
            >
              {headers.demand}
            </TableHead>
            <TableHead
              colSpan={3}
              className={`h-7 text-center text-[10px] font-semibold uppercase tracking-wider ${BAND.act.head} ${BAND.act.edge}`}
            >
              {headers.action}
            </TableHead>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            {th("unique_id", headers.sku, false, "sticky left-0 z-20 bg-background")}
            {th("priority_label", headers.priority)}
            {th("available_inventory", headers.available, true, `${BAND.pos.sub} ${BAND.pos.edge}`)}
            {th("preorder_backlog", headers.preorder, true, BAND.pos.sub)}
            {th("confirmed_inbound", headers.inbound, true, BAND.pos.sub)}
            {th("recent_units", headers.recent, true, `${BAND.dem.sub} ${BAND.dem.edge}`)}
            {th("forecast_total", headers.forecast, true, BAND.dem.sub)}
            {th("days_to_stockout", headers.stockout, true, `${BAND.act.sub} ${BAND.act.edge}`)}
            {th("recommended_order_qty", headers.order, true, BAND.act.sub)}
            {th("error_used", headers.reliability, true, BAND.act.sub)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sub = [r.product_category, r.history_group, r.product_name]
              .filter(Boolean)
              .join(" · ");
            return (
              <TableRow key={r.unique_id} className="group">
                <TableCell className="sticky left-0 z-10 bg-background align-top group-hover:bg-muted/50">
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
                    <span className="font-mono text-[11px] underline-offset-2 group-hover:text-sky-600 group-hover:underline dark:group-hover:text-sky-400">
                      {r.unique_id}
                    </span>
                    {r.flags.length > 0 && (
                      <AlertTriangle
                        className="ml-1 inline h-3 w-3 text-amber-500"
                        aria-label={r.flags.join("; ")}
                      />
                    )}
                    {sub && <span className="block text-[10px] text-muted-foreground">{sub}</span>}
                  </Link>
                </TableCell>
                <TableCell className="align-top">
                  <span
                    className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${
                      PRIORITY_STYLE[r.priority_label] ?? PRIORITY_STYLE.Routine
                    }`}
                  >
                    {PRIORITY_GLYPH[r.priority_label] ?? "○"} {r.priority_label}
                  </span>
                </TableCell>
                <TableCell className={`text-right tabular-nums ${BAND.pos.edge}`}>{nf.format(Math.round(r.available_inventory))}</TableCell>
                <TableCell className="text-right tabular-nums">{r.preorder_backlog ? nf.format(Math.round(r.preorder_backlog)) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : "—"}</TableCell>
                <TableCell className={`text-right tabular-nums ${BAND.dem.edge}`}>{nf.format(Math.round(r.recent_units))}</TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(Math.round(r.forecast_total))}</TableCell>
                <TableCell className={`text-right tabular-nums ${BAND.act.edge}`}>
                  <Urgency days={r.days_to_stockout} date={r.estimated_stockout_date} />
                </TableCell>
                <TableCell className="text-right text-[13px] font-semibold tabular-nums">
                  {nf.format(r.recommended_order_qty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={`font-mono text-[11px] ${TIER_STYLE[r.tier] ?? TIER_STYLE.none}`}>
                    {TIER_GLYPH[r.tier] ?? TIER_GLYPH.none}
                  </span>
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {r.wape === null ? pick("미측정", "n/a") : `±${Math.round(r.wape * 100)}%`}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
