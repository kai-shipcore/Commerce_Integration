"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { DemandPlanningGrid } from "./demand-planning-grid";
import { StatusBar } from "./status-bar";
import {
  ALL_COLS,
  ALL_GROUP_KEYS,
  COMPACT_COLUMN_IDS,
  GROUP_BTN_LABELS,
  DEFAULT_FREEZE,
  COLUMN_WIDTHS_STORAGE_KEY,
  TODAY,
  loadSavedColumnWidths,
} from "./columns";
import type { ColumnWidths } from "./columns";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDemandPlanningData } from "@/features/planning/demand-planning-data";
import type { VelocityMode } from "@/features/planning/demand-planning-data";
import type { CategoryFilter, ColumnGroupKey, DemandRow, ProductFilter, UrgencyFilter } from "@/types/demand-planning";

const DEFAULT_GROUP_VIS: Record<ColumnGroupKey, boolean> = {
  fix: true,
  stock: true,
  wsales: true,
  esales: true,
  wavg: true,
  eavg: true,
  fba: true,
  s30: true,
  tavg: true,
  inb: true,
  con: false,
};

const COLUMN_SETTINGS_STORAGE_KEY = "planning-dashboard-column-settings";

type ColumnSettings = {
  groupVis: Record<ColumnGroupKey, boolean>;
  compactMode: boolean;
  showRemaining: boolean;
  showMistake: boolean;
  showZeroSales: boolean;
  freezeUntil: string;
};

function loadSavedColumnSettings(): Partial<ColumnSettings> {
  if (typeof window === "undefined") return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMN_SETTINGS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const savedGroupVis = stored.groupVis && typeof stored.groupVis === "object" && !Array.isArray(stored.groupVis)
      ? stored.groupVis as Record<string, unknown>
      : {};
    const groupVis = {
      ...DEFAULT_GROUP_VIS,
      ...Object.fromEntries(
        ALL_GROUP_KEYS
          .filter((key) => typeof savedGroupVis[key] === "boolean")
          .map((key) => [key, savedGroupVis[key]]),
      ),
    } as Record<ColumnGroupKey, boolean>;
    const freezeUntil = typeof stored.freezeUntil === "string" && ALL_COLS.some((col) => col.id === stored.freezeUntil)
      ? stored.freezeUntil
      : undefined;

    return {
      groupVis,
      compactMode: typeof stored.compactMode === "boolean" ? stored.compactMode : undefined,
      showRemaining: typeof stored.showRemaining === "boolean" ? stored.showRemaining : undefined,
      showMistake: typeof stored.showMistake === "boolean" ? stored.showMistake : undefined,
      showZeroSales: typeof stored.showZeroSales === "boolean" ? stored.showZeroSales : undefined,
      freezeUntil,
    };
  } catch {
    return {};
  }
}

export function DemandPlanningDashboard() {
  const [velocityMode, setVelocityMode] = useState<VelocityMode>("link");
  const [todayStr, setTodayStr] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const isHistoricalDate = Boolean(todayStr && asOfDate && asOfDate !== todayStr);
  const {
    data,
    loading,
    containerDetailsLoading,
    containerDetailsLoaded,
    error: loadError,
    reload,
    loadContainerDetails,
  } = useDemandPlanningData(velocityMode, isHistoricalDate ? asOfDate : undefined);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("fm");
  const [isCategoryPending, startCategoryTransition] = useTransition();
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter | null>(null);
  const [search, setSearch] = useState("");
  const [filteredRows, setFilteredRows] = useState<DemandRow[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Hydration-safe: browser-local date is only available after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayStr(today);
    setAsOfDate((current) => current || today);
  }, []);

  const handleProductFilter = useCallback((filter: ProductFilter) => {
    setProductFilter(filter);
    setUrgencyFilter(null);
  }, []);

  const handleCategoryFilter = useCallback((filter: CategoryFilter) => {
    if (filter === categoryFilter) return;
    if (categoryChangeTimerRef.current) window.clearTimeout(categoryChangeTimerRef.current);

    setIsCategoryLoading(true);
    categoryChangeTimerRef.current = window.setTimeout(() => {
      startCategoryTransition(() => {
        setCategoryFilter(filter);
      });
      categoryChangeTimerRef.current = null;
    }, 60);
  }, [categoryFilter]);

  useEffect(() => {
    if (!isCategoryLoading) return;
    const hideTimer = window.setTimeout(() => setIsCategoryLoading(false), 250);
    return () => window.clearTimeout(hideTimer);
  }, [categoryFilter, isCategoryLoading]);

  useEffect(() => {
    return () => {
      if (categoryChangeTimerRef.current) window.clearTimeout(categoryChangeTimerRef.current);
    };
  }, []);

  // ── Column visibility state (lifted from grid) ──────────────────────────────
  const [groupVis, setGroupVis] = useState<Record<ColumnGroupKey, boolean>>(DEFAULT_GROUP_VIS);
  const [compactMode, setCompactMode] = useState(false);
  const [showRemaining, setShowRemaining] = useState(true);
  const [showMistake, setShowMistake] = useState(true);
  const [showZeroSales, setShowZeroSales] = useState(false);
  const [freezeUntil, setFreezeUntil] = useState(DEFAULT_FREEZE);
  const [columnSettingsLoaded, setColumnSettingsLoaded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});
  const columnWidthsRef = useRef<ColumnWidths>({});
  const containerAutoLoadKeyRef = useRef<string | null>(null);
  const categoryChangeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const saved = loadSavedColumnWidths();
    columnWidthsRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnWidths(saved);
  }, []);

  useEffect(() => {
    const saved = loadSavedColumnSettings();
    queueMicrotask(() => {
      if (saved.groupVis) setGroupVis(saved.groupVis);
      if (saved.compactMode !== undefined) setCompactMode(saved.compactMode);
      if (saved.showRemaining !== undefined) setShowRemaining(saved.showRemaining);
      if (saved.showMistake !== undefined) setShowMistake(saved.showMistake);
      if (saved.showZeroSales !== undefined) setShowZeroSales(saved.showZeroSales);
      if (saved.freezeUntil) setFreezeUntil(saved.freezeUntil);
      setColumnSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!columnSettingsLoaded) return;
    window.localStorage.setItem(
      COLUMN_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        groupVis,
        compactMode,
        showRemaining,
        showMistake,
        showZeroSales,
        freezeUntil,
      }),
    );
  }, [columnSettingsLoaded, groupVis, compactMode, showRemaining, showMistake, showZeroSales, freezeUntil]);

  useEffect(() => {
    if (!data.rows.length || containerDetailsLoaded || containerDetailsLoading) return;
    const loadKey = `${velocityMode}|${isHistoricalDate ? asOfDate : "current"}|${data.last_sync ?? ""}|${data.rows.length}`;
    if (containerAutoLoadKeyRef.current === loadKey) return;
    containerAutoLoadKeyRef.current = loadKey;
    loadContainerDetails();
  }, [
    asOfDate,
    containerDetailsLoaded,
    containerDetailsLoading,
    data.last_sync,
    data.rows.length,
    isHistoricalDate,
    loadContainerDetails,
    velocityMode,
  ]);

  const handleColumnWidthsChange = useCallback((next: ColumnWidths) => {
    columnWidthsRef.current = next;
    setColumnWidths(next);
  }, []);

  const resetColumnWidths = useCallback(() => {
    columnWidthsRef.current = {};
    setColumnWidths({});
    window.localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
  }, []);

  const handleAllOn = useCallback(() => {
    setCompactMode(false);
    setGroupVis((prev) =>
      Object.fromEntries(Object.keys(prev).map((k) => [k, true])) as Record<ColumnGroupKey, boolean>,
    );
  }, []);

  const handleCoreOnly = useCallback(() => {
    setCompactMode(false);
    const keep = new Set<string>(["fix", "stock", "s30", "tavg", "inb"]);
    setGroupVis((prev) =>
      Object.fromEntries(Object.keys(prev).map((k) => [k, keep.has(k)])) as Record<ColumnGroupKey, boolean>,
    );
  }, []);

  const handleCompact = useCallback(() => {
    setCompactMode(true);
    const keep = new Set<string>(["fix", "stock", "tavg", "inb"]);
    setGroupVis((prev) =>
      Object.fromEntries(Object.keys(prev).map((k) => [k, keep.has(k)])) as Record<ColumnGroupKey, boolean>,
    );
    setFreezeUntil("sod");
  }, []);

  const handleToggleGroup = useCallback(
    (key: ColumnGroupKey) => {
      if (key !== "con") setCompactMode(false);
      setGroupVis((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        const nextVisCols = ALL_COLS.filter((c) => c.grp === "fix" || next[c.grp]);
        const stillVis = nextVisCols.find((c) => c.id === freezeUntil);
        if (!stillVis && nextVisCols.length > 0) {
          setFreezeUntil(nextVisCols[nextVisCols.length - 1].id);
        }
        return next;
      });
    },
    [freezeUntil],
  );

  const hiddenGroupCount = ALL_GROUP_KEYS.filter((k) => !groupVis[k]).length;

  const visColsForFreeze = useMemo(
    () => ALL_COLS
      .filter((c) => c.grp === "fix" || groupVis[c.grp])
      .filter((c) => !compactMode || COMPACT_COLUMN_IDS.has(c.id)),
    [groupVis, compactMode],
  );
  // ─────────────────────────────────────────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    const header = [
      "#",
      "SKU",
      "West",
      "East",
      "Total",
      "Back",
      "Status",
      "W30D",
      "E30D",
      "Total30D",
      "TAvgCurr",
      "Inbound",
      "ContainersList",
      "NextETA",
      "SOD",
    ];
    const csvRows = [
      header,
      ...filteredRows.map((row, index) => [
        index + 1,
        row.sku,
        row.west_stock,
        row.east_stock,
        row.total_stock,
        row.back,
        row.sales_status,
        row.west_30d,
        row.east_30d,
        row.total_30d,
        row.total_avg_curr,
        row.total_inbound_qty,
        row.containers_list,
        row.next_eta ?? "",
        row.sod ?? "",
      ]),
    ];
    const csv = csvRows
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `planning_${TODAY}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  const hasData = data.rows.length > 0;
  const containerStatusText = containerDetailsLoading
    ? "Loading containers..."
    : containerDetailsLoaded
      ? "Containers ready"
      : "Containers pending";

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, ui-sans-serif, system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
        fontSize: 12,
        background: "#F0EEE9",
        color: "#1A1917",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      <style>{`
        @keyframes dashboard-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #D8D6CE",
          height: 42,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 12px",
          overflowX: "auto",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <select
            aria-label="Product category"
            value={categoryFilter}
            onChange={(event) => handleCategoryFilter(event.target.value as CategoryFilter)}
            style={{
              minWidth: 112,
              height: 26,
              padding: "2px 7px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: "#E3F5EC",
              color: "#0A6A45",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value="fm">Floor Mat</option>
            <option value="cc">Car Cover</option>
            <option value="sc">Seat Cover</option>
          </select>
        </label>

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        <select
          aria-label="Product type filter"
          value={productFilter}
          onChange={(e) => handleProductFilter(e.target.value as ProductFilter)}
          style={{
            height: 26,
            padding: "2px 7px",
            borderRadius: 4,
            border: "1px solid #C2BFB5",
            background: productFilter !== "all" ? "#E5EEFF" : "#fff",
            color: productFilter !== "all" ? "#1A4FC0" : "#1A1917",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <option value="all">All Types</option>
          <option value="orig">Original</option>
          <option value="cust">Custom</option>
        </select>

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        <select
          aria-label="Urgency filter"
          value={urgencyFilter ?? ""}
          onChange={(e) => setUrgencyFilter(e.target.value === "" ? null : e.target.value as UrgencyFilter)}
          style={{
            height: 26,
            padding: "2px 7px",
            borderRadius: 4,
            border: "1px solid",
            borderColor: urgencyFilter === "crit" ? "#f0aaaa" : urgencyFilter === "warn" ? "#f0d0aa" : urgencyFilter === "bo" ? "#aac0f0" : "#C2BFB5",
            background: urgencyFilter === "crit" ? "#FFEDED" : urgencyFilter === "warn" ? "#FEF3D8" : urgencyFilter === "bo" ? "#E5EEFF" : "#fff",
            color: urgencyFilter === "crit" ? "#C42020" : urgencyFilter === "warn" ? "#9A5200" : urgencyFilter === "bo" ? "#1A4FC0" : "#1A1917",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <option value="">— All Status</option>
          <option value="crit">Critical</option>
          <option value="warn">Warning</option>
          <option value="bo">BackOrder</option>
        </select>

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        <div style={{ position: "relative", width: 210, flexShrink: 0 }}>
          <Search
            aria-hidden="true"
            size={14}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#7A766F",
              pointerEvents: "none",
            }}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SKU / container..."
            style={{
              padding: "5px 30px 5px 30px",
              border: "1px solid #C2BFB5",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              outline: "none",
              width: "100%",
              background: "#F5F4EF",
              color: "#1A1917",
              boxSizing: "border-box",
            }}
          />
          {search ? (
            <button
              type="button"
              aria-label="Reset search"
              title="Reset search"
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 5,
                top: "50%",
                transform: "translateY(-50%)",
                width: 20,
                height: 20,
                border: "1px solid #C2BFB5",
                borderRadius: 10,
                background: "#fff",
                color: "#5A5750",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: "18px",
                padding: 0,
              }}
            >
              X
            </button>
          ) : null}
        </div>

        {hasData && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 30,
                  boxSizing: "border-box",
                  padding: "0 10px",
                  borderRadius: 4,
                  border: "1px solid #C2BFB5",
                  cursor: "pointer",
                  color: "#1A1917",
                  background: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                ⊞ Columns
                {compactMode ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#E5EEFF", color: "#1A4FC0" }}>
                    Compact
                  </span>
                ) : hiddenGroupCount > 0 ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#FFEDED", color: "#C42020" }}>
                    {hiddenGroupCount} hidden
                  </span>
                ) : null}
                {" ▾"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="dashboard-columns-popover" style={{ width: 272, padding: 0, overflow: "hidden" }}>
              {/* Header with close button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 0" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1E293B" }}>Columns</span>
                <PopoverClose asChild>
                  <button
                    type="button"
                    aria-label="닫기"
                    style={{
                      width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 4, border: "none", background: "transparent", cursor: "pointer",
                      color: "#94A3B8", fontSize: 16, lineHeight: 1,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#F1F5F9"; (e.currentTarget as HTMLButtonElement).style.color = "#475569"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#94A3B8"; }}
                  >
                    ✕
                  </button>
                </PopoverClose>
              </div>
              {/* Quick Presets */}
              <div style={{ padding: "8px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Quick Preset
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {([
                    { label: "All", action: handleAllOn, active: !compactMode && hiddenGroupCount === 0 },
                    { label: "Core", action: handleCoreOnly, active: false },
                    { label: "Compact", action: handleCompact, active: compactMode },
                  ] as { label: string; action: () => void; active: boolean }[]).map(({ label, action, active }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={action}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "4px 12px",
                        borderRadius: 5,
                        border: active ? "1px solid #3B82F6" : "1px solid #CBD5E1",
                        cursor: "pointer",
                        background: active ? "#EFF6FF" : "#F8FAFC",
                        color: active ? "#1D4ED8" : "#475569",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column Groups */}
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Column Groups
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {ALL_GROUP_KEYS.map((key) => {
                    const checked = groupVis[key];
                    return (
                      <label
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "3px 6px",
                          borderRadius: 4,
                          cursor: "pointer",
                          background: checked ? "rgba(59,130,246,.06)" : "transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleGroup(key)}
                          style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 500, color: checked ? "#1E3A5F" : "#94A3B8" }}>
                          {key === "con" && containerDetailsLoading ? "Loading Container..." : GROUP_BTN_LABELS[key]}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Options
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, cursor: "pointer", background: showRemaining ? "rgba(59,130,246,.06)" : "transparent" }}>
                    <input type="checkbox" checked={showRemaining} onChange={() => setShowRemaining((v) => !v)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: showRemaining ? "#1E3A5F" : "#94A3B8" }}>Show Remaining</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, cursor: "pointer", background: showMistake ? "rgba(59,130,246,.06)" : "transparent" }}>
                    <input type="checkbox" checked={showMistake} onChange={() => setShowMistake((v) => !v)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: showMistake ? "#1E3A5F" : "#94A3B8" }}>Show Mistake</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, cursor: "pointer", background: showZeroSales ? "rgba(59,130,246,.06)" : "transparent" }}>
                    <input type="checkbox" checked={showZeroSales} onChange={() => setShowZeroSales((v) => !v)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: showZeroSales ? "#1E3A5F" : "#94A3B8" }}>Show Zero-Sales SKUs</span>
                  </label>
                </div>
              </div>

              {/* Freeze Column */}
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  📌 Freeze Column
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={freezeUntil}
                    onChange={(e) => setFreezeUntil(e.target.value)}
                    style={{ flex: 1, fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", color: "#1E293B", cursor: "pointer" }}
                  >
                    {visColsForFreeze.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label.replace("\n", " ")}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFreezeUntil(DEFAULT_FREEZE)}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F1F5F9", color: "#64748B", whiteSpace: "nowrap" }}
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Reset Column Widths */}
              <div style={{ padding: "8px 14px" }}>
                <button
                  type="button"
                  onClick={resetColumnWidths}
                  style={{ width: "100%", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569", textAlign: "center" }}
                >
                  Reset Column Widths
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}

        <StatusBar rows={filteredRows} inline />

        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {hasData ? (
            <span
              style={{
                color: containerDetailsLoaded ? "#0A6A45" : "#7A766F",
                background: containerDetailsLoaded ? "#E3F5EC" : "#F5F4EF",
                border: "1px solid #D8D6CE",
                borderRadius: 4,
                padding: "3px 7px",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {containerStatusText}
            </span>
          ) : null}
          {loadError && (
            <span style={{ color: "#C42020", fontSize: 11 }}>Error: {loadError}</span>
          )}
          <span suppressHydrationWarning style={{ color: "#7A766F", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 11 }}>
            {data.last_sync ? `Synced ${data.last_sync.slice(0, 16).replace("T", " ")}` : "—"}
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: "#5A5750", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>As of</span>
            <input
              type="date"
              value={asOfDate}
              max={todayStr || undefined}
              onChange={(e) => setAsOfDate(e.target.value || todayStr)}
              style={{
                height: 26,
                padding: "2px 6px",
                borderRadius: 4,
                border: isHistoricalDate ? "1px solid #aac0f0" : "1px solid #C2BFB5",
                background: isHistoricalDate ? "#E5EEFF" : "#F5F4EF",
                color: isHistoricalDate ? "#1A4FC0" : "#1A1917",
                fontSize: 11,
                fontWeight: isHistoricalDate ? 600 : 400,
                cursor: "pointer",
              }}
            />
            {isHistoricalDate && (
              <button
                type="button"
                onClick={() => setAsOfDate(todayStr)}
                title="Reset to today"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #aac0f0",
                  background: "#E5EEFF",
                  color: "#1A4FC0",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Today
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!hasData}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: "#fff",
              cursor: hasData ? "pointer" : "default",
              color: hasData ? "#1A1917" : "#A8A49E",
              whiteSpace: "nowrap",
            }}
          >
            CSV
          </button>
          <div style={{ display: "flex", borderRadius: 4, border: "1px solid #C2BFB5", overflow: "hidden" }}>
            {(["link", "custom"] as VelocityMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setVelocityMode(m)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "5px 10px",
                  border: "none",
                  borderRight: m === "link" ? "1px solid #C2BFB5" : undefined,
                  background: velocityMode === m ? "#1A1917" : "#fff",
                  color: velocityMode === m ? "#fff" : "#1A1917",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {m === "link" ? "Link" : "Custom"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 12px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: loading ? "#F5F4EF" : "#1A1917",
              cursor: loading ? "default" : "pointer",
              color: loading ? "#7A766F" : "#fff",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "Loading…" : "Sync"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {!hasData && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#F0EEE9", zIndex: 5 }}>
            <span style={{ fontSize: 13, color: "#7A766F" }}>Press Sync to load planning data</span>
            <button
              type="button"
              onClick={reload}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "7px 20px",
                borderRadius: 4,
                border: "1px solid #C2BFB5",
                background: "#1A1917",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              Sync
            </button>
          </div>
        )}
        {!hasData && loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F0EEE9", zIndex: 5, fontSize: 13, color: "#7A766F" }}>
            Loading…
          </div>
        )}
        {hasData && (isCategoryLoading || isCategoryPending) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(240,238,233,0.52)",
              backdropFilter: "blur(1px)",
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 14px",
                borderRadius: 4,
                border: "1px solid #C2BFB5",
                background: "rgba(255,255,255,0.96)",
                boxShadow: "0 8px 24px rgba(26,25,23,0.16)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: "2px solid #C2BFB5",
                  borderTopColor: "#1A1917",
                  animation: "dashboard-spin 0.8s linear infinite",
                }}
              />
              <span
                style={{
              color: "#5A5750",
                }}
              >
                Loading...
              </span>
            </div>
          </div>
        )}
        <DemandPlanningGrid
          data={data}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          onFilteredRowsChange={setFilteredRows}
          onLoadContainerDetails={loadContainerDetails}
          containerDetailsLoading={containerDetailsLoading}
          containerDetailsLoaded={containerDetailsLoaded}
          groupVis={groupVis}
          compactMode={compactMode}
          showRemaining={showRemaining}
          showMistake={showMistake}
          showZeroSales={showZeroSales}
          freezeUntil={freezeUntil}
          columnWidths={columnWidths}
          columnWidthsRef={columnWidthsRef}
          onColumnWidthsChange={handleColumnWidthsChange}
        />
      </div>
    </div>
  );
}
