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
  GROUP_HEADER_COLORS,
  GROUP_LABELS,
  GROUP_BTN_COLORS,
  TINT_COLORS,
  daysTo,
  urgStatus,
} from "./columns";
import type { CellContent, ColDef } from "./columns";
import type {
  CategoryFilter,
  ColumnGroupKey,
  DemandPlanningData,
  DemandRow,
  ProductFilter,
  UrgencyFilter,
  UrgencyStatus,
} from "@/types/demand-planning";

interface DemandPlanningGridProps {
  data: DemandPlanningData;
  categoryFilter: CategoryFilter;
  productFilter: ProductFilter;
  urgencyFilter: UrgencyFilter | null;
  search: string;
  onSearchChange: (v: string) => void;
  onProductFilterChange: (f: ProductFilter) => void;
  onUrgencyFilterChange: (f: UrgencyFilter | null) => void;
  onFilteredRowsChange: (rows: DemandRow[]) => void;
}

const DEFAULT_FREEZE = "sod";
const ROW_HEIGHT = 28;
const VIRTUAL_OVERSCAN = 12;
const TABLE_HEADER_HEIGHT = 80;

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

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  return "SC";
}

const ALL_GROUP_KEYS: ColumnGroupKey[] = [
  "stock","wsales","esales","wavg","eavg","fba","s30","tavg","inb","con",
];

const GROUP_BTN_LABELS: Record<string, string> = {
  wsales: "📈 West Sales",
  stock:  "Inventory",
  esales: "📈 East Sales",
  wavg:   "〜 W Avg",
  eavg:   "〜 E Avg",
  fba:    "FBA Avg",
  s30:    "🗓 30D Sales",
  tavg:   "〜 Total Avg",
  inb:    "🚢 Inbound/SOD",
  con:    "📋 Container 컬럼",
};

function renderCell(content: CellContent): React.ReactNode {
  if (content === null || content === undefined) return "";
  if (typeof content === "object" && "html" in content) {
    return <span dangerouslySetInnerHTML={{ __html: content.html }} />;
  }
  return String(content);
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
    fontSize: 11,
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
  onFilteredRowsChange,
}: DemandPlanningGridProps) {
  const { containers: CONS, rows: ROWS } = data;

  const [groupVis, setGroupVis] = useState<Record<ColumnGroupKey, boolean>>({
    fix: true, stock: true, wsales: true, esales: true, wavg: true, eavg: true,
    fba: true, s30: true, tavg: true, inb: true, con: true,
  });
  const [freezeUntil, setFreezeUntil] = useState(DEFAULT_FREEZE);
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ top: 0, height: 600 });

  // Inline qty editing state
  type EditingKey = `${string}::${string}`;
  const [editingKey, setEditingKey] = useState<EditingKey | null>(null);
  const [editingVal, setEditingVal] = useState("");
  // Ref always holds the latest typed value — avoids stale-closure bugs in event handlers
  const editingValRef = useRef("");
  const [savingKey, setSavingKey] = useState<EditingKey | null>(null);
  // Local overrides: key = `${sku}::${containerName}`, value = partial ContainerRowData
  // item_id is stored here after a POST so subsequent edits use PATCH
  const [qtyOverrides, setQtyOverrides] = useState<Map<EditingKey, { inbound_qty: number | null; avail_qty: number | null; cbm: number | null; item_id?: number }>>(new Map());
  // Row-level corrections for active-container aggregates (sku → partial DemandRow overrides)
  const [rowTotalOverrides, setRowTotalOverrides] = useState<Map<string, { total_inbound_qty?: number; containers_list?: string | null }>>(new Map());

  const visCols = useMemo(
    () => ALL_COLS.filter((c) => c.grp === "fix" || groupVis[c.grp]),
    [groupVis],
  );

  const showCon = groupVis["con"];

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    return ROWS.filter((r) => {
      if (categoryCodeForRow(r) !== categoryFilter.toUpperCase()) return false;
      if (!r.west_90d && !r.west_60d && !r.west_30d && !r.west_15d && !r.west_7d &&
          !r.east_90d && !r.east_60d && !r.east_30d && !r.east_15d && !r.east_7d) return false;
      if (productFilter === "orig" && r.sales_status !== "Original") return false;
      if (productFilter === "cust" && r.sales_status !== "Custom")   return false;
      if (q && !r.sku.toLowerCase().includes(q) && !(r.containers_list || "").toLowerCase().includes(q)) return false;
      const u: UrgencyStatus = urgStatus(r);
      if (urgencyFilter === "crit") return u === "crit";
      if (urgencyFilter === "warn") return u === "warn" || u === "crit";
      if (urgencyFilter === "bo")   return (r.back || 0) < 0;
      return true;
    });
  }, [ROWS, categoryFilter, productFilter, urgencyFilter, search]);

  const displayedRows = useMemo(() => {
    const getSortValue = sortColumnId ? SORT_VALUE_BY_COLUMN[sortColumnId] : undefined;
    if (!getSortValue) return filteredRows;
    return [...filteredRows].sort((left, right) => {
      const result = compareAscending(getSortValue(left), getSortValue(right));
      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredRows, sortColumnId, sortDirection]);

  const handleSort = useCallback((columnId: string) => {
    if (sortColumnId === columnId) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortColumnId(columnId);
    setSortDirection("asc");
  }, [sortColumnId]);

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
  }, [displayedRows, scrollState]);

  useEffect(() => {
    onFilteredRowsChange(displayedRows);
  }, [displayedRows, onFilteredRowsChange]);

  // Apply sticky freeze after every render
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const freezeIdx = visCols.findIndex((c) => c.id === freezeUntil);
    const headerWidthByCid = new Map<string, number>();
    table.querySelectorAll<HTMLElement>("thead tr:last-child [data-cid]").forEach((cell) => {
      const cid = cell.getAttribute("data-cid");
      if (cid) headerWidthByCid.set(cid, cell.offsetWidth);
    });

    const leftOffsets: number[] = [];
    let cum = 0;
    visCols.forEach((col, i) => {
      leftOffsets.push(cum);
      if (i <= freezeIdx) cum += headerWidthByCid.get(col.id) || col.w;
    });

    // Apply to all th/td with data-cid
    const allCells = table.querySelectorAll<HTMLElement>("[data-cid]");
    allCells.forEach((cell) => {
      const cid = cell.getAttribute("data-cid")!;
      const idx = visCols.findIndex((c) => c.id === cid);
      if (idx < 0) return;
      const frozen = idx <= freezeIdx;
      const isEnd  = idx === freezeIdx;
      if (frozen) {
        cell.style.position = "sticky";
        cell.style.left = `${leftOffsets[idx]}px`;
        cell.style.zIndex = cell.tagName === "TH" ? "70" : "35";
      } else {
        cell.style.position = "";
        cell.style.left = "";
        cell.style.zIndex = "";
      }
      cell.classList.toggle("col-frozen", frozen);
      cell.classList.toggle("col-freeze-end", isEnd);
    });

    // Group header rows: data-span-start / data-span-end
    const groupCells = table.querySelectorAll<HTMLElement>("[data-span-start]");
    groupCells.forEach((th) => {
      const spanStart = parseInt(th.getAttribute("data-span-start") || "0");
      const spanEnd   = parseInt(th.getAttribute("data-span-end")   || "0");
      const anyFrozen = spanStart <= freezeIdx;
      const isEnd     = spanStart <= freezeIdx && spanEnd >= freezeIdx;
      if (anyFrozen) {
        th.style.position = "sticky";
        th.style.left = `${leftOffsets[Math.min(spanStart, leftOffsets.length - 1)]}px`;
        th.style.zIndex = "80";
      } else {
        th.style.position = "";
        th.style.left = "";
        th.style.zIndex = "";
      }
      th.classList.toggle("col-frozen", anyFrozen);
      th.classList.toggle("col-freeze-end", isEnd);
    });
  });

  const handleToggleGroup = useCallback(
    (key: ColumnGroupKey) => {
      setGroupVis((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        // If freeze col is now hidden, reset to last visible
        const nextVisCols = ALL_COLS.filter(
          (c) => c.grp === "fix" || next[c.grp],
        );
        const stillVis = nextVisCols.find((c) => c.id === freezeUntil);
        if (!stillVis && nextVisCols.length > 0) {
          setFreezeUntil(nextVisCols[nextVisCols.length - 1].id);
        }
        return next;
      });
    },
    [freezeUntil],
  );

  const handleAllOn = useCallback(() => {
    setGroupVis((prev) =>
      Object.fromEntries(Object.keys(prev).map((k) => [k, true])) as Record<ColumnGroupKey, boolean>,
    );
  }, []);

  const handleCoreOnly = useCallback(() => {
    const keep = new Set<string>(["fix", "stock", "s30", "tavg", "inb", "con"]);
    setGroupVis((prev) =>
      Object.fromEntries(Object.keys(prev).map((k) => [k, keep.has(k)])) as Record<ColumnGroupKey, boolean>,
    );
  }, []);

  const handleSetFreeze = useCallback(
    (colId: string) => {
      const idx    = visCols.findIndex((c) => c.id === colId);
      const curIdx = visCols.findIndex((c) => c.id === freezeUntil);
      if (idx === curIdx && idx > 0) {
        setFreezeUntil(visCols[idx - 1].id);
      } else {
        setFreezeUntil(colId);
      }
    },
    [visCols, freezeUntil],
  );

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

  return (
    <>
      <style>{`
        .col-frozen { background-clip: padding-box; isolation: isolate; }
        td.col-frozen { background-color: inherit; }
        th.col-frozen { background-clip: padding-box; }
        .col-freeze-end { border-right: 3px solid #4ACCE0 !important; box-shadow: 8px 0 12px rgba(15,23,42,.26), 3px 0 8px rgba(74,200,220,.28); }
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
        .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
        .d-crit { background: #FF4444; }
        .d-warn { background: #EF9F27; }
        .d-ok   { background: #0A6A45; }
      `}</style>

      {/* Column controls only apply after planning data is loaded. */}
      {ROWS.length > 0 ? (
        <>
          {/* Column Group Toggle Bar */}
          <div
            style={{
              background: "#172033",
              borderBottom: "2px solid #334155",
              height: 38,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 10px",
              overflowX: "auto",
            }}
          >
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226,232,240,.78)", whiteSpace: "nowrap", flexShrink: 0 }}>
          컬럼 그룹
        </span>
        <div style={{ width: 1, height: 18, background: "rgba(148,163,184,.32)", margin: "0 2px", flexShrink: 0 }} />
        {ALL_GROUP_KEYS.filter((k) => k !== "con").map((key) => {
          const active = groupVis[key];
          return (
            <button
              key={key}
              onClick={() => handleToggleGroup(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 10,
                border: active ? "1px solid rgba(226,232,240,.55)" : "1px solid rgba(148,163,184,.36)",
                cursor: "pointer",
                color: active ? "#F8FAFC" : "rgba(203,213,225,.82)",
                background: active ? GROUP_BTN_COLORS[key] || "rgba(255,255,255,.08)" : "rgba(15,23,42,.5)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {GROUP_BTN_LABELS[key]}
            </button>
          );
        })}
        <div style={{ width: 1, height: 18, background: "rgba(148,163,184,.32)", margin: "0 2px", flexShrink: 0 }} />
        <button
          onClick={() => handleToggleGroup("con")}
          style={{
            fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 10,
            border: groupVis["con"] ? "1px solid rgba(226,232,240,.55)" : "1px solid rgba(148,163,184,.36)", cursor: "pointer",
            color: groupVis["con"] ? "#F8FAFC" : "rgba(203,213,225,.82)",
            background: groupVis["con"] ? GROUP_BTN_COLORS["con"] : "rgba(15,23,42,.5)",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {GROUP_BTN_LABELS["con"]}
        </button>
        <div style={{ width: 1, height: 18, background: "rgba(148,163,184,.32)", margin: "0 2px", flexShrink: 0 }} />
        <button
          onClick={handleAllOn}
          style={{ fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 10, border: "1px solid rgba(148,163,184,.45)", cursor: "pointer", color: "rgba(226,232,240,.86)", background: "rgba(15,23,42,.5)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          모두 표시
        </button>
        <button
          onClick={handleCoreOnly}
          style={{ fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 10, border: "1px solid rgba(148,163,184,.45)", cursor: "pointer", color: "rgba(226,232,240,.86)", background: "rgba(15,23,42,.5)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          핵심만
        </button>
          </div>

          {/* Freeze Selector Bar */}
          <div
            style={{
              background: "#0F172A",
              borderBottom: "2px solid #4A8AAA",
              minHeight: 28,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              overflowX: "auto",
              padding: "0 10px",
            }}
          >
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(226,232,240,.78)", whiteSpace: "nowrap", paddingRight: 8, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", flexShrink: 0 }}>
          📌 고정 컬럼 선택 →
        </span>
        {visCols.map((col, i) => {
          const frozen = i <= freezeIdx;
          const isEnd  = i === freezeIdx;
          const label  = col.label.replace(/\n/g, " ").slice(0, 12);
          return (
            <button
              key={col.id}
              onClick={() => handleSetFreeze(col.id)}
              style={{
                fontSize: 11,
                fontWeight: isEnd ? 800 : frozen ? 700 : 600,
                padding: "3px 8px",
                borderTop: "none",
                borderBottom: "none",
                borderLeft: "none",
                borderRight: isEnd ? "3px solid #4ACCE0" : "1px solid #2A2825",
                background: isEnd ? "rgba(74,204,220,.2)" : frozen ? "rgba(74,170,204,.1)" : "transparent",
                cursor: "pointer",
                color: isEnd ? "#F8FAFC" : frozen ? "#67E8F9" : "rgba(203,213,225,.72)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                position: "relative",
              }}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={() => setFreezeUntil(DEFAULT_FREEZE)}
          style={{ fontSize: 10, padding: "4px 9px", marginLeft: 6, borderRadius: 4, border: "1px solid rgba(74,170,204,.4)", background: "rgba(74,170,204,.08)", color: "#4ACCE0", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          기본값 복원
        </button>
          </div>
        </>
      ) : null}

      {/* Table */}
      <div
        ref={scrollAreaRef}
        onScroll={(event) => {
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
              {groupSpans.map((g) => (
                <th
                  key={`${g.grp}-${g.start}`}
                  colSpan={g.count}
                  data-span-start={g.start}
                  data-span-end={g.end}
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
                  }}
                >
                  {GROUP_LABELS[g.grp] || g.grp}
                </th>
              ))}
              {showCon && CONS.length > 0 && (
                <th
                  colSpan={CONS.length * CON_SUBCOLS.length}
                  data-span-start={visCols.length}
                  data-span-end={visCols.length + CONS.length * CON_SUBCOLS.length - 1}
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
              {groupSpans.map((g) => (
                <th
                  key={`r2-${g.grp}-${g.start}`}
                  colSpan={g.count}
                  data-span-start={g.start}
                  data-span-end={g.end}
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
                  }}
                />
              ))}
              {showCon && CONS.map((c, ci) => {
                const isLast = ci === CONS.length - 1;
                const isDraft = !!c.status && c.status !== "shipped" && c.status !== "packing_received";
                const dt = daysTo(c.eta);
                const etaColor = isDraft ? "#8A8780" :
                  dt !== null && dt <= 7  ? "#FF9090" :
                  dt !== null && dt <= 21 ? "#F0C060" : "#88D0FF";
                return (
                  <th
                    key={c.name}
                    colSpan={CON_SUBCOLS.length}
                    style={{
                      background: isDraft ? "#1E1D1A" : "#2A2825",
                      color: etaColor,
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 4px",
                      borderRight: isLast ? "1px solid #3a3835" : "2px solid #1A4060",
                      borderBottom: "1px solid #555",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      height: 20,
                    }}
                  >
                    {isDraft ? "✏ " : ""}{c.name}&nbsp;/&nbsp;Cap {c.cbm_cap.toFixed(1)}
                  </th>
                );
              })}
            </tr>
            {/* Row 3: Column names */}
            <tr>
              {visCols.map((col) => (
                <th
                  key={col.id}
                  data-cid={col.id}
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
                </th>
              ))}
              {showCon && CONS.map((c, ci) => {
                const isLast = ci === CONS.length - 1;
                return CON_SUBCOLS.map((sc, si) => {
                  const isLastSub = si === CON_SUBCOLS.length - 1;
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
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visCols.length + (showCon ? CONS.length * CON_SUBCOLS.length : 0)}
                  style={{ padding: 20, textAlign: "center", color: "#9A9790" }}
                >
                  조건에 맞는 SKU 없음
                </td>
              </tr>
            ) : (
              <>
                {virtualRows.topHeight > 0 ? (
                  <tr aria-hidden="true" style={{ height: virtualRows.topHeight }}>
                    <td
                      colSpan={visCols.length + (showCon ? CONS.length * CON_SUBCOLS.length : 0)}
                      style={{ height: virtualRows.topHeight, padding: 0, border: 0 }}
                    />
                  </tr>
                ) : null}
                {virtualRows.rows.map((r, visibleIdx) => {
                const idx = virtualRows.start + visibleIdx;
                const u: UrgencyStatus = urgStatus(r);
                const rowBg = u === "crit" ? "#FFF5F5" : idx % 2 === 1 ? "#FAFAF7" : "#fff";
                const displayRow = rowTotalOverrides.has(r.sku)
                  ? { ...r, ...rowTotalOverrides.get(r.sku) }
                  : r;
                return (
                  <tr
                    key={r.sku}
                    style={{ height: 28, cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      Array.from(e.currentTarget.cells).forEach(
                        (td) => {
                          const cell = td as HTMLElement;
                          cell.dataset.originalBackground = cell.style.backgroundColor || cell.style.background || "";
                          cell.style.background = "#EAF0FF";
                        },
                      );
                    }}
                    onMouseLeave={(e) => {
                      Array.from(e.currentTarget.cells).forEach(
                        (td) => {
                          const cell = td as HTMLElement;
                          cell.style.background = cell.dataset.originalBackground || "";
                          delete cell.dataset.originalBackground;
                        },
                      );
                    }}
                  >
                    {visCols.map((col) => (
                      <td
                        key={col.id}
                        data-cid={col.id}
                        style={{
                          ...cellStyle(col),
                          background: TINT_COLORS[col.tint] || rowBg,
                        }}
                      >
                        {renderCell(col.val(displayRow, idx, u))}
                      </td>
                    ))}
                    {showCon && CONS.map((c, ci) => {
                      const rawCd = (r.containers && r.containers[c.name]) || {
                        item_id: null, cbm_unit: null,
                        inbound_qty: null, open_orders: 0, avail_qty: null, est_sales: 0,
                        backorder: 0, eta: c.eta, inv_life: null,
                        est_sod: null, plan_sod: null, cbm: 0,
                      };
                      const eKey = `${r.sku}::${c.name}` as EditingKey;
                      const override = qtyOverrides.get(eKey);
                      const cd = override ? { ...rawCd, ...override } : rawCd;
                      const isDraft = !!c.status && c.status !== "shipped" && c.status !== "packing_received";
                      const isLast = ci === CONS.length - 1;
                      return CON_SUBCOLS.map((sc, si) => {
                        const isLastSub = si === CON_SUBCOLS.length - 1;
                        const baseBg = isDraft ? "#F2F1EC" : (TINT_COLORS[sc.tint] || "#fff");
                        const isQtyCol = sc.id === "inb_qty";
                        const isEditing = isQtyCol && editingKey === eKey;
                        const isSaving = isQtyCol && savingKey === eKey;
                        const isEditable = isQtyCol;

                        // Shared save — called by both Enter and blur.
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
                            console.log("[commitSave] skipped — no change or invalid value");
                            return;
                          }
                          // When an override exists, its item_id takes precedence —
                          // after a DELETE the override has item_id=undefined even though rawCd still has the old id.
                          const effectiveItemId = override !== undefined ? override.item_id : rawCd.item_id;
                          if (!effectiveItemId && newQty === 0) return;
                          setSavingKey(eKey);
                          try {
                            let json: { success: boolean; qty?: number; total_cbm?: number; cbm_unit?: number; item_id?: number };
                            const isActiveContainer = c.status === "shipped" || c.status === "packing_received";
                            const oldQty = cd.inbound_qty ?? 0;

                            if (effectiveItemId && newQty === 0) {
                              // qty → 0 on an existing row: delete it and blank the cell
                              const res = await fetch(`/api/planning/containers/items/${effectiveItemId}`, { method: "DELETE" });
                              json = await res.json() as typeof json;
                              if (json.success) {
                                setQtyOverrides((prev) => {
                                  const next = new Map(prev);
                                  next.set(eKey, { inbound_qty: null, avail_qty: null, cbm: null, item_id: undefined });
                                  return next;
                                });
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
                              const res = await fetch(`/api/planning/containers/items/${effectiveItemId}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ qty: newQty }),
                              });
                              json = await res.json() as typeof json;
                            } else {
                              const res = await fetch("/api/planning/containers/items", {
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
                              setQtyOverrides((prev) => {
                                const next = new Map(prev);
                                next.set(eKey, {
                                  inbound_qty: json.qty ?? newQty,
                                  avail_qty: json.qty ?? newQty,
                                  cbm: json.total_cbm ?? 0,
                                  item_id: json.item_id ?? effectiveItemId ?? undefined,
                                });
                                return next;
                              });
                              if (isActiveContainer) {
                                setRowTotalOverrides((prev) => {
                                  const next = new Map(prev);
                                  const cur = prev.get(r.sku) ?? {};
                                  const curTotal = cur.total_inbound_qty ?? (r.total_inbound_qty ?? 0);
                                  const curList  = cur.containers_list  ?? (r.containers_list ?? "");
                                  const entry = `${c.name} (${newQty})`;
                                  let newList: string;
                                  if (oldQty === 0 || !curList.includes(`${c.name} (`)) {
                                    // POST — container not yet in list, append
                                    newList = curList ? `${curList}, ${entry}` : entry;
                                  } else {
                                    // PATCH — update existing entry's qty
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
                              <span style={{ color: "#9A9790", fontStyle: "italic" }}>…</span>
                            ) : (
                              renderCell(sc.val(cd, c, displayRow))
                            )}
                          </td>
                        );
                      });
                    })}
                  </tr>
                );
                })}
                {virtualRows.bottomHeight > 0 ? (
                  <tr aria-hidden="true" style={{ height: virtualRows.bottomHeight }}>
                    <td
                      colSpan={visCols.length + (showCon ? CONS.length * CON_SUBCOLS.length : 0)}
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
