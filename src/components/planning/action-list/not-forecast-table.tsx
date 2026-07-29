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
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { TABLE_WINDOW } from "./action-list-table";
import type { NotForecastRow } from "./types";

const nf = new Intl.NumberFormat("en-US");

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

// Opaque backgrounds and the same four-layer stacking as the forecast table:
// a translucent sticky header lets the rows underneath show through it.
const BAND_ROW_H = "top-7";
const Z = { headCorner: "z-40", head: "z-30", bodyLeft: "z-20" } as const;

export type NfSortKey =
  | "unique_id" | "product_category" | "recent_units" | "weekly_rate"
  | "available_inventory" | "days_of_cover" | "last_sale_week" | "confirmed_inbound";
export interface NfSort { key: NfSortKey; dir: "asc" | "desc" }

const NF_DEFAULT_ASC: NfSortKey[] = ["unique_id", "product_category", "days_of_cover"];
export const NF_DEFAULT_SORT: NfSort[] = [];

export function nfNextSort(prev: NfSort[], key: NfSortKey, shiftKey: boolean): NfSort[] {
  const idx = prev.findIndex((c) => c.key === key);
  const firstDir: "asc" | "desc" = NF_DEFAULT_ASC.includes(key) ? "asc" : "desc";
  if (shiftKey) {
    if (idx !== -1) {
      return prev.map((c, i) => (i === idx ? { ...c, dir: c.dir === "asc" ? "desc" : "asc" } : c));
    }
    return [...prev, { key, dir: firstDir }];
  }
  if (idx !== -1 && prev.length === 1) {
    return prev[0].dir === firstDir ? [{ key, dir: firstDir === "asc" ? "desc" : "asc" }] : [];
  }
  return [{ key, dir: firstDir }];
}

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
  sort = NF_DEFAULT_SORT,
  onSort,
}: {
  rows: NotForecastRow[];
  sort?: NfSort[];
  onSort?: (key: NfSortKey, shiftKey: boolean) => void;
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

  const icon = (key: NfSortKey) => {
    const idx = sort.findIndex((c) => c.key === key);
    if (idx === -1) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
    const Arrow = sort[idx].dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <span className="ml-1 inline-flex items-center gap-px align-middle">
        <Arrow className="h-3 w-3" />
        {sort.length > 1 && (
          <span className="text-[9px] font-semibold leading-none text-primary/70">{idx + 1}</span>
        )}
      </span>
    );
  };

  const th = (key: NfSortKey, label: string, right = false, extra = "") => (
    <TableHead
      onClick={onSort ? (e) => onSort(key, e.shiftKey) : undefined}
      className={`sticky ${BAND_ROW_H} ${Z.head} h-10 whitespace-nowrap ${
        right ? "text-right" : ""
      } ${extra} ${onSort ? "cursor-pointer select-none hover:text-foreground" : ""}`}
    >
      {label}
      {onSort && icon(key)}
    </TableHead>
  );

  return (
    <div className={`relative ${TABLE_WINDOW} overflow-auto rounded-md border`}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`sticky left-0 top-0 ${Z.headCorner} h-7 bg-background`} />
            <TableHead
              colSpan={3}
              className={`sticky top-0 ${Z.head} h-7 text-center text-[10px] font-semibold uppercase tracking-wider ${NF_BAND.sold.head} ${NF_BAND.sold.edge}`}
            >
              {h.soldBand}
            </TableHead>
            <TableHead
              colSpan={3}
              className={`sticky top-0 ${Z.head} h-7 text-center text-[10px] font-semibold uppercase tracking-wider ${NF_BAND.stock.head} ${NF_BAND.stock.edge}`}
            >
              {h.stockBand}
            </TableHead>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            {th("unique_id", h.sku, false, `left-0 ${Z.headCorner} bg-background`)}
            {th("recent_units", h.demand, true, `${NF_BAND.sold.sub} ${NF_BAND.sold.edge}`)}
            {th("weekly_rate", h.rate, true, NF_BAND.sold.sub)}
            {th("last_sale_week", h.lastSale, true, NF_BAND.sold.sub)}
            {th("available_inventory", h.stock, true, `${NF_BAND.stock.sub} ${NF_BAND.stock.edge}`)}
            {th("confirmed_inbound", h.inbound, true, NF_BAND.stock.sub)}
            {th("days_of_cover", h.cover, true, NF_BAND.stock.sub)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sub = [r.product_category, r.product_name].filter(Boolean).join(" · ");
            return (
              <TableRow key={r.unique_id} className="group">
                <TableCell className={`sticky left-0 ${Z.bodyLeft} bg-background align-top group-hover:bg-muted/50`}>
                  <span className="font-mono text-[11px]">{r.unique_id}</span>
                  {r.reorder_signal && (
                    <AlertTriangle
                      className="ml-1 inline h-3 w-3 text-amber-500"
                      aria-label={pick("리드타임 내 소진", "runs out inside the lead time")}
                    />
                  )}
                  {sub && <span className="block text-[10px] text-muted-foreground">{sub}</span>}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${NF_BAND.sold.edge}`}>
                  {r.recent_units ? nf.format(Math.round(r.recent_units)) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.recent_units ? r.weekly_rate.toFixed(1) : "—"}
                </TableCell>
                <TableCell className="text-right text-[11px] tabular-nums text-muted-foreground">
                  {r.last_sale_week ?? "—"}
                </TableCell>
                {/* Null and zero are shown differently on purpose: an em dash
                    means no inventory record exists, 0 means the record says
                    none. Collapsing them would turn missing data into a fact. */}
                <TableCell className={`text-right tabular-nums ${NF_BAND.stock.edge}`}>
                  {r.available_inventory === null ? "—" : nf.format(Math.round(r.available_inventory))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.days_of_cover === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={r.reorder_signal ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                      {Math.round(r.days_of_cover)}d
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
