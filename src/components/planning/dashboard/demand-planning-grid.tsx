"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ALL_COLS,
  CON_SUBCOLS,
  COMPACT_COLUMN_IDS,
  COLUMN_WIDTHS_STORAGE_KEY,
  GROUP_HEADER_COLORS,
  GROUP_LABELS,
  TINT_COLORS,
  TODAY,
  clampColumnWidth,
  daysTo,
  isResizableColumnId,
  skuMatchesPartFilters,
  urgStatus,
} from "./columns";
import type { CellColorSettings, CellContent, ColDef, ColumnColorSettings, ColumnVisibility, ColumnWidths, ResizableColumnId, SkuPartFilters } from "./columns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { computeContainerChain, type ChainDerived } from "@/lib/planning/chain-calc";
import type { SeasonalFactors } from "@/lib/planning/seasonal-factors";
import type {
  CategoryFilter,
  ColumnGroupKey,
  ContainerMeta,
  DemandPlanningData,
  DemandRow,
  ProductFilter,
  UrgencyFilter,
  UrgencyStatus,
} from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface DemandPlanningGridProps {
  data: DemandPlanningData;
  categoryFilter: CategoryFilter;
  productFilter: ProductFilter;
  urgencyFilter: UrgencyFilter | null;
  search: string;
  skuPartFilters: SkuPartFilters;
  onFilteredRowsChange: (rows: DemandRow[]) => void;
  loading: boolean;
  onLoadContainerDetails: () => void;
  containerDetailsLoading: boolean;
  containerDetailsLoaded: boolean;
  // Column visibility state (owned by dashboard)
  groupVis: Record<ColumnGroupKey, boolean>;
  columnVis: ColumnVisibility;
  compactMode: boolean;
  showMistake: boolean;
  showZeroSales: boolean;
  freezeUntil: string;
  columnWidths: ColumnWidths;
  columnWidthsRef: React.MutableRefObject<ColumnWidths>;
  onColumnWidthsChange: (next: ColumnWidths) => void;
  seasonalFactors: SeasonalFactors;
  columnColors?: ColumnColorSettings;
  cellColors?: CellColorSettings;
  selectedCellKeys?: string[];
  onAgCellSelected?: (selection: { rowId: string; columnId: string; label: string; cells?: { rowId: string; columnId: string; label: string }[] }) => void;
  onCellSelectionChange?: (keys: string[]) => void;
  onExportReady?: (exporter: (() => Promise<void>) | null) => void;
  gradient?: import("@/lib/planning/order-optimizer").GradientTier[];
  gradientSC?: import("@/lib/planning/order-optimizer").GradientTier[];
  hiddenContainers?: Set<string>;
  hiddenBases?: Set<string>;
}

const ROW_HEIGHT = 28;
const VIRTUAL_OVERSCAN = 40;
const TABLE_HEADER_HEIGHT = 84;

type SortValue = number | string | null | undefined;
type SortDirection = "asc" | "desc";

const SORT_VALUE_BY_COLUMN: Partial<Record<string, (row: DemandRow) => SortValue>> = {
  cont_info: (row) => row.container_info,
  cbm: (row) => row.cbm,
  back: (row) => row.back,
  status: (row) => row.sales_status,
  sku: (row) => row.sku,
  west: (row) => row.west_stock,
  east: (row) => row.east_stock,
  total: (row) => row.total_stock,
  w90: (row) => row.west_90d,
  w60: (row) => row.west_60d,
  w30: (row) => row.west_30d,
  w15: (row) => row.west_15d,
  w7: (row) => row.west_7d,
  wpre: (row) => row.west_30d_pre,
  e90: (row) => row.east_90d,
  e60: (row) => row.east_60d,
  e30: (row) => row.east_30d,
  e15: (row) => row.east_15d,
  e7: (row) => row.east_7d,
  epre: (row) => row.east_30d_pre,
  wavg_p: (row) => row.avg_daily_prev,
  wavg_r: (row) => row.avg_daily_real,
  wavg_c: (row) => row.avg_daily_curr,
  eavg_p: (row) => row.east_avg_prev,
  eavg_r: (row) => row.east_avg_real,
  eavg_c: (row) => row.east_avg_curr,
  fba_r: (row) => row.fba_avg_real,
  fba_c: (row) => row.fba_avg_curr,
  wfbm30: (row) => row.west_fbm_30d,
  efbm30: (row) => row.east_fbm_30d,
  fba30: (row) => row.fba_30d,
  tot30: (row) => row.total_30d,
  tavg_p: (row) => row.total_avg_prev,
  tavg_r: (row) => row.total_avg_real,
  tavg_c: (row) => row.total_avg_curr,
  inb_qty: (row) => row.total_inbound_qty,
  inb_lst: (row) => row.containers_list,
  next_eta: (row) => row.next_eta,
  sod: (row) => row.sod,
};

function compareAscending(left: SortValue, right: SortValue): number {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    return leftEmpty ? 1 : -1;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" | "AC" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

function renderCell(content: CellContent): React.ReactNode {
  if (content === null || content === undefined) return "";
  if (typeof content === "object" && "html" in content) {
    return <span dangerouslySetInnerHTML={{ __html: content.html }} />;
  }
  return String(content);
}

function expandableTextValue(columnId: string, row: DemandRow): string | null {
  if (columnId === "cont_info") return row.container_info || null;
  if (columnId === "sku") return row.sku || null;
  if (columnId === "inb_lst") return row.containers_list || null;
  return null;
}

function FullTextCell({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Popover onOpenChange={() => setCopied(false)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`View full ${label}`}
          title="Click to view full value"
          style={{
            display: "block",
            width: "100%",
            padding: 0,
            border: 0,
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontWeight: "inherit",
            textAlign: "inherit",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: "pointer",
          }}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          <button
            type="button"
            onClick={() => void copyValue()}
            className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="break-words font-mono text-sm leading-5">{value}</div>
      </PopoverContent>
    </Popover>
  );
}

function cellStyle(col: ColDef): React.CSSProperties {
  return {
    minWidth: col.w,
    maxWidth: col.w,
    width: col.w,
    boxSizing: "border-box",
    padding: "2px 7px",
    borderRight: "1px solid #D8D6CE",
    borderBottom: "1px solid #D8D6CE",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    height: 28,
    background: TINT_COLORS[col.tint] || "#fff",
    textAlign: col.align === "num" ? "right" : col.align === "ctr" ? "center" : "left",
    fontFamily: col.align === "num" ? "ui-monospace, SFMono-Regular, Consolas, monospace" : undefined,
    fontSize: col.fontSize ?? 11,
    fontWeight: col.bold ? 700 : 400,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

export function DemandPlanningGrid({
  data,
  categoryFilter,
  productFilter,
  urgencyFilter,
  search,
  skuPartFilters,
  onFilteredRowsChange,
  onLoadContainerDetails,
  containerDetailsLoading,
  containerDetailsLoaded,
  groupVis,
  columnVis,
  compactMode,
  showZeroSales,
  freezeUntil,
  columnWidths,
  columnWidthsRef,
  onColumnWidthsChange,
  seasonalFactors,
}: DemandPlanningGridProps) {
  const { pick } = useI18n();
  const { rows: ROWS } = data;
  const [etaOverrides, setEtaOverrides] = useState<Map<number, string>>(new Map());
  const CONS = useMemo(
    () => data.containers
      .map((c) => c.container_id !== undefined && etaOverrides.has(c.container_id)
        ? { ...c, eta: etaOverrides.get(c.container_id)! }
        : c
      )
      .filter((c) => {
        if (c.status === "baseline") return true;
        if (!c.categories || c.categories.length === 0) {
          // fallback: name-suffix heuristic for containers without category data
          if (c.name.endsWith("-FLOOR")) return categoryFilter === "fm";
          if (c.name.endsWith("-SEAT"))  return categoryFilter === "sc";
          return categoryFilter === "cc";
        }
        return c.categories.includes(categoryFilter.toUpperCase());
      }),
    [data.containers, categoryFilter, etaOverrides],
  );

  const [cbmEditingSku, setCbmEditingSku] = useState<string | null>(null);
  const [cbmEditingVal, setCbmEditingVal] = useState("");
  const cbmEditingValRef = useRef("");
  const [cbmSavingSku, setCbmSavingSku] = useState<string | null>(null);
  const [cbmOverrides, setCbmOverrides] = useState<Map<string, number>>(new Map());
  const visSubCols = CON_SUBCOLS.filter((sc) =>
    columnVis[`con:${sc.id}`] !== false
  );

  const containerCbmTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of CONS) {
      let total = 0;
      for (const r of ROWS) {
        const cd = r.containers?.[c.name];
        if (cd?.cbm) total += cd.cbm as number;
      }
      if (total > 0) totals.set(c.name, total);
    }
    return totals;
  }, [CONS, ROWS]);

  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const selectedSkuRef = useRef<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ top: 0, height: 600 });
  const resizeRef = useRef<{ columnId: ResizableColumnId; startX: number; startWidth: number; controller: AbortController } | null>(null);

  // Inline qty editing state
  type EditingKey = `${string}::${string}`;
  const [editingKey, setEditingKey] = useState<EditingKey | null>(null);
  const [editingVal, setEditingVal] = useState("");
  // Ref always holds the latest typed value â€” avoids stale-closure bugs in event handlers
  const editingValRef = useRef("");
  const [savingKey, setSavingKey] = useState<EditingKey | null>(null);
  // Local overrides: key = `${sku}::${containerName}`, value = partial ContainerRowData
  // item_id is stored here after a POST so subsequent edits use PATCH
  const [qtyOverrides, setQtyOverrides] = useState<Map<EditingKey, { inbound_qty: number | null; avail_qty: number | null; cbm: number | null; item_id?: number }>>(new Map());
  const [containerChainMap, setContainerChainMap] = useState<Map<string, Map<string, ChainDerived>>>(new Map());
  // Row-level corrections for active-container aggregates (sku â†’ partial DemandRow overrides)
  const [rowTotalOverrides, setRowTotalOverrides] = useState<Map<string, { total_inbound_qty?: number; containers_list?: string | null }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setContainerChainMap(new Map(
        ROWS.map((row) => [row.sku, computeContainerChain(row, CONS, qtyOverrides, TODAY, seasonalFactors)]),
      ));
    });
    return () => { cancelled = true; };
  }, [CONS, ROWS, qtyOverrides, seasonalFactors]);

  const visCols = useMemo<ColDef[]>(
    () => ALL_COLS
      .filter((c) => c.grp === "fix" || groupVis[c.grp])
      .filter((c) => columnVis[c.id] !== false)
      .filter((c) => !compactMode || COMPACT_COLUMN_IDS.has(c.id))
      .map((col) => {
        if (!isResizableColumnId(col.id)) return col;
        const savedWidth = columnWidths[col.id];
        return typeof savedWidth === "number" ? { ...col, w: savedWidth } : col;
      }),
    [columnVis, columnWidths, compactMode, groupVis],
  );

  const showCon = groupVis["con"];
  const showContainerLoadingColumn = showCon && containerDetailsLoading && !containerDetailsLoaded;
  const containerColumnCount = showCon
    ? (CONS.length * visSubCols.length) + (showContainerLoadingColumn ? 1 : 0)
    : 0;
  useEffect(() => {
    if (!showCon || containerDetailsLoaded || containerDetailsLoading) return;
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => onLoadContainerDetails());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [showCon, containerDetailsLoaded, containerDetailsLoading, onLoadContainerDetails]);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    return ROWS.filter((r) => {
      if (categoryCodeForRow(r) !== categoryFilter.toUpperCase()) return false;
      if (r.sales_status !== "Part" && !showZeroSales && !urgencyFilter &&
        !r.west_90d && !r.west_60d && !r.west_30d && !r.west_15d && !r.west_7d &&
        !r.east_90d && !r.east_60d && !r.east_30d && !r.east_15d && !r.east_7d) return false;
      if (productFilter === "orig" && r.sales_status !== "Original")      return false;
      if (productFilter === "cust" && r.sales_status !== "Custom")        return false;
      if (productFilter === "hold" && r.sales_status !== "Hold")          return false;
      if (productFilter === "part" && r.sales_status !== "Part")          return false;
      if (productFilter === "disc" && r.sales_status !== "Discontinued")  return false;
      if (productFilter === "tbd"  && r.sales_status !== "TBD")           return false;
      if (!skuMatchesPartFilters(r, skuPartFilters)) return false;
      if (q && !r.sku.toLowerCase().includes(q) && !(r.containers_list || "").toLowerCase().includes(q)) return false;
      const u: UrgencyStatus = urgStatus(r);
      if (urgencyFilter === "crit") return u === "crit";
      if (urgencyFilter === "warn") return u === "warn";
      if (urgencyFilter === "bo")   return (r.back || 0) < 0;
      if (urgencyFilter === "over") return u === "over";
      return true;
    });
  }, [ROWS, categoryFilter, productFilter, skuPartFilters, urgencyFilter, search, showZeroSales]);

  const displayedRows = useMemo(() => {
    const getSortValue = sortColumnId ? SORT_VALUE_BY_COLUMN[sortColumnId] : undefined;
    const sorted = getSortValue
      ? [...filteredRows].sort((left, right) => {
          const result = compareAscending(getSortValue(left), getSortValue(right));
          return sortDirection === "asc" ? result : -result;
        })
      : filteredRows;
    // "Part" 행은 항상 하단
    const normal = sorted.filter((r) => r.sales_status !== "Part");
    const parts  = sorted.filter((r) => r.sales_status === "Part");
    return [...normal, ...parts];
  }, [filteredRows, sortColumnId, sortDirection]);

  const handleSort = useCallback((columnId: string) => {
    if (sortColumnId === columnId) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortColumnId(columnId);
    setSortDirection("asc");
  }, [sortColumnId]);

  const startColumnResize = useCallback((event: React.PointerEvent, columnId: ResizableColumnId, startWidth: number) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current?.controller.abort();
    const controller = new AbortController();
    resizeRef.current = { columnId, startX: event.clientX, startWidth, controller };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const nextWidth = clampColumnWidth(resize.columnId, resize.startWidth + moveEvent.clientX - resize.startX);
      const next = { ...columnWidthsRef.current, [resize.columnId]: nextWidth };
      columnWidthsRef.current = next;
      onColumnWidthsChange(next);
    };
    const onPointerUp = () => {
      const activeResize = resizeRef.current;
      resizeRef.current = null;
      window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidthsRef.current));
      activeResize?.controller.abort();
    };
    document.addEventListener("pointermove", onPointerMove, { signal: controller.signal });
    document.addEventListener("pointerup", onPointerUp, { signal: controller.signal });
  }, [onColumnWidthsChange]);

  useEffect(() => {
    return () => resizeRef.current?.controller.abort();
  }, []);

  useEffect(() => {
    const element = scrollAreaRef.current;
    if (!element) return;

    const updateHeight = () => {
      setScrollState((current) => (
        current.height === element.clientHeight
          ? current
          : { ...current, height: element.clientHeight }
      ));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = scrollAreaRef.current;
    if (!element) return;
    element.scrollTop = 0;
    setScrollState((current) => current.top === 0 ? current : { ...current, top: 0 });
  }, [categoryFilter, productFilter, urgencyFilter, search, sortColumnId, sortDirection]);

  const virtualRows = useMemo(() => {
    if (!showCon) {
      return { start: 0, end: displayedRows.length, topHeight: 0, bottomHeight: 0, rows: displayedRows };
    }
    const firstVisibleRow = Math.floor(Math.max(0, scrollState.top - TABLE_HEADER_HEIGHT) / ROW_HEIGHT);
    const start = Math.max(0, firstVisibleRow - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(scrollState.height / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const end = Math.min(displayedRows.length, start + visibleCount);
    return {
      start,
      end,
      topHeight: start * ROW_HEIGHT,
      bottomHeight: (displayedRows.length - end) * ROW_HEIGHT,
      rows: displayedRows.slice(start, end),
    };
  }, [displayedRows, scrollState, showCon]);

  useEffect(() => {
    onFilteredRowsChange(displayedRows);
  }, [displayedRows, onFilteredRowsChange]);

  useEffect(() => {
    const selectedSku = selectedSkuRef.current;
    const table = tableRef.current;
    if (!selectedSku || !table) return;
    table.querySelector("tbody tr.row-selected")?.classList.remove("row-selected");
    table.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-sku]").forEach((row) => {
      if (row.dataset.rowSku === selectedSku) row.classList.add("row-selected");
    });
  }, [virtualRows.rows]);

  useEffect(() => {
    if (showCon && scrollAreaRef.current) {
      const top = scrollAreaRef.current.scrollTop;
      setScrollState((current) => ({ ...current, top }));
    }
  }, [showCon]);


  // Build group spans for header row 1
  const groupSpans = useMemo(() => {
    const spans: { grp: string; gh: string; count: number; start: number; end: number }[] = [];
    let prev = "";
    visCols.forEach((col, i) => {
      if (col.grp !== prev) {
        spans.push({ grp: col.grp, gh: col.gh || "gh-fix", count: 1, start: i, end: i });
        prev = col.grp;
      } else {
        const last = spans[spans.length - 1];
        last.count++;
        last.end = i;
      }
    });
    return spans;
  }, [visCols]);

  const freezeIdx = visCols.findIndex((c) => c.id === freezeUntil);

  const leftOffsets = useMemo(() => {
    const offsets: number[] = [];
    let cum = 0;
    for (let i = 0; i < visCols.length; i++) {
      offsets.push(cum);
      if (i <= freezeIdx) cum += visCols[i].w;
    }
    return offsets;
  }, [visCols, freezeIdx]);

  return (
    <>
      <style>{`
        .col-frozen { background-clip: padding-box; isolation: isolate; }
        td.col-frozen { background-color: inherit; }
        th.col-frozen { background-clip: padding-box; }
        .col-freeze-end { border-right: 3px solid #4ACCE0 !important; box-shadow: 8px 0 12px rgba(15,23,42,.26), 3px 0 8px rgba(74,200,220,.28); }
        tr.row-selected td { background: #E8F1FF !important; }
        tr.row-selected td:first-child { box-shadow: inset 3px 0 0 #2563EB; }
        .bo-pos  { color: #C42020; font-weight: 600; }
        .inb-pos { color: #1A4FC0; font-weight: 600; }
        .lv-crit { color: #C42020; font-weight: 700; }
        .lv-warn { color: #9A5200; font-weight: 600; }
        .lv-ok   { color: #0A6A45; font-weight: 500; }
        .lv-over { color: #6B3DB8; font-size: 10px; }
        .lv-dim  { color: #9A9790; }
        .sod-crit { color: #C42020; font-weight: 700; font-size: 10px; }
        .sod-warn { color: #9A5200; font-weight: 600; font-size: 10px; }
        .sod-ok   { color: #5A5750; font-size: 10px; }
        .sc { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 8px; white-space: nowrap; }
        .sc-orig { background: #E5EEFF; color: #1238A0; }
        .sc-cust { background: #E3F5EC; color: #0A6A45; }
        .sc-hold { background: #FEF3D8; color: #9A5200; }
        .sc-part { background: #EDE9FE; color: #5B21B6; }
        .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
        .d-crit { background: #FF4444; }
        .d-warn { background: #EF9F27; }
        .d-ok   { background: #0A6A45; }
      `}</style>

      {/* Table */}
      <div
        ref={scrollAreaRef}
        onScroll={(event) => {
          if (!showCon) return;
          const top = event.currentTarget.scrollTop;
          setScrollState((current) => current.top === top ? current : { ...current, top });
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "#F5F4EF",
        }}
      >
        <table
          ref={tableRef}
          style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 11, minWidth: "max-content" }}
        >
          <thead style={{ position: "sticky", top: 0, zIndex: 40 }}>
            {/* Row 1: Group headers */}
            <tr>
              {groupSpans.map((g) => {
                const gFrozen = g.start <= freezeIdx;
                const gIsEnd  = g.start <= freezeIdx && g.end >= freezeIdx;
                return (
                <th
                  key={`${g.grp}-${g.start}`}
                  colSpan={g.count}
                  data-span-start={g.start}
                  data-span-end={g.end}
                  className={gIsEnd ? "col-frozen col-freeze-end" : gFrozen ? "col-frozen" : undefined}
                  style={{
                    background: GROUP_HEADER_COLORS[g.gh] || "#1E1C19",
                    color: "rgba(255,255,255,.85)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    padding: "3px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    height: 24,
                    ...(gFrozen ? { position: "sticky" as const, left: leftOffsets[g.start] ?? 0, zIndex: 80 } : {}),
                  }}
                >
                  {GROUP_LABELS[g.grp] || g.grp}
                </th>
                );
              })}
              {showCon && containerColumnCount > 0 && (
                <th
                  colSpan={containerColumnCount}
                  data-span-start={visCols.length}
                  data-span-end={visCols.length + containerColumnCount - 1}
                  style={{
                    background: "#0D2535",
                    color: "rgba(255,255,255,.85)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    padding: "3px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    height: 20,
                  }}
                >
                  🚢 컨테이너별 재고·SOD
                </th>
              )}
            </tr>
            {/* Row 2: Container sub-header */}
            <tr>
              {groupSpans.map((g) => {
                const gFrozen = g.start <= freezeIdx;
                const gIsEnd  = g.start <= freezeIdx && g.end >= freezeIdx;
                return (
                <th
                  key={`r2-${g.grp}-${g.start}`}
                  colSpan={g.count}
                  data-span-start={g.start}
                  data-span-end={g.end}
                  className={gIsEnd ? "col-frozen col-freeze-end" : gFrozen ? "col-frozen" : undefined}
                  style={{
                    background: "#2A2825",
                    color: "rgba(255,255,255,.55)",
                    fontSize: 9,
                    fontWeight: 600,
                    padding: "2px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 20,
                    ...(gFrozen ? { position: "sticky" as const, left: leftOffsets[g.start] ?? 0, zIndex: 80 } : {}),
                  }}
                />
                );
              })}
              {showCon && CONS.flatMap((c, ci) => {
                const isLast = ci === CONS.length - 1;
                const isBaseline = c.status === "baseline";
                const isDraft = !isBaseline && !!c.status && c.status !== "shipped" && c.status !== "packing_received";
                const dt = daysTo(c.eta);
                const etaColor = isBaseline ? "#A0D080" : isDraft ? "#8A8780" :
                  dt !== null && dt <= 7  ? "#FF9090" :
                  dt !== null && dt <= 21 ? "#F0C060" : "#88D0FF";
                const totalCbm = containerCbmTotals.get(c.name) ?? 0;
                const nameSpan = isBaseline ? visSubCols.length : visSubCols.length - 1;
                const bg = isBaseline ? "#0F2218" : isDraft ? "#1E1D1A" : "#2A2825";
                const rightBorder = isLast ? "1px solid #3a3835" : "2px solid #1A4060";
                return [
                  <th
                    key={`${c.name}-hdr`}
                    colSpan={nameSpan}
                    style={{
                      background: bg,
                      color: etaColor,
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 4px",
                      borderRight: isBaseline ? rightBorder : "none",
                      borderBottom: "1px solid #555",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      height: 20,
                    }}
                  >
                    {isBaseline ? c.name : (
                      <>
                        {isDraft ? "âœ " : ""}{c.name}{" | ETA "}
                        <input
                          type="date"
                          value={c.eta ?? ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const newEta = e.target.value;
                            if (!newEta || !c.container_id) return;
                            setEtaOverrides((prev) => new Map(prev).set(c.container_id!, newEta));
                            // Recompute chain for all rows immediately with the new ETA applied
                            const newCons = CONS.map((con) =>
                              con.container_id === c.container_id ? { ...con, eta: newEta } : con
                            );
                            setContainerChainMap((prev) => {
                              const next = new Map(prev);
                              for (const r of ROWS) {
                                next.set(r.sku, computeContainerChain(r, newCons, qtyOverrides, TODAY, seasonalFactors));
                              }
                              return next;
                            });
                            void fetch(apiPath(`/api/containers?id=${c.container_id}`), {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ eta: newEta }),
                            });
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            borderBottom: "1px solid rgba(255,255,255,0.3)",
                            color: "inherit",
                            fontSize: "inherit",
                            fontWeight: "inherit",
                            fontFamily: "inherit",
                            colorScheme: "dark",
                            cursor: "pointer",
                            padding: 0,
                            outline: "none",
                            width: 80,
                          }}
                        />
                      </>
                    )}
                  </th>,
                  ...(!isBaseline ? [
                    <th
                      key={`${c.name}-cbm`}
                      colSpan={1}
                      style={{
                        background: bg,
                        color: "#7EB880",
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 4px",
                        borderRight: rightBorder,
                        borderBottom: "1px solid #555",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        height: 20,
                      }}
                    >
                      {totalCbm > 0 ? totalCbm.toFixed(1) : ""}
                    </th>,
                  ] : []),
                ];
              })}
              {showContainerLoadingColumn ? (
                <th
                  style={{
                    background: "#2A2825",
                    color: "#88D0FF",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 20,
                  }}
                >
                  Preparing details
                </th>
              ) : null}
            </tr>
            {/* Row 3: Column names */}
            <tr>
              {visCols.map((col, colIdx) => {
                const resizableColumnId = isResizableColumnId(col.id) ? col.id : null;
                const thFrozen = colIdx <= freezeIdx;
                const thIsEnd  = colIdx === freezeIdx;
                return (
                <th
                  key={col.id}
                  data-cid={col.id}
                  className={thIsEnd ? "col-frozen col-freeze-end" : thFrozen ? "col-frozen" : undefined}
                  onClick={SORT_VALUE_BY_COLUMN[col.id] ? () => handleSort(col.id) : undefined}
                  title={SORT_VALUE_BY_COLUMN[col.id] ? "Toggle ascending / descending sort" : undefined}
                  style={{
                    background: GROUP_HEADER_COLORS[col.gh] || "#34312D",
                    color: "rgba(255,255,255,.7)",
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "2px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 36,
                    lineHeight: 1.25,
                    minWidth: col.w,
                    maxWidth: col.w,
                    width: col.w,
                    boxSizing: "border-box",
                    cursor: SORT_VALUE_BY_COLUMN[col.id] ? "pointer" : "default",
                    userSelect: "none",
                    position: thFrozen ? "sticky" : "relative",
                    ...(thFrozen ? { left: leftOffsets[colIdx], zIndex: 70 } : {}),
                  }}
                >
                  {col.label.split("\n").map((line, i) => (
                    <span key={i}>
                      {i > 0 && <br />}
                      {line}
                    </span>
                  ))}
                  {sortColumnId === col.id ? (
                    <span style={{ marginLeft: 3, color: "#67E8F9" }}>
                      {sortDirection === "asc" ? "▲" : "▼"}
                    </span>
                  ) : null}
                  {resizableColumnId ? (
                    <span
                      role="separator"
                      aria-label={`Resize ${col.label.replace("\n", " ")} column`}
                      title="Drag to resize"
                      onPointerDown={(event) => startColumnResize(event, resizableColumnId, col.w)}
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        position: "absolute",
                        top: 0,
                        right: -3,
                        zIndex: 2,
                        width: 7,
                        height: "100%",
                        background: "rgba(103,232,249,.24)",
                        cursor: "col-resize",
                        touchAction: "none",
                      }}
                    />
                  ) : null}
                </th>
                );
              })}
              {showCon && CONS.map((c, ci) => {
                const isLast = ci === CONS.length - 1;
                return visSubCols.map((sc, si) => {
                  const isLastSub = si === visSubCols.length - 1;
                  return (
                    <th
                      key={`${c.name}-${sc.id}`}
                      style={{
                        background: "#34312D",
                        color: "rgba(255,255,255,.7)",
                        fontSize: 10,
                        fontWeight: 500,
                        padding: "2px 4px",
                        borderRight: isLastSub && !isLast ? "2px solid #1A4060" : "1px solid #3a3835",
                        borderBottom: "2px solid #555",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        height: 36,
                        lineHeight: 1.25,
                        minWidth: sc.w,
                        maxWidth: sc.w,
                        width: sc.w,
                        boxSizing: "border-box",
                      }}
                    >
                      {sc.label.split("\n").map((line, i) => (
                        <span key={i}>
                          {i > 0 && <br />}
                          {line}
                        </span>
                      ))}
                    </th>
                  );
                });
              })}
              {showContainerLoadingColumn ? (
                <th
                  style={{
                    background: "#34312D",
                    color: "rgba(255,255,255,.7)",
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "2px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 36,
                    lineHeight: 1.25,
                    minWidth: 180,
                    maxWidth: 180,
                    width: 180,
                    boxSizing: "border-box",
                  }}
                >
                  Loading
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visCols.length + containerColumnCount}
                  style={{ padding: 20, textAlign: "center", color: "#9A9790" }}
                >
                  {pick("조건에 맞는 SKU 없음", "No matching SKU")}
                </td>
              </tr>
            ) : (
              <>
                {virtualRows.topHeight > 0 ? (
                  <tr aria-hidden="true" style={{ height: virtualRows.topHeight }}>
                    <td
                      colSpan={visCols.length + containerColumnCount}
                      style={{ height: virtualRows.topHeight, padding: 0, border: 0 }}
                    />
                  </tr>
                ) : null}
                {virtualRows.rows.map((r, visibleIdx) => {
                const idx = virtualRows.start + visibleIdx;
                const u: UrgencyStatus = urgStatus(r);
                const rowBg = u === "crit" ? "#FFF5F5" : idx % 2 === 1 ? "#FAFAF7" : "#fff";
                const displayRow = {
                  ...(rowTotalOverrides.has(r.sku) ? { ...r, ...rowTotalOverrides.get(r.sku) } : r),
                  ...(cbmOverrides.has(r.sku) ? { cbm_per_unit: cbmOverrides.get(r.sku) } : {}),
                };
                return (
                  <tr
                    key={r.sku}
                    data-row-sku={r.sku}
                    onClick={(event) => {
                      tableRef.current?.querySelector("tbody tr.row-selected")?.classList.remove("row-selected");
                      selectedSkuRef.current = r.sku;
                      event.currentTarget.classList.add("row-selected");
                    }}
                    style={{
                      height: 28,
                      cursor: "pointer",
                      backgroundColor: rowBg,
                    }}
                  >
                    {visCols.map((col, colIdx) => {
                      const tdFrozen = colIdx <= freezeIdx;
                      const tdIsEnd  = colIdx === freezeIdx;
                      const isCbm = col.id === "cbm";
                      const isCbmEditing = isCbm && cbmEditingSku === r.sku;
                      const isCbmSaving  = isCbm && cbmSavingSku  === r.sku;
                      const fullTextValue = expandableTextValue(col.id, displayRow);
                      let cbmSaveStarted = false;
                      const commitCbmSave = async (val: string) => {
                        if (cbmSaveStarted) return;
                        cbmSaveStarted = true;
                        const newCbm = parseFloat(val);
                        setCbmEditingSku(null);
                        if (isNaN(newCbm) || newCbm === displayRow.cbm_per_unit) return;
                        setCbmSavingSku(r.sku);
                        try {
                          const res = await fetch(apiPath(`/api/planning/products/${encodeURIComponent(r.sku)}`), {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ cbm_per_unit: newCbm }),
                          });
                          const json = await res.json() as { success: boolean; error?: string };
                          if (json.success) {
                            setCbmOverrides((prev) => new Map(prev).set(r.sku, newCbm));
                          } else {
                            console.error("[cbmSave] error:", json.error);
                          }
                        } catch (err) {
                          console.error("[cbmSave] network error:", err);
                        } finally {
                          setCbmSavingSku(null);
                        }
                      };
                      return (
                        <td
                          key={col.id}
                          data-cid={col.id}
                          className={tdIsEnd ? "col-frozen col-freeze-end" : tdFrozen ? "col-frozen" : undefined}
                          onClick={isCbm && !isCbmEditing ? () => {
                            const initial = displayRow.cbm_per_unit ? String(displayRow.cbm_per_unit) : "";
                            cbmEditingValRef.current = initial;
                            setCbmEditingVal(initial);
                            setCbmEditingSku(r.sku);
                          } : undefined}
                          style={{
                            ...cellStyle(col),
                            background: isCbmEditing ? "#FFFDE7" : TINT_COLORS[col.tint] || undefined,
                            ...(tdFrozen ? { position: "sticky" as const, left: leftOffsets[colIdx], zIndex: 35 } : {}),
                            ...(isCbm && !isCbmEditing ? { cursor: "pointer", borderBottom: "1px dashed #90B8E0", color: "#1A4FC0" } : {}),
                            ...(isCbmSaving ? { color: undefined } : {}),
                            ...(isCbmEditing ? { padding: 0 } : {}),
                          }}
                        >
                          {isCbmEditing ? (
                            <input
                              autoFocus
                              type="number"
                              step="0.000001"
                              min={0}
                              value={cbmEditingVal}
                              onChange={(e) => { cbmEditingValRef.current = e.target.value; setCbmEditingVal(e.target.value); }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") { setCbmEditingSku(null); setCbmEditingVal(""); cbmEditingValRef.current = ""; }
                                if (e.key === "Enter") { e.preventDefault(); void commitCbmSave(cbmEditingValRef.current); }
                              }}
                              onBlur={() => void commitCbmSave(cbmEditingValRef.current)}
                              style={{
                                width: "100%", height: 28, padding: "2px 4px",
                                border: "none", background: "transparent",
                                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                                fontSize: 11, textAlign: "right", outline: "none", boxSizing: "border-box",
                              }}
                            />
                          ) : isCbmSaving ? (
                            <span style={{ color: "#9A9790", fontStyle: "italic" }}>â€¦</span>
                          ) : fullTextValue ? (
                            <FullTextCell label={col.label.replace("\n", " ")} value={fullTextValue}>
                              {renderCell(col.val(displayRow, idx, u))}
                            </FullTextCell>
                          ) : (
                            renderCell(col.val(displayRow, idx, u))
                          )}
                        </td>
                      );
                    })}
                    {showCon && CONS.map((c, ci) => {
                      const rawCd = (r.containers && r.containers[c.name]) || {
                        item_id: null, cbm_unit: null,
                        inbound_qty: null, open_orders: 0, avail_qty: null, est_sales: 0,
                        backorder: 0, carryover: null, eta: c.eta, inv_life: null,
                        est_sod: null, plan_sod: null, cbm: 0,
                      };
                      const eKey = `${r.sku}::${c.name}` as EditingKey;
                      const override = qtyOverrides.get(eKey);
                      const chainData = containerChainMap.get(r.sku)?.get(c.name);
                      const cd = { ...rawCd, ...(override ?? {}), ...(chainData ?? {}) };
                      const isBaseline = c.status === "baseline";
                      const isDraft = !isBaseline && !!c.status && c.status !== "shipped" && c.status !== "packing_received";
                      const isLast = ci === CONS.length - 1;
                      return visSubCols.map((sc, si) => {
                        const isLastSub = si === visSubCols.length - 1;
                        const baseBg = isBaseline ? "#E8F5E0" : isDraft ? "#F2F1EC" : (TINT_COLORS[sc.tint] || "#fff");
                        const isQtyCol = sc.id === "inb_qty";
                        const isEditing = isQtyCol && editingKey === eKey;
                        const isSaving = isQtyCol && savingKey === eKey;
                        const isEditable = isQtyCol && !isBaseline;

                        // Shared save â€” called by both Enter and blur.
                        // saveStarted prevents double-execution if blur fires
                        // after Enter already initiated the save.
                        let saveStarted = false;
                        const commitSave = async (val: string) => {
                          if (saveStarted) return;
                          saveStarted = true;
                          const newQty = parseInt(val);
                          console.log("[commitSave]", { sku: r.sku, container: c.name, container_id: c.container_id, val, newQty, inbound_qty: cd.inbound_qty, item_id: rawCd.item_id ?? override?.item_id });
                          setEditingKey(null);
                          if (isNaN(newQty) || newQty === cd.inbound_qty) {
                            console.log("[commitSave] skipped â€” no change or invalid value");
                            return;
                          }
                          // When an override exists, its item_id takes precedence â€”
                          // after a DELETE the override has item_id=undefined even though rawCd still has the old id.
                          const effectiveItemId = override !== undefined ? override.item_id : rawCd.item_id;
                          if (!effectiveItemId && newQty === 0) return;
                          setSavingKey(eKey);
                          try {
                            let json: { success: boolean; qty?: number; total_cbm?: number; cbm_unit?: number; item_id?: number };
                            const isActiveContainer = c.status === "shipped" || c.status === "packing_received";
                            const oldQty = cd.inbound_qty ?? 0;

                            if (effectiveItemId && newQty === 0) {
                              // qty â†’ 0 on an existing row: delete it and blank the cell
                              const res = await fetch(apiPath(`/api/planning/containers/items/${effectiveItemId}`), { method: "DELETE" });
                              json = await res.json() as typeof json;
                              if (json.success) {
                                const nextOverrides = new Map(qtyOverrides);
                                nextOverrides.set(eKey, { inbound_qty: null, avail_qty: null, cbm: null, item_id: undefined });
                                setQtyOverrides(nextOverrides);
                                const chainResult = computeContainerChain(r, CONS, nextOverrides, TODAY, seasonalFactors);
                                setContainerChainMap((prev) => new Map(prev).set(r.sku, chainResult));
                                if (isActiveContainer) {
                                  setRowTotalOverrides((prev) => {
                                    const next = new Map(prev);
                                    const cur = prev.get(r.sku) ?? {};
                                    const curTotal = cur.total_inbound_qty ?? (r.total_inbound_qty ?? 0);
                                    const curList  = cur.containers_list  ?? (r.containers_list ?? "");
                                    const newList  = curList.split(", ").filter((e) => !e.startsWith(`${c.name} (`)).join(", ") || null;
                                    next.set(r.sku, { total_inbound_qty: Math.max(0, curTotal - oldQty), containers_list: newList });
                                    return next;
                                  });
                                }
                              } else {
                                console.error("[commitSave] DELETE error:", json);
                              }
                              return;
                            } else if (effectiveItemId) {
                              const res = await fetch(apiPath(`/api/planning/containers/items/${effectiveItemId}`), {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ qty: newQty }),
                              });
                              json = await res.json() as typeof json;
                            } else {
                              const res = await fetch(apiPath("/api/planning/containers/items"), {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  container_id: c.container_id,
                                  master_sku: r.sku,
                                  qty: newQty,
                                  cbm_unit: rawCd.cbm_unit ?? (r.cbm > 0 ? r.cbm : null) ?? r.cbm_per_unit ?? 0,
                                }),
                              });
                              json = await res.json() as typeof json;
                            }
                            console.log("[commitSave] response:", json);
                            if (json.success) {
                              const nextOverrides = new Map(qtyOverrides);
                              nextOverrides.set(eKey, {
                                inbound_qty: json.qty ?? newQty,
                                avail_qty: json.qty ?? newQty,
                                cbm: json.total_cbm ?? 0,
                                item_id: json.item_id ?? effectiveItemId ?? undefined,
                              });
                              setQtyOverrides(nextOverrides);
                              const chainResult = computeContainerChain(r, CONS, nextOverrides, TODAY, seasonalFactors);
                              setContainerChainMap((prev) => new Map(prev).set(r.sku, chainResult));
                              if (isActiveContainer) {
                                setRowTotalOverrides((prev) => {
                                  const next = new Map(prev);
                                  const cur = prev.get(r.sku) ?? {};
                                  const curTotal = cur.total_inbound_qty ?? (r.total_inbound_qty ?? 0);
                                  const curList  = cur.containers_list  ?? (r.containers_list ?? "");
                                  const entry = `${c.name} (${newQty})`;
                                  let newList: string;
                                  if (oldQty === 0 || !curList.includes(`${c.name} (`)) {
                                    // POST â€” container not yet in list, append
                                    newList = curList ? `${curList}, ${entry}` : entry;
                                  } else {
                                    // PATCH â€” update existing entry's qty
                                    newList = curList.split(", ").map((e) => e.startsWith(`${c.name} (`) ? entry : e).join(", ");
                                  }
                                  next.set(r.sku, { total_inbound_qty: Math.max(0, curTotal - oldQty + newQty), containers_list: newList });
                                  return next;
                                });
                              }
                            } else {
                              console.error("[commitSave] API error:", json);
                            }
                          } catch (err) {
                            console.error("[commitSave] network error:", err);
                          } finally {
                            setSavingKey(null);
                          }
                        };

                        return (
                          <td
                            key={`${c.name}-${sc.id}`}
                            onClick={isEditable && !isEditing ? () => {
                              const initial = String(cd.inbound_qty ?? "");
                              editingValRef.current = initial;
                              setEditingVal(initial);
                              setEditingKey(eKey);
                            } : undefined}
                            title={isEditable ? "Click to edit quantity" : undefined}
                            style={{
                              minWidth: sc.w,
                              maxWidth: sc.w,
                              width: sc.w,
                              boxSizing: "border-box",
                              padding: isEditing ? "0" : "2px 7px",
                              borderRight: isLastSub && !isLast ? "2px solid #B0D8EE" : "1px solid #D8D6CE",
                              borderBottom: isEditable && !isEditing ? "1px dashed #90B8E0" : "1px solid #D8D6CE",
                              verticalAlign: "middle",
                              whiteSpace: "nowrap",
                              height: 28,
                              background: isEditing ? "#FFFDE7" : baseBg,
                              color: isDraft ? "#9A9790" : isEditable ? "#1A4FC0" : undefined,
                              textAlign: sc.align === "num" ? "right" : sc.align === "ctr" ? "center" : "left",
                              fontFamily: sc.align === "num" ? "ui-monospace, SFMono-Regular, Consolas, monospace" : undefined,
                              fontSize: 11,
                              fontWeight: isEditable ? 600 : undefined,
                              cursor: isEditable ? "pointer" : undefined,
                            }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                value={editingVal}
                                onChange={(e) => { editingValRef.current = e.target.value; setEditingVal(e.target.value); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") { setEditingKey(null); setEditingVal(""); editingValRef.current = ""; }
                                  if (e.key === "Enter") { e.preventDefault(); void commitSave(editingValRef.current); }
                                }}
                                onBlur={() => void commitSave(editingValRef.current)}
                                style={{
                                  width: "100%",
                                  height: 28,
                                  padding: "2px 7px",
                                  border: "none",
                                  background: "transparent",
                                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                                  fontSize: 11,
                                  textAlign: "right",
                                  outline: "none",
                                  boxSizing: "border-box",
                                }}
                              />
                            ) : isSaving ? (
                              <span style={{ color: "#9A9790", fontStyle: "italic" }}>â€¦</span>
                            ) : (
                              renderCell(sc.val(cd, c, displayRow))
                            )}
                          </td>
                        );
                      });
                    })}
                    {showContainerLoadingColumn ? (
                      <td
                        style={{
                          minWidth: 180,
                          maxWidth: 180,
                          width: 180,
                          boxSizing: "border-box",
                          padding: "2px 8px",
                          borderRight: "1px solid #D8D6CE",
                          borderBottom: "1px solid #D8D6CE",
                          verticalAlign: "middle",
                          whiteSpace: "nowrap",
                          height: 28,
                          background: "#F2F1EC",
                          color: "#7A766F",
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        Loading...
                      </td>
                    ) : null}
                  </tr>
                );
                })}
                {virtualRows.bottomHeight > 0 ? (
                  <tr aria-hidden="true" style={{ height: virtualRows.bottomHeight }}>
                    <td
                      colSpan={visCols.length + containerColumnCount}
                      style={{ height: virtualRows.bottomHeight, padding: 0, border: 0 }}
                    />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
