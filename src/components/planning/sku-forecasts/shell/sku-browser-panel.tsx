import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, getUrgency, productLabels, recommendedContainerQty, stockOnlyDays, type ProductKey } from "../types";
import { pick, productLabel, type SkuForecastLanguage } from "../language";

type SortKey = "sku" | "stock" | "avg" | "sod" | "order";
type SortDirection = "asc" | "desc";

interface SkuBrowserPanelProps {
  product: ProductKey;
  productCounts: Record<ProductKey, number | null>;
  onProductChange: (product: ProductKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  rows: DemandRow[];
  selectedSkuId: string;
  onSelectSku: (skuId: string) => void;
  language: SkuForecastLanguage;
  targetInventoryDays: number;
  initialSkuFilter?: SkuFilterKey;
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
  order: "Rec. Qty",
};

export type SkuFilterKey = "all" | "critical" | "watch" | "high" | "low" | "order";

const SKU_FILTERS: Array<{
  id: SkuFilterKey;
  label: string;
  icon?: string;
  activeClass: string;
  hoverClass: string;
}> = [
  {
    id: "all",
    label: "All",
    activeClass: "border-[#1a4db0] bg-[#ebf0fd] text-[#1a4db0] dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300",
    hoverClass: "hover:bg-[#f0eee9] dark:hover:bg-zinc-700/60",
  },
  {
    id: "critical",
    label: "Critical",
    icon: "●",
    activeClass: "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/60 dark:text-red-300",
    hoverClass: "hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400",
  },
  {
    id: "watch",
    label: "Watch",
    icon: "▲",
    activeClass: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
    hoverClass: "hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30 dark:hover:text-amber-400",
  },
  {
    id: "high",
    label: "High",
    activeClass: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300",
    hoverClass: "hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400",
  },
  {
    id: "low",
    label: "Low",
    activeClass: "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-200",
    hoverClass: "hover:bg-[#f0eee9] dark:hover:bg-zinc-700/60",
  },
  {
    id: "order",
    label: "Order Required",
    activeClass: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-950/60 dark:text-violet-300",
    hoverClass: "hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-950/30 dark:hover:text-violet-400",
  },
];

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

const ROW_HEIGHT = 36;
const OVERSCAN = 10;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export function SkuBrowserPanel({
  product,
  productCounts,
  onProductChange,
  search,
  onSearchChange,
  rows,
  selectedSkuId,
  onSelectSku,
  language,
  targetInventoryDays,
  initialSkuFilter,
}: SkuBrowserPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [skuFilter, setSkuFilter] = useState<SkuFilterKey>(initialSkuFilter ?? "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);

  // Count per filter category (always from unfiltered rows)
  const filterCounts = useMemo(() => ({
    all: rows.length,
    critical: rows.filter((r) => getUrgency(r) === "critical").length,
    watch: rows.filter((r) => getUrgency(r) === "watch").length,
    high: rows.filter((r) => getUrgency(r) === "healthy").length,
    low: rows.filter((r) => (r.back ?? 0) < 0).length,
    order: rows.filter((r) => recommendedContainerQty(r, undefined, targetInventoryDays) > 0).length,
  }), [rows, targetInventoryDays]);

  // Apply filter then sort
  const filteredRows = useMemo(() => {
    switch (skuFilter) {
      case "critical": return rows.filter((r) => getUrgency(r) === "critical");
      case "watch":    return rows.filter((r) => getUrgency(r) === "watch");
      case "high":     return rows.filter((r) => getUrgency(r) === "healthy");
      case "low":      return rows.filter((r) => (r.back ?? 0) < 0);
      case "order":    return rows.filter((r) => recommendedContainerQty(r, undefined, targetInventoryDays) > 0);
      default:         return rows;
    }
  }, [rows, skuFilter, targetInventoryDays]);

  const sortedRows = useMemo(
    () => [...filteredRows].sort((left, right) => {
      let result = 0;
      if (sortKey === "sku") {
        result = left.sku.localeCompare(right.sku, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortKey === "stock") {
        result = left.total_stock - right.total_stock;
      } else if (sortKey === "avg") {
        result = left.total_avg_curr - right.total_avg_curr;
      } else if (sortKey === "sod") {
        const leftDays = stockOnlyDays(left);
        const rightDays = stockOnlyDays(right);
        result = (leftDays ?? Number.POSITIVE_INFINITY) - (rightDays ?? Number.POSITIVE_INFINITY);
      } else {
        result = recommendedContainerQty(left, undefined, targetInventoryDays) - recommendedContainerQty(right, undefined, targetInventoryDays);
      }
      return sortDirection === "asc" ? result : -result;
    }),
    [filteredRows, sortDirection, sortKey, targetInventoryDays],
  );

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Everything upstream of pagination (product, search, filter chip, sort, page size)
  // resets back to page 1 — an old page number rarely makes sense for a new list.
  useEffect(() => {
    setPage(1);
  }, [rows, skuFilter, sortKey, sortDirection, pageSize]);

  // Track scroll container height
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setListHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll when the visible page changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [pagedRows]);

  // Virtual window calculation (over the current page only)
  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(pagedRows.length, start + Math.ceil(listHeight / ROW_HEIGHT) + OVERSCAN * 2);
  const topPad = start * ROW_HEIGHT;
  const bottomPad = (pagedRows.length - end) * ROW_HEIGHT;
  const virtualRows = pagedRows.slice(start, end);

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
            {productLabel(language, key)}
            <span className="ml-1 font-mono text-[10px]">
              {productCounts[key] === null ? "-" : formatNumber(productCounts[key] ?? 0)}
            </span>
          </button>
        ))}
      </div>
      <div className="p-3 pb-2">
        <div className="relative">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={pick(language, "Master SKU 검색...", "Search master SKU...")}
            className="h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 pr-8"
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
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SKU_FILTERS.map((f) => {
            const active = skuFilter === f.id;
            const count = filterCounts[f.id];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSkuFilter(f.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  active
                    ? f.activeClass
                    : `border-[#cccac4] text-muted-foreground dark:border-zinc-600 ${f.hoverClass}`
                }`}
              >
                {f.icon && (
                  <span className={`text-[9px] leading-none ${f.id === "critical" ? "text-red-500" : f.id === "watch" ? "text-amber-500" : ""}`}>
                    {f.icon}
                  </span>
                )}
                {language === "ko"
                  ? { all: "전체", critical: "긴급", watch: "주의", high: "정상", low: "백오더", order: "발주 필요" }[f.id]
                  : f.label}
                <span className={`ml-0.5 font-mono text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="border-b" />
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {formatNumber(totalRows)} {pick(language, "개 SKU", "SKUs")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span>{pick(language, "행", "Rows")}</span>
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="h-8 rounded-md border bg-white px-2 text-xs font-semibold text-foreground outline-none dark:border-zinc-600 dark:bg-zinc-800"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[120px] justify-center text-sm font-bold text-foreground">
          {pick(language, "페이지", "Page")} {totalRows === 0 ? 0 : currentPage} / {totalRows === 0 ? 0 : totalPages}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={currentPage <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-white text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={pick(language, "첫 페이지", "First page")}
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-white text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={pick(language, "이전 페이지", "Previous page")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={currentPage >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-white text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={pick(language, "다음 페이지", "Next page")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={currentPage >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-white text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={pick(language, "마지막 페이지", "Last page")}
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {sortedRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{pick(language, "SKU 없음", "No SKUs")}</div>
        ) : (
          <div className="rounded-b-md border-x border-b bg-white dark:border-zinc-700 dark:bg-zinc-900">
            {/* Sticky header */}
            <div className="sticky top-0 z-20 border-t bg-background pt-3 dark:border-zinc-700">
              <div className="grid grid-cols-[minmax(210px,1fr)_68px_62px_62px_72px] gap-2 rounded-t-md border-b bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                {(["sku", "stock", "avg", "sod", "order"] as SortKey[]).map((key) => (
                  <SortHeader
                    key={key}
                    label={language === "ko"
                      ? { sku: "Master SKU", stock: "재고", avg: "평균", sod: "SOD", order: "추천" }[key]
                      : sortLabels[key]}
                    sortId={key}
                    activeKey={sortKey}
                    direction={sortDirection}
                    align={key === "sku" ? "left" : "right"}
                    onSort={toggleSort}
                  />
                ))}
              </div>
            </div>
            {/* Virtual rows */}
            {topPad > 0 && <div style={{ height: topPad }} />}
            {virtualRows.map((row) => {
              const selected = selectedSkuId === row.sku;
              const urgency = getUrgency(row);
              const days = stockOnlyDays(row);
              const recommendedQty = recommendedContainerQty(row, undefined, targetInventoryDays);
              return (
                <button
                  key={row.sku}
                  type="button"
                  onClick={() => onSelectSku(row.sku)}
                  style={{ height: ROW_HEIGHT }}
                  className={`grid w-full grid-cols-[minmax(210px,1fr)_68px_62px_62px_72px] items-center gap-2 border-b px-3 text-left transition-colors dark:border-zinc-700/50 ${
                    selected ? "bg-[#ebf0fd] text-[#1238a0] dark:bg-blue-900/40 dark:text-blue-300" : "bg-white text-foreground hover:bg-[#f8f7f4] dark:bg-zinc-900 dark:hover:bg-zinc-800"
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
                    {days === null ? "-" : `${formatNumber(days, 1)}d`}
                  </span>
                  <div className={`whitespace-nowrap text-right font-mono text-xs font-semibold ${recommendedQty > 0 ? "text-violet-700 dark:text-violet-300" : "text-muted-foreground"}`}>
                    {recommendedQty > 0 ? `+${formatNumber(recommendedQty)}` : "-"}
                  </div>
                </button>
              );
            })}
            {bottomPad > 0 && <div style={{ height: bottomPad }} />}
          </div>
        )}
      </div>
    </aside>
  );
}
