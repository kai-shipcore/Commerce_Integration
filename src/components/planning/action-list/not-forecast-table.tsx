"use client";

/**
 * Code Guide:
 * The non-forecast section — SKUs segmentation excludes from forecasting.
 *
 * The column headings are deliberately not the ones on the forecast table. That
 * table's demand figures come from a scored model with a measured error; these
 * come from a 13-week average and have no error attached. Putting them under
 * matching headings would invite reading a rate as a forecast, so "13w demand",
 * "per week" and "cover" appear here and nowhere else.
 *
 * There is no order quantity column, and its absence is the honest answer
 * rather than an omission: how much to buy needs a demand model these SKUs do
 * not have. What the section can say is when stock runs out relative to how long
 * a replacement takes, which is the reorder signal.
 */

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ColumnHeaderMenu, type SortDir } from "@/components/planning/column-header-menu";
import type { ColumnFilter, DistinctValue } from "@/lib/planning/column-filter";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  BAND_ROW_H, BAND_ROW_RULE, NAME_ROW_TOP, TABLE_WINDOW, Z,
} from "./action-list-table";
import type { NotForecastRow } from "./types";

const nf = new Intl.NumberFormat("en-US");

/** `ColumnHeaderMenu` renders a bare `<th>`, not the styled `TableHead`
 *  primitive it replaces on sortable columns, so this table's headers carry
 *  the same base look `TableHead` would otherwise have supplied. */
const TABLE_HEAD_BASE =
  "text-foreground px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]";

/** Two bands here rather than the forecast table's three: what it has sold, and
 *  where its stock stands. Deliberately different colours from that table, so
 *  the eye does not carry an association across between a scored figure and one
 *  averaged from recent sales. */
const NF_BAND = {
  sold: {
    head: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sub: "bg-slate-50 dark:bg-slate-900",
    edge: "border-l-2 border-l-slate-300 dark:border-l-slate-700",
  },
  stock: {
    head: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    sub: "bg-amber-50 dark:bg-amber-950",
    edge: "border-l-2 border-l-amber-300 dark:border-l-amber-800",
  },
} as const;

// Stacking order, band-row height and the rule beneath it are imported from the
// forecast table rather than restated here. They were copied, and the copy went
// stale: the fix for the hairline between the two sticky header rows landed on
// one table and not the other, which is the failure mode a shared constant
// exists to prevent.

export type NfSortKey =
  | "unique_id" | "product_category" | "recent_units" | "weekly_rate"
  | "available_inventory" | "days_of_cover" | "last_sale_week" | "confirmed_inbound";
export interface NfSort { key: NfSortKey; dir: "asc" | "desc" }

export const NF_DEFAULT_SORT: NfSort[] = [];

/** Only SKU is non-hideable: it is the row's identity and link target.
 *  `product_category` never gets a header cell of its own (it prints as the
 *  SKU cell's subtitle), so it never reaches the menu that would need this
 *  rule anyway. */
export const NF_NON_HIDEABLE = new Set<NfSortKey>(["unique_id"]);

/** The columns a header's own menu can hide, in render order, banded the same
 *  way the table itself is: what it has sold, and where its stock stands. */
export const NF_OPTIONAL_COLUMNS: { key: NfSortKey; band: "sold" | "stock"; label: [string, string] }[] = [
  { key: "recent_units", band: "sold", label: ["13주 판매", "13w demand"] },
  { key: "weekly_rate", band: "sold", label: ["주당", "per week"] },
  { key: "last_sale_week", band: "sold", label: ["최근 판매", "Last sale"] },
  { key: "available_inventory", band: "stock", label: ["가용", "Available"] },
  { key: "confirmed_inbound", band: "stock", label: ["입고예정", "Inbound"] },
  { key: "days_of_cover", band: "stock", label: ["재고 여유", "Cover"] },
];
export const NF_ALL_COLUMNS: NfSortKey[] = NF_OPTIONAL_COLUMNS.map((c) => c.key);

/** Raw value each column filters and sorts on, rounded to match the cell. */
export const NF_ACCESSORS: Record<NfSortKey, (r: NotForecastRow) => unknown> = {
  unique_id: (r) => r.unique_id,
  product_category: (r) => r.product_category,
  recent_units: (r) => (r.recent_units ? Math.round(r.recent_units) : 0),
  weekly_rate: (r) => (r.recent_units ? Number(r.weekly_rate.toFixed(1)) : null),
  last_sale_week: (r) => r.last_sale_week,
  available_inventory: (r) => (r.available_inventory === null ? null : Math.round(r.available_inventory)),
  confirmed_inbound: (r) => (r.confirmed_inbound ? Math.round(r.confirmed_inbound) : 0),
  days_of_cover: (r) => (r.days_of_cover === null ? null : Math.round(r.days_of_cover)),
};

/** Same figure as the cell prints, for the filter checkbox list's labels. */
export const NF_FORMATTERS: Record<NfSortKey, (r: NotForecastRow) => string> = {
  unique_id: (r) => r.unique_id,
  product_category: (r) => r.product_category ?? "",
  recent_units: (r) => (r.recent_units ? nf.format(Math.round(r.recent_units)) : ""),
  weekly_rate: (r) => (r.recent_units ? r.weekly_rate.toFixed(1) : ""),
  last_sale_week: (r) => r.last_sale_week ?? "",
  available_inventory: (r) => (r.available_inventory === null ? "" : nf.format(Math.round(r.available_inventory))),
  confirmed_inbound: (r) => (r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : ""),
  days_of_cover: (r) => (r.days_of_cover === null ? "" : `${Math.round(r.days_of_cover)}d`),
};

export function nfSortRows(rows: NotForecastRow[], criteria: NfSort[]): NotForecastRow[] {
  if (!criteria.length) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const { key, dir } of criteria) {
      const av = a[key] as string | number | null;
      const bv = b[key] as string | number | null;
      const aN = av === null || av === undefined || (typeof av === "number" && !Number.isFinite(av));
      const bN = bv === null || bv === undefined || (typeof bv === "number" && !Number.isFinite(bv));
      if (aN && bN) continue;
      if (aN) return 1;
      if (bN) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

export function NotForecastTable({
  rows,
  skuHref,
  sort = NF_DEFAULT_SORT,
  onSort,
  visible,
  onHideColumn,
  columnFilters = new Map(),
  openFilterKey = null,
  onOpenFilterKeyChange,
  getColumnValues,
  onColumnFilterChange,
}: {
  rows: NotForecastRow[];
  /** Builds the detail URL for a row, including the planning parameters the
   *  section is showing. Passed in for the same reason the forecast table takes
   *  it: the table stays unaware of what those parameters are. */
  skuHref: (sku: string) => string;
  sort?: NfSort[];
  onSort?: (key: NfSortKey, dir: SortDir) => void;
  /** Optional columns to render. Undefined shows every one. */
  visible?: Set<NfSortKey>;
  onHideColumn?: (key: NfSortKey) => void;
  columnFilters?: Map<NfSortKey, ColumnFilter>;
  openFilterKey?: NfSortKey | null;
  onOpenFilterKeyChange?: (key: NfSortKey | null) => void;
  getColumnValues?: () => DistinctValue[];
  onColumnFilterChange?: (key: NfSortKey, next: ColumnFilter | null) => void;
}) {
  const { pick } = useI18n();

  const h = useMemo(
    () => ({
      sku: pick("SKU", "SKU"),
      demand: pick("13주 판매", "13w demand"),
      rate: pick("주당", "per week"),
      lastSale: pick("최근 판매", "Last sale"),
      stock: pick("가용", "Available"),
      inbound: pick("입고예정", "Inbound"),
      cover: pick("재고 여유", "Cover"),
      soldBand: pick("최근 판매", "RECENT SALES"),
      stockBand: pick("재고 현황", "STOCK POSITION"),
    }),
    [pick],
  );

  // Undefined means "no opinion", which is every column, rather than none.
  const vis = (key: NfSortKey) => !visible || visible.has(key);
  const bandKeys = (band: "sold" | "stock") =>
    NF_OPTIONAL_COLUMNS.filter((c) => c.band === band && vis(c.key)).map((c) => c.key);
  const edge = (band: "sold" | "stock", key: NfSortKey) =>
    bandKeys(band)[0] === key ? NF_BAND[band].edge : "";

  const th = (key: NfSortKey, label: string, right = false, extra = "") => {
    const cls = `${TABLE_HEAD_BASE} sticky ${NAME_ROW_TOP} ${Z.head} h-10 whitespace-nowrap ${right ? "text-right" : ""} ${extra}`;
    if (!onSort) {
      return (
        <TableHead className={`sticky ${NAME_ROW_TOP} ${Z.head} h-10 whitespace-nowrap ${right ? "text-right" : ""} ${extra}`}>
          {label}
        </TableHead>
      );
    }
    const filterSet = columnFilters.get(key) ?? null;
    return (
      <ColumnHeaderMenu
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
            ? { canHide: !NF_NON_HIDEABLE.has(key), onHide: () => onHideColumn(key) }
            : undefined
        }
      >
        {label}
      </ColumnHeaderMenu>
    );
  };

  return (
    <div className={`relative ${TABLE_WINDOW} overflow-auto rounded-md border`}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`sticky left-0 top-0 ${Z.headCorner} ${BAND_ROW_H} ${BAND_ROW_RULE} bg-background`} />
            {bandKeys("sold").length > 0 && (
              <TableHead
                colSpan={bandKeys("sold").length}
                className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} text-center text-[11.5px] font-semibold uppercase tracking-wider ${NF_BAND.sold.head} ${NF_BAND.sold.edge}`}
              >
                {h.soldBand}
              </TableHead>
            )}
            {bandKeys("stock").length > 0 && (
              <TableHead
                colSpan={bandKeys("stock").length}
                className={`sticky top-0 ${Z.head} ${BAND_ROW_H} ${BAND_ROW_RULE} text-center text-[11.5px] font-semibold uppercase tracking-wider ${NF_BAND.stock.head} ${NF_BAND.stock.edge}`}
              >
                {h.stockBand}
              </TableHead>
            )}
          </TableRow>
          <TableRow className="hover:bg-transparent">
            {th("unique_id", h.sku, false, `left-0 ${Z.headCorner} bg-background`)}
            {vis("recent_units") && th("recent_units", h.demand, true, `${NF_BAND.sold.sub} ${edge("sold", "recent_units")}`)}
            {vis("weekly_rate") && th("weekly_rate", h.rate, true, NF_BAND.sold.sub)}
            {vis("last_sale_week") && th("last_sale_week", h.lastSale, true, NF_BAND.sold.sub)}
            {vis("available_inventory") && th("available_inventory", h.stock, true, `${NF_BAND.stock.sub} ${edge("stock", "available_inventory")}`)}
            {vis("confirmed_inbound") && th("confirmed_inbound", h.inbound, true, NF_BAND.stock.sub)}
            {vis("days_of_cover") && th("days_of_cover", h.cover, true, NF_BAND.stock.sub)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sub = r.product_category ?? "";
            return (
              <TableRow key={r.unique_id} className="group">
                {/* Linked, like the forecast table's rows. The detail page has
                    no planning figures for these SKUs and says so, then draws
                    their sales history, which is the only honest thing it can
                    show. Unlinked, that page was reachable only by typing a
                    URL. */}
                <TableCell className={`sticky left-0 ${Z.bodyLeft} bg-background align-top group-hover:bg-muted/50`}>
                  <Link href={skuHref(r.unique_id)} className="block">
                    <span className="font-mono text-[12.5px] underline-offset-2 group-hover:text-sky-600 group-hover:underline dark:group-hover:text-sky-400">
                      {r.unique_id}
                    </span>
                    {r.reorder_signal && (
                      <AlertTriangle
                        className="ml-1 inline h-3 w-3 text-amber-500"
                        aria-label={pick("리드타임 내 소진", "runs out inside the lead time")}
                      />
                    )}
                    {sub && <span className="block text-[11.5px] text-muted-foreground">{sub}</span>}
                  </Link>
                </TableCell>
                {vis("recent_units") && (
                  <TableCell className={`text-right tabular-nums ${edge("sold", "recent_units")}`}>
                    {r.recent_units ? nf.format(Math.round(r.recent_units)) : "—"}
                  </TableCell>
                )}
                {vis("weekly_rate") && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.recent_units ? r.weekly_rate.toFixed(1) : "—"}
                  </TableCell>
                )}
                {vis("last_sale_week") && (
                  <TableCell className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {r.last_sale_week ?? "—"}
                  </TableCell>
                )}
                {/* Null and zero are shown differently on purpose: an em dash
                    means no inventory record exists, 0 means the record says
                    none. Collapsing them would turn missing data into a fact. */}
                {vis("available_inventory") && (
                  <TableCell className={`text-right tabular-nums ${edge("stock", "available_inventory")}`}>
                    {r.available_inventory === null ? "—" : nf.format(Math.round(r.available_inventory))}
                  </TableCell>
                )}
                {vis("confirmed_inbound") && (
                  <TableCell className="text-right tabular-nums">
                    {r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : "—"}
                  </TableCell>
                )}
                {vis("days_of_cover") && (
                  <TableCell className="text-right tabular-nums">
                    {r.days_of_cover === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={r.reorder_signal ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                        {Math.round(r.days_of_cover)}d
                      </span>
                    )}
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
