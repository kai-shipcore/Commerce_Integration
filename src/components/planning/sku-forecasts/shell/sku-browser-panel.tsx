import { useMemo, useState } from "react";
import type { DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber, getUrgency, productLabels, type ProductKey } from "../types";

type SortKey = "sku" | "stock" | "avg" | "sod";
type SortDirection = "asc" | "desc";

interface SkuBrowserPanelProps {
  product: ProductKey;
  productCounts: Record<ProductKey, number>;
  onProductChange: (product: ProductKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  rows: DemandRow[];
  selectedSkuId: string;
  onSelectSku: (skuId: string) => void;
}

const urgencyStyles = {
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  watch: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};

const sortLabels: Record<SortKey, string> = {
  sku: "Master SKU",
  stock: "Stock",
  avg: "Avg",
  sod: "SOD",
};

function SortHeader({
  label,
  sortId,
  activeKey,
  direction,
  align = "left",
  onSort,
}: {
  label: string;
  sortId: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  align?: "left" | "right";
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortId;
  return (
    <button
      type="button"
      onClick={() => onSort(sortId)}
      className={`flex items-center gap-1 whitespace-nowrap ${align === "right" ? "justify-end text-right" : "text-left"} ${active ? "text-[#1a4db0] dark:text-blue-400" : ""}`}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px]">{active ? (direction === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
  );
}

export function SkuBrowserPanel({
  product,
  productCounts,
  onProductChange,
  search,
  onSearchChange,
  rows,
  selectedSkuId,
  onSelectSku,
}: SkuBrowserPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => {
      let result = 0;
      if (sortKey === "sku") {
        result = left.sku.localeCompare(right.sku, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "stock") {
        result = left.total_stock - right.total_stock;
      } else if (sortKey === "avg") {
        result = left.total_avg_curr - right.total_avg_curr;
      } else {
        const leftDays = daysUntil(left.sod);
        const rightDays = daysUntil(right.sod);
        result = (leftDays ?? Number.POSITIVE_INFINITY) - (rightDays ?? Number.POSITIVE_INFINITY);
      }
      return sortDirection === "asc" ? result : -result;
    }),
    [rows, sortDirection, sortKey],
  );

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "sku" ? "asc" : "desc");
  }

  return (
    <aside className="planning-panel flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="grid grid-cols-3 border-b">
        {(Object.keys(productLabels) as ProductKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`px-2 py-3 text-xs font-semibold ${
              product === key ? "bg-[#ebf0fd] text-[#1a4db0] dark:bg-blue-900/40 dark:text-blue-300" : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700/60"
            }`}
            onClick={() => onProductChange(key)}
          >
            {productLabels[key]}
            <span className="ml-1 font-mono text-[10px]">{formatNumber(productCounts[key])}</span>
          </button>
        ))}
      </div>
      <div className="border-b p-3">
        <div className="relative">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search master SKU..."
            className="h-9 w-full rounded-md border bg-[#f0eee9] px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 pr-8"
          />
          {search ? (
            <button
              type="button"
              aria-label="Reset search"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full border border-[#cccac4] bg-white text-xs font-bold text-[#5A5750] hover:bg-[#f0eee9] dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No SKUs</div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <div className="grid grid-cols-[minmax(260px,1fr)_78px_76px_68px] gap-2 border-b bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">
              {(["sku", "stock", "avg", "sod"] as SortKey[]).map((key) => (
                <SortHeader
                  key={key}
                  label={sortLabels[key]}
                  sortId={key}
                  activeKey={sortKey}
                  direction={sortDirection}
                  align={key === "sku" ? "left" : "right"}
                  onSort={toggleSort}
                />
              ))}
            </div>
            <div className="divide-y">
              {sortedRows.map((row) => {
                const selected = selectedSkuId === row.sku;
                const urgency = getUrgency(row);
                const days = daysUntil(row.sod);
                return (
                  <button
                    key={row.sku}
                    type="button"
                    onClick={() => onSelectSku(row.sku)}
                    className={`grid w-full grid-cols-[minmax(260px,1fr)_78px_76px_68px] items-center gap-2 px-3 py-2 text-left transition-colors ${
                      selected ? "bg-[#ebf0fd] text-[#1238a0] dark:bg-blue-900/40 dark:text-blue-300" : "hover:bg-[#f8f7f4] dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className="truncate font-mono text-xs font-semibold" title={row.sku}>{row.sku}</div>
                    <div className="whitespace-nowrap text-right font-mono text-xs font-semibold text-foreground">
                      {formatNumber(row.total_stock)}
                    </div>
                    <div className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                      {formatNumber(row.total_avg_curr, 2)}
                    </div>
                    <span className={`justify-self-end whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${urgencyStyles[urgency]}`}>
                      {days === null ? "-" : `${days}d`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
