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
  TODAY,
  daysTo,
  urgStatus,
} from "./columns";
import type { CellContent, ColDef } from "./columns";
import type {
  ColumnGroupKey,
  ContainerMeta,
  DemandPlanningData,
  DemandRow,
  ProductFilter,
  UrgencyFilter,
  UrgencyStatus,
} from "@/types/demand-planning";

interface DemandPlanningGridProps {
  data: DemandPlanningData;
  productFilter: ProductFilter;
  urgencyFilter: UrgencyFilter | null;
  search: string;
  onSearchChange: (v: string) => void;
  onProductFilterChange: (f: ProductFilter) => void;
  onUrgencyFilterChange: (f: UrgencyFilter | null) => void;
  onFilteredRowsChange: (rows: DemandRow[]) => void;
}

const DEFAULT_FREEZE = "sod";

const ALL_GROUP_KEYS: ColumnGroupKey[] = [
  "wsales","esales","wavg","eavg","fba","s30","tavg","inb","con",
];

const GROUP_BTN_LABELS: Record<string, string> = {
  wsales: "📈 West Sales",
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
    padding: "1px 5px",
    borderRight: "1px solid #D8D6CE",
    borderBottom: "1px solid #D8D6CE",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    height: 24,
    background: TINT_COLORS[col.tint] || "#fff",
    textAlign: col.align === "num" ? "right" : col.align === "ctr" ? "center" : "left",
    fontFamily: col.align === "num" ? "monospace" : undefined,
    fontSize: 10,
    fontWeight: col.bold ? 700 : 400,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

export function DemandPlanningGrid({
  data,
  productFilter,
  urgencyFilter,
  search,
  onSearchChange,
  onProductFilterChange,
  onUrgencyFilterChange,
  onFilteredRowsChange,
}: DemandPlanningGridProps) {
  const { containers: CONS, rows: ROWS } = data;

  const [groupVis, setGroupVis] = useState<Record<ColumnGroupKey, boolean>>({
    fix: true, wsales: true, esales: true, wavg: true, eavg: true,
    fba: true, s30: true, tavg: true, inb: true, con: true,
  });
  const [freezeUntil, setFreezeUntil] = useState(DEFAULT_FREEZE);
  const tableRef = useRef<HTMLTableElement>(null);

  const visCols = useMemo(
    () => ALL_COLS.filter((c) => c.grp === "fix" || groupVis[c.grp]),
    [groupVis],
  );

  const showCon = groupVis["con"];

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    return ROWS.filter((r) => {
      if (productFilter === "orig" && r.sales_status !== "Original") return false;
      if (productFilter === "cust" && r.sales_status !== "Custom")   return false;
      if (q && !r.sku.toLowerCase().includes(q) && !(r.containers_list || "").toLowerCase().includes(q)) return false;
      const u: UrgencyStatus = urgStatus(r);
      if (urgencyFilter === "crit") return u === "crit";
      if (urgencyFilter === "warn") return u === "warn" || u === "crit";
      if (urgencyFilter === "bo")   return (r.back || 0) < 0;
      return true;
    });
  }, [ROWS, productFilter, urgencyFilter, search]);

  useEffect(() => {
    onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Apply sticky freeze after every render
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const freezeIdx = visCols.findIndex((c) => c.id === freezeUntil);
    const leftOffsets: number[] = [];
    let cum = 0;
    visCols.forEach((col, i) => {
      leftOffsets.push(cum);
      if (i <= freezeIdx) cum += col.w;
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
        cell.style.zIndex = cell.tagName === "TH" ? "45" : "15";
      } else {
        cell.style.position = "";
        cell.style.left = "";
        cell.style.zIndex = "";
      }
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
        th.style.zIndex = "45";
      } else {
        th.style.position = "";
        th.style.left = "";
        th.style.zIndex = "";
      }
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
    const keep = new Set<string>(["fix", "s30", "tavg", "inb", "con"]);
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
        .col-freeze-end { border-right: 3px solid #4ACCE0 !important; box-shadow: 3px 0 8px rgba(74,200,220,.25); }
        .bo-pos  { color: #C42020; font-weight: 600; }
        .inb-pos { color: #1A4FC0; font-weight: 600; }
        .lv-crit { color: #C42020; font-weight: 700; }
        .lv-warn { color: #9A5200; font-weight: 600; }
        .lv-ok   { color: #0A6A45; font-weight: 500; }
        .lv-over { color: #6B3DB8; font-size: 9px; }
        .lv-dim  { color: #9A9790; }
        .sod-crit { color: #C42020; font-weight: 700; font-size: 9px; }
        .sod-warn { color: #9A5200; font-weight: 600; font-size: 9px; }
        .sod-ok   { color: #5A5750; font-size: 9px; }
        .sc { font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 8px; white-space: nowrap; }
        .sc-orig { background: #E5EEFF; color: #1238A0; }
        .sc-cust { background: #E3F5EC; color: #0A6A45; }
        .sc-hold { background: #FEF3D8; color: #9A5200; }
        .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
        .d-crit { background: #FF4444; }
        .d-warn { background: #EF9F27; }
        .d-ok   { background: #0A6A45; }
      `}</style>

      {/* Column Group Toggle Bar */}
      <div
        style={{
          background: "#252220",
          borderBottom: "2px solid #3a3835",
          height: 30,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 10px",
          overflowX: "auto",
        }}
      >
        <span style={{ fontSize: 8, color: "rgba(255,255,255,.22)", whiteSpace: "nowrap", flexShrink: 0 }}>
          컬럼 그룹
        </span>
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,.1)", margin: "0 2px", flexShrink: 0 }} />
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
                fontSize: 9,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.12)",
                cursor: "pointer",
                color: active ? "#fff" : "rgba(255,255,255,.45)",
                background: active ? GROUP_BTN_COLORS[key] || "rgba(255,255,255,.04)" : "rgba(255,255,255,.04)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {GROUP_BTN_LABELS[key]}
            </button>
          );
        })}
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,.1)", margin: "0 2px", flexShrink: 0 }} />
        <button
          onClick={() => handleToggleGroup("con")}
          style={{
            fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,.12)", cursor: "pointer",
            color: groupVis["con"] ? "#fff" : "rgba(255,255,255,.45)",
            background: groupVis["con"] ? GROUP_BTN_COLORS["con"] : "rgba(255,255,255,.04)",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {GROUP_BTN_LABELS["con"]}
        </button>
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,.1)", margin: "0 2px", flexShrink: 0 }} />
        <button
          onClick={handleAllOn}
          style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,.2)", cursor: "pointer", color: "rgba(255,255,255,.55)", background: "rgba(255,255,255,.04)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          모두 표시
        </button>
        <button
          onClick={handleCoreOnly}
          style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,.2)", cursor: "pointer", color: "rgba(255,255,255,.55)", background: "rgba(255,255,255,.04)", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          핵심만
        </button>
      </div>

      {/* Freeze Selector Bar */}
      <div
        style={{
          background: "#1A1917",
          borderBottom: "2px solid #4A8AAA",
          minHeight: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          overflowX: "auto",
          padding: "0 10px",
        }}
      >
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.3)", whiteSpace: "nowrap", paddingRight: 8, fontFamily: "monospace", flexShrink: 0 }}>
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
                fontSize: 9,
                fontWeight: isEnd ? 800 : frozen ? 700 : 600,
                padding: "3px 8px",
                border: "none",
                borderRight: isEnd ? "3px solid #4ACCE0" : "1px solid #2A2825",
                background: isEnd ? "rgba(74,204,220,.2)" : frozen ? "rgba(74,170,204,.1)" : "transparent",
                cursor: "pointer",
                color: isEnd ? "#fff" : frozen ? "#4ACCE0" : "rgba(255,255,255,.35)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                fontFamily: "monospace",
                position: "relative",
              }}
            >
              {label}
              {isEnd && (
                <span style={{ fontSize: 7, position: "absolute", right: 3, top: 1, color: "#4ACCE0", opacity: 0.8, fontFamily: "monospace", fontWeight: 700 }}>
                  ◀ FREEZE
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setFreezeUntil(DEFAULT_FREEZE)}
          style={{ fontSize: 9, padding: "3px 8px", marginLeft: 6, borderRadius: 4, border: "1px solid rgba(74,170,204,.4)", background: "rgba(74,170,204,.08)", color: "#4ACCE0", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          기본값 복원
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "#F5F4EF",
        }}
      >
        <table
          ref={tableRef}
          style={{ borderCollapse: "collapse", fontSize: 10, minWidth: "max-content" }}
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
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    padding: "3px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    height: 20,
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
                    textTransform: "uppercase",
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
                    fontSize: 8,
                    fontWeight: 600,
                    padding: "2px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "1px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 16,
                  }}
                />
              ))}
              {showCon && CONS.map((c, ci) => {
                const isLast = ci === CONS.length - 1;
                return (
                  <th
                    key={c.name}
                    colSpan={CON_SUBCOLS.length}
                    style={{
                      background: "#2A2825",
                      color: "rgba(255,255,255,.55)",
                      fontSize: 8,
                      fontWeight: 600,
                      padding: "2px 4px",
                      borderRight: isLast ? "1px solid #3a3835" : "2px solid #1A4060",
                      borderBottom: "1px solid #555",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      height: 16,
                    }}
                  >
                    {c.name}&nbsp;/&nbsp;Cap {c.cbm_cap.toFixed(1)}
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
                  style={{
                    background: GROUP_HEADER_COLORS[col.gh] || "#34312D",
                    color: "rgba(255,255,255,.7)",
                    fontSize: 9,
                    fontWeight: 500,
                    padding: "2px 4px",
                    borderRight: "1px solid #3a3835",
                    borderBottom: "2px solid #555",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    height: 30,
                    lineHeight: 1.25,
                    minWidth: col.w,
                    maxWidth: col.w,
                  }}
                >
                  {col.label.split("\n").map((line, i) => (
                    <span key={i}>
                      {i > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </th>
              ))}
              {showCon && CONS.map((c, ci) => {
                const isLast = ci === CONS.length - 1;
                const dt = daysTo(c.eta);
                const etaColor =
                  dt !== null && dt <= 7  ? "#FF9090" :
                  dt !== null && dt <= 21 ? "#F0C060" : "#88D0FF";
                return CON_SUBCOLS.map((sc, si) => {
                  const isLastSub = si === CON_SUBCOLS.length - 1;
                  return (
                    <th
                      key={`${c.name}-${sc.id}`}
                      style={{
                        background: "#34312D",
                        color: "rgba(255,255,255,.7)",
                        fontSize: 9,
                        fontWeight: 500,
                        padding: "2px 4px",
                        borderRight: isLastSub && !isLast ? "2px solid #1A4060" : "1px solid #3a3835",
                        borderBottom: "2px solid #555",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        height: 30,
                        lineHeight: 1.25,
                        minWidth: sc.w,
                        maxWidth: sc.w,
                      }}
                    >
                      {si === 0 && (
                        <span style={{ display: "block", fontSize: 8, fontWeight: 700, color: etaColor }}>
                          {c.name}
                        </span>
                      )}
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
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visCols.length + (showCon ? CONS.length * CON_SUBCOLS.length : 0)}
                  style={{ padding: 20, textAlign: "center", color: "#9A9790" }}
                >
                  조건에 맞는 SKU 없음
                </td>
              </tr>
            ) : (
              filteredRows.map((r, idx) => {
                const u: UrgencyStatus = urgStatus(r);
                const rowBg = u === "crit" ? "#FFF5F5" : idx % 2 === 1 ? "#FAFAF7" : "#fff";
                return (
                  <tr
                    key={r.sku}
                    style={{ height: 24, cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      Array.from(e.currentTarget.cells).forEach(
                        (td) => ((td as HTMLElement).style.background = "#EAF0FF"),
                      );
                    }}
                    onMouseLeave={(e) => {
                      Array.from(e.currentTarget.cells).forEach(
                        (td) => ((td as HTMLElement).style.background = ""),
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
                        {renderCell(col.val(r, idx, u))}
                      </td>
                    ))}
                    {showCon && CONS.map((c, ci) => {
                      const cd = (r.containers && r.containers[c.name]) || {
                        open_orders: 0, avail_qty: null, est_sales: 0,
                        backorder: 0, eta: c.eta, inv_life: null,
                        est_sod: null, plan_sod: null, cbm: 0,
                      };
                      const isLast = ci === CONS.length - 1;
                      return CON_SUBCOLS.map((sc, si) => {
                        const isLastSub = si === CON_SUBCOLS.length - 1;
                        return (
                          <td
                            key={`${c.name}-${sc.id}`}
                            style={{
                              minWidth: sc.w,
                              maxWidth: sc.w,
                              padding: "1px 5px",
                              borderRight: isLastSub && !isLast ? "2px solid #B0D8EE" : "1px solid #D8D6CE",
                              borderBottom: "1px solid #D8D6CE",
                              verticalAlign: "middle",
                              whiteSpace: "nowrap",
                              height: 24,
                              background: TINT_COLORS[sc.tint] || "#fff",
                              textAlign: sc.align === "num" ? "right" : sc.align === "ctr" ? "center" : "left",
                              fontFamily: sc.align === "num" ? "monospace" : undefined,
                              fontSize: 10,
                            }}
                          >
                            {renderCell(sc.val(cd, c))}
                          </td>
                        );
                      });
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
