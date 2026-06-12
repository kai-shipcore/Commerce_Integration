"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef as AgColDef,
  type ColGroupDef,
  type CellMouseDownEvent,
  type CellMouseOverEvent,
  type ICellRendererParams,
  type IHeaderGroupParams,
  type IHeaderParams,
} from "ag-grid-community";
import {
  ALL_COLS,
  COLUMN_WIDTHS_STORAGE_KEY,
  COMPACT_COLUMN_IDS,
  CON_SUBCOLS,
  GROUP_LABELS,
  TINT_COLORS,
  TODAY,
  isResizableColumnId,
  skuMatchesPartFilters,
  urgStatus,
} from "./columns";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { inventoryLifeDays } from "@/lib/planning/forecast-calculations";
import { seasonalFactorForEta, type SeasonalFactors } from "@/lib/planning/seasonal-factors";
import {
  findOptimalBaseTarget,
  generateOrders,
  getTier,
  type GradientTier,
  type SkuOrderInput,
} from "@/lib/planning/order-optimizer";
import type { CellContent } from "./columns";
import type { DemandPlanningGridProps } from "./demand-planning-grid";
import type { ContainerMeta, ContainerRowData, DemandRow } from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";

const modules = [AllCommunityModule];
const MIN_SCROLLABLE_CENTER_WIDTH = 240;
const planningTheme = themeQuartz.withParams({
  backgroundColor: "#fff",
  borderColor: "#D8D6CE",
  browserColorScheme: "light",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 11,
  foregroundColor: "#1A1917",
  headerBackgroundColor: "#2A2825",
  headerFontSize: 10,
  headerTextColor: "rgba(255,255,255,.82)",
  oddRowBackgroundColor: "#FAFAF7",
  rowBorder: { color: "#D8D6CE" },
  selectedRowBackgroundColor: "#DCEAFF",
  spacing: 4,
});

type QtyOverride = {
  inbound_qty: number | null;
  avail_qty: number | null;
  cbm: number | null;
  cbm_unit?: number | null;
  item_id?: number;
  allocated_remaining_qty?: number | null;
};

type ChainDerived = {
  open_orders: number | null;
  avail_qty: number | null;
  est_sales: number | null;
  backorder: number | null;
  carryover: number | null;
  inv_life: number | null;
  est_sod: string | null;
  plan_sod: string | null;
};

type ContainerColumnTotals = Partial<Record<"ccbm" | "inb_qty" | "remaining" | "mistake" | "oo", number>>;

type ContainerTotalColumn = {
  id: string;
  width: number;
  total?: number;
};

type SelectedAgCell = { rowId: string; columnId: string; label: string };
type DragCellAnchor = { rowIndex: number; columnId: string };

function readableTextColor(backgroundColor: string) {
  const match = backgroundColor.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return "#fff";
  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#1A1917" : "#fff";
}

function headerStyleForColor(backgroundColor: string | undefined) {
  return backgroundColor
    ? {
        backgroundColor,
        color: readableTextColor(backgroundColor),
      }
    : undefined;
}

function selectedCellsBetween(
  event: CellMouseDownEvent<DemandRow> | CellMouseOverEvent<DemandRow>,
  anchor: DragCellAnchor,
): SelectedAgCell[] {
  if (event.rowIndex === null) return [];
  const columns = event.api.getAllDisplayedColumns();
  const anchorColumnIndex = columns.findIndex((column) => column.getColId() === anchor.columnId);
  const currentColumnIndex = columns.findIndex((column) => column.getColId() === event.column.getColId());
  if (anchorColumnIndex < 0 || currentColumnIndex < 0) return [];

  const startRowIndex = Math.min(anchor.rowIndex, event.rowIndex);
  const endRowIndex = Math.max(anchor.rowIndex, event.rowIndex);
  const startColumnIndex = Math.min(anchorColumnIndex, currentColumnIndex);
  const endColumnIndex = Math.max(anchorColumnIndex, currentColumnIndex);
  const selected = new Map<string, SelectedAgCell>();

  for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
    const rowNode = event.api.getDisplayedRowAtIndex(rowIndex);
    const row = rowNode?.data;
    if (!row) continue;
    for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex += 1) {
      const column = columns[columnIndex];
      const columnId = column.getColId();
      const key = `${row.sku}::${columnId}`;
      if (selected.has(key)) continue;
      selected.set(key, {
        rowId: row.sku,
        columnId,
        label: `${row.base_sku ?? row.sku} / ${column.getColDef().headerName ?? columnId}`,
      });
    }
  }

  return Array.from(selected.values());
}

function cellColorKey(rowId: string | undefined, columnId: string) {
  return rowId ? `${rowId}::${columnId}` : "";
}

function containerColumnWidth(column: { id: string; w: number }) {
  if (column.id === "ccbm") return 48;
  if (column.id === "inb_qty") return 42;
  if (column.id === "remaining") return 42;
  if (column.id === "esod" || column.id === "psod") return 70;
  return column.w;
}

function baseColumnWidth(column: { id: string; w: number }) {
  if (column.id === "eavg_p" || column.id === "eavg_r" || column.id === "eavg_c") return 50;
  if (column.id === "tavg_p" || column.id === "tavg_r" || column.id === "tavg_c") return 50;
  return column.w;
}

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" | "AC" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

function computeContainerChain(
  row: DemandRow,
  containers: ContainerMeta[],
  overrides: Map<string, QtyOverride>,
  seasonalFactors: SeasonalFactors,
): Map<string, ChainDerived> {
  const result = new Map<string, ChainDerived>();
  const effectiveTotal = row.stock_mode === 'available'
    ? ((row.west_available_stock ?? 0) + (row.east_available_stock ?? 0) + (row.transit_stock ?? 0))
    : (row.total_stock ?? 0);
  const availableQty = effectiveTotal + (row.back ?? 0);
  const dailyRate = row.total_avg_curr ?? 0;
  let previousCarryover = Math.max(0, availableQty);
  let previousBackorder = availableQty < 0 ? Math.abs(availableQty) : 0;
  let previousSod = row.sod;
  let previousEta = TODAY;
  let cumulativeAvailableQty = availableQty;
  const baseline = containers[0];
  const baselineSeasonalFactor = seasonalFactorForEta(baseline?.eta ?? TODAY, seasonalFactors);
  const baselineInventoryLife = inventoryLifeDays(previousCarryover, dailyRate, baselineSeasonalFactor);
  const baselinePlanSod = baselineInventoryLife === null
    ? null
    : new Date(new Date(baseline?.eta ?? TODAY).getTime() + baselineInventoryLife * 86400000).toISOString().slice(0, 10);

  if (baseline) {
    result.set(baseline.name, {
      open_orders: 0,
      avail_qty: availableQty,
      est_sales: 0,
      backorder: previousBackorder,
      carryover: previousCarryover,
      inv_life: baselineInventoryLife,
      est_sod: row.sod,
      plan_sod: baselinePlanSod,
    });
  }

  for (const container of containers.slice(1)) {
    const key = `${row.sku}::${container.name}`;
    const raw = row.containers?.[container.name];
    // Pinned rows only chain their own test containers; others would corrupt prevEta
    if (row.is_pinned && !raw) continue;
    const qty = overrides.get(key)?.inbound_qty ?? raw?.inbound_qty ?? 0;
    cumulativeAvailableQty += qty;
    const eta = container.eta ?? TODAY;
    const openOrders = previousCarryover > 0 ? 0 : (previousBackorder > qty ? -qty : -previousBackorder);
    const available = Math.round(previousCarryover > 0 ? previousCarryover + qty : qty - previousBackorder);
    const days = Math.round((new Date(eta).getTime() - new Date(previousEta).getTime()) / 86400000);
    const seasonalFactor = seasonalFactorForEta(eta, seasonalFactors);
    const estimatedSales = Math.round(days * dailyRate * seasonalFactor);
    const backorder = Math.max(0, Math.round(estimatedSales - available));
    const carryover = backorder >= 1 ? 0 : Math.max(0, Math.round(available - estimatedSales));
    const inventoryLife = inventoryLifeDays(carryover, dailyRate, seasonalFactor);
    const adjustedRate = dailyRate * seasonalFactor;
    const invLifeFloor = adjustedRate > 0 ? Math.floor(carryover / adjustedRate) : null;
    const sodFromContainer = invLifeFloor === null
      ? null
      : new Date(new Date(eta).getTime() + invLifeFloor * 86400000).toISOString().slice(0, 10);
    const estimatedSod = (!qty || carryover === 0)
      ? previousSod
      : previousSod && sodFromContainer
        ? (previousSod > sodFromContainer ? previousSod : sodFromContainer)
        : (sodFromContainer ?? previousSod);

    result.set(container.name, {
      open_orders: openOrders,
      avail_qty: cumulativeAvailableQty,
      est_sales: estimatedSales,
      backorder,
      carryover,
      inv_life: inventoryLife,
      est_sod: estimatedSod,
      plan_sod: sodFromContainer,
    });
    previousCarryover = carryover;
    previousBackorder = backorder;
    previousSod = estimatedSod;
    previousEta = eta;
  }
  return result;
}

function renderCellValue(value: CellContent | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "html" in value) {
    return <span dangerouslySetInnerHTML={{ __html: value.html }} />;
  }
  return <span>{String(value)}</span>;
}

function exportCellValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null && "html" in value) {
    const element = document.createElement("span");
    element.innerHTML = String((value as { html: unknown }).html);
    return element.textContent ?? "";
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : String(value);
}

function excelDateSerial(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 + 25569;
}

function CellRenderer({ value }: ICellRendererParams<DemandRow, CellContent>) {
  return renderCellValue(value);
}

async function copyText(value: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy text");
}

function CopyableCellRenderer({
  value,
  node,
  copyValue,
  label,
  badge,
}: ICellRendererParams<DemandRow, CellContent> & {
  copyValue: string;
  label: string;
  badge?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!copyValue) return;

    try {
      await copyText(copyValue);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`View ${label}`}
          onClick={() => node.setSelected(true, true)}
          className="flex h-full w-full min-w-0 items-center text-left"
        >
          <span className="min-w-0 flex-1 truncate">{renderCellValue(value)}</span>
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.03em", padding: "1px 4px", borderRadius: 3, background: "#F59E0B", color: "#fff", flexShrink: 0, marginLeft: 4 }}>
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={0}
        className="w-[min(720px,calc(100vw-32px))] p-0"
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!copyValue}
            onClick={() => void handleCopy()}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-4 pb-4 text-base">
          {copyValue || "-"}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QtyCellRenderer({
  value,
  node,
  onSave,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (qty: number) => Promise<boolean>;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(displayValue);
  }, [displayValue, editing]);

  async function commit() {
    if (savingRef.current) return;
    const nextQty = Number.parseInt(inputValue, 10);
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      setInputValue(displayValue);
      setEditing(false);
      return;
    }
    if (String(nextQty) === displayValue) {
      setEditing(false);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(nextQty);
      if (!saved) setInputValue(displayValue);
    } catch {
      setInputValue(displayValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="relative h-full w-full">
        <input
          autoFocus
          type="number"
          min={0}
          value={inputValue}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setInputValue(displayValue);
              setEditing(false);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
          onBlur={() => void commit()}
          className="absolute right-0 top-0 h-full min-w-[88px] border border-[#1a5cdb] bg-[#FFFDE7] px-2 text-right font-mono text-[11px] outline-none"
          style={{ zIndex: 100 }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title="Click to edit quantity"
      onClick={(event) => {
        event.stopPropagation();
        node.setSelected(true, true);
        setEditing(true);
      }}
      className="h-full w-full border-0 bg-transparent px-1 text-right font-mono text-[11px] font-semibold text-[#1A4FC0]"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}

function TransitCellRenderer({
  value,
  node,
  onSave,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (qty: number) => Promise<boolean>;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "0" : String(value);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(displayValue);
  }, [displayValue, editing]);

  async function commit() {
    if (savingRef.current) return;
    const next = Number.parseInt(inputValue, 10);
    if (!Number.isFinite(next) || next < 0) {
      setInputValue(displayValue);
      setEditing(false);
      return;
    }
    if (String(next) === displayValue) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(next);
      if (!saved) setInputValue(displayValue);
    } catch {
      setInputValue(displayValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="relative h-full w-full">
        <input
          autoFocus
          type="number"
          min={0}
          value={inputValue}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setInputValue(displayValue); setEditing(false); }
            if (event.key === "Enter") { event.preventDefault(); void commit(); }
          }}
          onBlur={() => void commit()}
          className="absolute right-0 top-0 h-full min-w-[88px] border border-[#1a5cdb] bg-[#FFFDE7] px-2 text-right font-mono text-[11px] outline-none"
          style={{ zIndex: 100 }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title="Click to edit transit stock"
      onClick={(event) => {
        event.stopPropagation();
        node.setSelected(true, true);
        setEditing(true);
      }}
      className="h-full w-full border-0 bg-transparent px-1 text-right font-mono text-[11px] font-semibold text-[#1A4FC0]"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}

function StockModeCellRenderer({
  value,
  node,
  onToggle,
}: ICellRendererParams<DemandRow, CellContent> & { onToggle: () => Promise<void> }) {
  const [toggling, setToggling] = useState(false);
  const isAvailable = value === "available";
  return (
    <button
      type="button"
      disabled={toggling}
      title={isAvailable ? "Available stock — click for Onhand" : "Onhand stock — click for Available"}
      onClick={async (e) => {
        e.stopPropagation();
        node.setSelected(true, true);
        setToggling(true);
        await onToggle();
        setToggling(false);
      }}
      className="h-full w-full border-0 bg-transparent text-[9px] font-bold"
      style={{ color: isAvailable ? "#1A4FC0" : "#6B7280" }}
    >
      {toggling ? "…" : isAvailable ? "AV" : "OH"}
    </button>
  );
}

function CbmCellRenderer({
  value,
  node,
  onSave,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (cbm: number) => Promise<boolean>;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(displayValue);
  }, [displayValue, editing]);

  async function commit() {
    if (savingRef.current) return;
    const nextCbm = Number.parseFloat(inputValue);
    if (!Number.isFinite(nextCbm) || nextCbm < 0) {
      setInputValue(displayValue);
      setEditing(false);
      return;
    }
    if (nextCbm === Number.parseFloat(displayValue)) {
      setEditing(false);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(nextCbm);
      if (!saved) setInputValue(displayValue);
    } catch {
      setInputValue(displayValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        step="0.0001"
        value={inputValue}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setInputValue(displayValue);
            setEditing(false);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
        onBlur={() => void commit()}
        className="h-full w-full border-0 bg-[#FFFDE7] px-1 text-right font-mono text-[11px] outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title="Click to edit CBM"
      onClick={(event) => {
        event.stopPropagation();
        node.setSelected(true, true);
        setEditing(true);
      }}
      className="h-full w-full border-0 bg-transparent px-1 text-right font-mono text-[11px] text-[#1A4FC0]"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}

function ConQtyHeader(params: IHeaderParams & {
  isFiltered: boolean;
  onRightClick: (x: number, y: number) => void;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 3, width: "100%", height: "100%", cursor: "pointer", userSelect: "none" }}
      onClick={(e) => {
        e.stopPropagation();
        params.progressSort(e.shiftKey);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        params.onRightClick(e.clientX, e.clientY);
      }}
    >
      <span>Con. Qty</span>
      {params.isFiltered && (
        <span style={{ color: "#1a5cdb", fontSize: 9, lineHeight: 1 }}>▼</span>
      )}
    </div>
  );
}

function ContainerGroupHeader(
  props: IHeaderGroupParams & {
    eta: string;
    baseline: boolean;
    totalColumns: ContainerTotalColumn[];
    onEtaChange: (value: string) => void;
    onAutoFill?: () => void;
    onSave?: () => void;
    onReset?: () => void;
    autoFilling?: boolean;
    saving?: boolean;
    dirty?: boolean;
  },
) {
  return (
    <div className="flex w-full flex-col overflow-hidden whitespace-nowrap text-[10px]">
      <div className="flex items-center justify-center gap-1 overflow-hidden">
        <span className="max-w-full truncate font-bold">{props.displayName}</span>
        {props.baseline ? null : (
          <>
            <span>| ETA</span>
            <label className="flex items-center gap-1">
              <input
                type="date"
                value={props.eta}
                onChange={(event) => props.onEtaChange(event.target.value)}
                style={{ colorScheme: "dark" }}
                className="w-[94px] rounded border border-white/30 bg-transparent px-1 text-[9px] text-white"
              />
            </label>
            <button
              onClick={props.onAutoFill}
              disabled={props.autoFilling}
              title="Con qty 자동 계산 (저장 전 미리보기)"
              className="rounded px-3 py-1.5 text-[15px] bg-white/10 hover:bg-white/20 disabled:opacity-40 cursor-pointer"
            >
              {props.autoFilling ? "…" : "⟳"}
            </button>
            {props.dirty && (
              <>
                <button
                  onClick={props.onReset}
                  title="DB 원래 값으로 초기화"
                  className="rounded px-3 py-1.5 text-[15px] bg-red-500/70 hover:bg-red-500 cursor-pointer"
                >
                  ↺
                </button>
                <button
                  onClick={props.onSave}
                  disabled={props.saving}
                  title="DB에 저장"
                  className="rounded px-3 py-1.5 text-[15px] bg-green-600/70 hover:bg-green-600 disabled:opacity-40 cursor-pointer"
                >
                  {props.saving ? "…" : "💾"}
                </button>
              </>
            )}
          </>
        )}
      </div>
      {props.baseline ? null : (
        <div className="flex w-full text-[9px] font-bold text-[#7EB880]">
          {props.totalColumns.map((column) => {
            const totalLabel = column.total === undefined
              ? ""
              : column.id === "ccbm"
                ? column.total.toFixed(1)
                : Math.round(column.total).toLocaleString();
            return (
              <span
                key={column.id}
                title={totalLabel ? `Total: ${totalLabel}` : undefined}
                className="shrink-0 truncate text-center"
                style={{ width: column.width }}
              >
                {totalLabel}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgDemandPlanningGrid({
  data,
  loading,
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
  onColumnWidthsChange,
  seasonalFactors,
  columnColors = {},
  cellColors = {},
  selectedCellKeys = [],
  onAgCellSelected,
  onCellSelectionChange,
  onExportReady,
  gradient = [],
  gradientSC = [],
}: DemandPlanningGridProps) {
  const gridRef = useRef<AgGridReact<DemandRow>>(null);
  const gridHostRef = useRef<HTMLDivElement>(null);
  const dragCellAnchorRef = useRef<DragCellAnchor | null>(null);
  const selectedCellsRef = useRef<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const [etaOverrides, setEtaOverrides] = useState<Map<number, string>>(new Map());
  const [qtyOverrides, setQtyOverrides] = useState<Map<string, QtyOverride>>(new Map());
  const [chainMap, setChainMap] = useState<Map<string, Map<string, ChainDerived>>>(new Map());
  const [chainReadyAfterLoad, setChainReadyAfterLoad] = useState(true);
  const [cbmOverrides, setCbmOverrides] = useState<Map<string, number>>(new Map());
  const [rowOverrides, setRowOverrides] = useState<Map<string, Partial<DemandRow>>>(new Map());
  const [gridWidth, setGridWidth] = useState(0);
  const [conQtyFilter, setConQtyFilter] = useState<string | null>(null);
  const [qtyCtxMenu, setQtyCtxMenu] = useState<{ x: number; y: number; containerName: string } | null>(null);
  const [dirtyContainers, setDirtyContainers] = useState<Set<string>>(new Set());
  const [autoFillingContainers, setAutoFillingContainers] = useState<Set<string>>(new Set());
  const [savingContainers, setSavingContainers] = useState<Set<string>>(new Set());

  const containers = useMemo(
    () => data.containers
      .map((container) => container.container_id !== undefined && etaOverrides.has(container.container_id)
        ? { ...container, eta: etaOverrides.get(container.container_id)! }
        : container)
      .filter((container) => {
        if (container.status === "baseline") return true;
        if (!container.categories?.length) {
          if (container.name.endsWith("-FLOOR")) return categoryFilter === "fm";
          if (container.name.endsWith("-SEAT")) return categoryFilter === "sc";
          return categoryFilter === "cc";
        }
        return container.categories.includes(categoryFilter.toUpperCase());
      }),
    [categoryFilter, data.containers, etaOverrides],
  );

  const visibleRows = useMemo(() => {
    const query = search.toLowerCase();
    const filtered = data.rows.filter((row) => {
      if (categoryCodeForRow(row) !== categoryFilter.toUpperCase()) return false;
      if (row.sales_status !== "Part" && !showZeroSales && !urgencyFilter &&
        !row.west_90d && !row.west_60d && !row.west_30d && !row.west_15d && !row.west_7d &&
        !row.east_90d && !row.east_60d && !row.east_30d && !row.east_15d && !row.east_7d) return false;
      if (productFilter === "orig" && row.sales_status !== "Original") return false;
      if (productFilter === "cust" && row.sales_status !== "Custom") return false;
      if (!skuMatchesPartFilters(row, skuPartFilters)) return false;
      const displaySku = (row.base_sku ?? row.sku).toLowerCase();
      if (query && !displaySku.includes(query) && !(row.containers_list ?? "").toLowerCase().includes(query)) return false;
      const urgency = urgStatus(row);
      if (urgencyFilter === "crit") return urgency === "crit";
      if (urgencyFilter === "warn") return urgency === "warn";
      if (urgencyFilter === "bo") return (row.back ?? 0) < 0;
      if (conQtyFilter) {
        const qty = qtyOverrides.get(`${row.sku}::${conQtyFilter}`)?.inbound_qty
          ?? row.containers?.[conQtyFilter]?.inbound_qty
          ?? 0;
        if ((qty ?? 0) <= 0) return false;
      }
      return true;
    });
    // Pinned rows at the top, Part rows at the bottom.
    const pinned = filtered.filter((r) => r.is_pinned);
    const parts  = filtered.filter((r) => r.sales_status === "Part");
    const rest   = filtered.filter((r) => !r.is_pinned && r.sales_status !== "Part");
    return [...pinned, ...rest, ...parts].map((row) => ({
      ...row,
      ...(rowOverrides.get(row.sku) ?? {}),
      ...(cbmOverrides.has(row.sku) ? { cbm_per_unit: cbmOverrides.get(row.sku) } : {}),
    }));
  }, [categoryFilter, cbmOverrides, conQtyFilter, data.rows, productFilter, qtyOverrides, rowOverrides, search, showZeroSales, skuPartFilters, urgencyFilter]);

  useEffect(() => {
    onFilteredRowsChange(visibleRows);
  }, [onFilteredRowsChange, visibleRows]);

  useEffect(() => {
    const element = gridHostRef.current;
    if (!element) return;

    const updateWidth = () => setGridWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!groupVis.con || containerDetailsLoaded || containerDetailsLoading) return;
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => onLoadContainerDetails());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [containerDetailsLoaded, containerDetailsLoading, groupVis.con, onLoadContainerDetails]);

  const subColumns = useMemo(
    () => {
      const visibleColumns = CON_SUBCOLS.filter((column) =>
        columnVis[`con:${column.id}`] !== false);
      const cbmColumn = visibleColumns.find((column) => column.id === "ccbm");
      return cbmColumn
        ? [cbmColumn, ...visibleColumns.filter((column) => column.id !== "ccbm")]
        : visibleColumns;
    },
    [columnVis],
  );

  const containerColumnTotals = useMemo(() => {
    const totals = new Map<string, ContainerColumnTotals>();
    for (const container of containers) {
      const containerTotals: ContainerColumnTotals = {
        ccbm: 0,
        inb_qty: 0,
        remaining: 0,
        mistake: 0,
        oo: 0,
      };
      for (const row of visibleRows) {
        const key = `${row.sku}::${container.name}`;
        const raw = row.containers?.[container.name];
        const override = qtyOverrides.get(key);
        const derived = chainMap.get(row.sku)?.get(container.name);
        const conQty = override?.inbound_qty ?? raw?.inbound_qty ?? 0;
        containerTotals.ccbm! += (conQty / (row.case_qty || 1)) * (row.cbm_per_unit ?? 0);
        containerTotals.inb_qty! += override !== undefined ? override.inbound_qty ?? 0 : raw?.inbound_qty ?? 0;
        containerTotals.remaining! += row.remaining ?? 0;
        containerTotals.mistake! += row.mistake ?? 0;
        containerTotals.oo! += derived?.open_orders ?? raw?.open_orders ?? 0;
      }
      totals.set(container.name, containerTotals);
    }
    return totals;
  }, [chainMap, containers, qtyOverrides, visibleRows]);

  useEffect(() => {
    if (!containerDetailsLoaded) return;
    setChainReadyAfterLoad(false);
    // Seed qtyOverrides with DB values so the grid displays them immediately.
    // Only sets keys not already overridden by the user.
    setQtyOverrides((prev) => {
      const next = new Map(prev);
      for (const row of data.rows) {
        for (const [containerName, cd] of Object.entries(row.containers ?? {})) {
          if (!cd || (cd.inbound_qty ?? 0) <= 0) continue;
          const key = `${row.sku}::${containerName}`;
          if (!next.has(key)) {
            next.set(key, {
              inbound_qty: cd.inbound_qty ?? null,
              avail_qty: cd.inbound_qty ?? null,
              cbm: cd.cbm ?? null,
              item_id: cd.item_id ?? undefined,
              cbm_unit: cd.cbm_unit ?? undefined,
            });
          }
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerDetailsLoaded]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setChainMap(new Map(
        data.rows.map((row) => [row.sku, computeContainerChain(row, containers, qtyOverrides, seasonalFactors)]),
      ));
      setChainReadyAfterLoad(true);
    });
    return () => { cancelled = true; };
  }, [containers, data.rows, qtyOverrides, seasonalFactors]);

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.refreshCells({ force: true });
    api.refreshHeader();
  }, [cbmOverrides, cellColors, chainMap, columnColors, qtyOverrides, rowOverrides]);

  useEffect(() => {
    gridRef.current?.api?.refreshHeader();
  }, [gridWidth]);

  useEffect(() => {
    const handlePointerUp = () => {
      dragCellAnchorRef.current = null;
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  const updateEta = useCallback((container: ContainerMeta, eta: string) => {
    if (!eta || !container.container_id) return;
    setEtaOverrides((current) => new Map(current).set(container.container_id!, eta));
    const nextContainers = containers.map((entry) => entry.container_id === container.container_id ? { ...entry, eta } : entry);
    setChainMap(new Map(data.rows.map((row) => [row.sku, computeContainerChain(row, nextContainers, qtyOverrides, seasonalFactors)])));
    void fetch(apiPath(`/api/containers?id=${container.container_id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eta }),
    });
  }, [containers, data.rows, qtyOverrides, seasonalFactors]);

  const saveCbm = useCallback(async (row: DemandRow, nextCbm: number) => {
    if (!Number.isFinite(nextCbm) || nextCbm < 0) return false;
    if (nextCbm === row.cbm_per_unit) return true;
    const response = await fetch(apiPath(`/api/planning/products/${encodeURIComponent(row.sku)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cbm_per_unit: nextCbm }),
    });
    const json = await response.json() as {
      success: boolean;
      container_items?: Array<{
        item_id: number;
        container_name: string;
        cbm_unit: number;
        total_cbm: number;
      }>;
    };
    if (!json.success) return false;

    setCbmOverrides((current) => new Map(current).set(row.sku, nextCbm));
    if (json.container_items?.length) {
      setQtyOverrides((current) => {
        const next = new Map(current);
        for (const item of json.container_items ?? []) {
          const key = `${row.sku}::${item.container_name}`;
          const raw = row.containers?.[item.container_name];
          const previous = current.get(key);
          next.set(key, {
            inbound_qty: previous?.inbound_qty ?? raw?.inbound_qty ?? null,
            avail_qty: previous?.avail_qty ?? raw?.avail_qty ?? null,
            cbm: item.total_cbm,
            cbm_unit: item.cbm_unit,
            item_id: previous?.item_id ?? raw?.item_id ?? item.item_id,
            allocated_remaining_qty: previous?.allocated_remaining_qty ?? raw?.allocated_remaining_qty ?? null,
          });
        }
        return next;
      });
    }
    return true;
  }, []);

  const saveQty = useCallback(async (
    row: DemandRow,
    container: ContainerMeta,
    raw: ContainerRowData,
    nextQty: number,
  ) => {
    if (!Number.isFinite(nextQty) || nextQty < 0 || !container.container_id) return false;
    const key = `${row.sku}::${container.name}`;
    const previous = qtyOverrides.get(key);
    const itemId = previous !== undefined ? previous.item_id : raw.item_id ?? undefined;
    const oldQty = previous?.inbound_qty ?? raw.inbound_qty ?? 0;
    if (nextQty === oldQty || (!itemId && nextQty === 0)) return true;

    let json: { success: boolean; qty?: number; total_cbm?: number; item_id?: number; allocated_qty?: number };
    if (itemId && nextQty === 0) {
      json = await fetch(apiPath(`/api/planning/containers/items/${itemId}`), { method: "DELETE" }).then((response) => response.json());
    } else if (itemId) {
      json = await fetch(apiPath(`/api/planning/containers/items/${itemId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: nextQty }),
      }).then((response) => response.json());
    } else {
      json = await fetch(apiPath("/api/planning/containers/items"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          container_id: container.container_id,
          master_sku: row.sku,
          qty: nextQty,
          cbm_unit: previous?.cbm_unit ?? raw.cbm_unit ?? row.cbm_per_unit ?? 0,
        }),
      }).then((response) => response.json());
    }
    if (!json.success) return false;

    const nextOverrides = new Map(qtyOverrides);
    const oldAllocatedQty = previous?.allocated_remaining_qty ?? raw.allocated_remaining_qty ?? 0;
    const nextAllocatedQty = nextQty === 0 ? 0 : (json.allocated_qty ?? oldAllocatedQty);
    nextOverrides.set(key, {
      inbound_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
      avail_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
      cbm: nextQty === 0 ? null : (json.total_cbm ?? 0),
      cbm_unit: previous?.cbm_unit ?? raw.cbm_unit,
      item_id: nextQty === 0 ? undefined : (json.item_id ?? itemId),
      allocated_remaining_qty: nextAllocatedQty,
    });
    setQtyOverrides(nextOverrides);
    setChainMap((current) => new Map(current).set(row.sku, computeContainerChain(row, containers, nextOverrides, seasonalFactors)));

    if (container.status === "shipped" || container.status === "packing_received") {
      setRowOverrides((current) => {
        const next = new Map(current);
        const currentRow = current.get(row.sku) ?? {};
        const currentTotal = currentRow.total_inbound_qty ?? row.total_inbound_qty ?? 0;
        const currentList = currentRow.containers_list ?? row.containers_list ?? "";
        const entries = currentList.split(", ").filter(Boolean).filter((entry) => !entry.startsWith(`${container.name} (`));
        if (nextQty > 0) entries.push(`${container.name} (${nextQty})`);
        next.set(row.sku, {
          total_inbound_qty: Math.max(0, currentTotal - oldQty + nextQty),
          containers_list: entries.join(", ") || null,
        });
        return next;
      });
    }
    if (nextAllocatedQty !== oldAllocatedQty) {
      setRowOverrides((current) => {
        const next = new Map(current);
        const currentRow = current.get(row.sku) ?? {};
        const currentRemaining = currentRow.remaining ?? row.remaining ?? 0;
        next.set(row.sku, {
          ...currentRow,
          remaining: Math.max(0, currentRemaining - (nextAllocatedQty - oldAllocatedQty)),
        });
        return next;
      });
    }
    return true;
  }, [containers, qtyOverrides, seasonalFactors]);

  const saveTransit = useCallback(async (row: DemandRow, nextVal: number): Promise<boolean> => {
    const res = await fetch(apiPath(`/api/planning/sku/${encodeURIComponent(row.sku)}/transit-stock`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transit_stock: nextVal }),
    });
    if (!res.ok) return false;
    setRowOverrides((cur) => {
      const next = new Map(cur);
      const existing = cur.get(row.sku) ?? {};
      const newTotal = (row.west_stock || 0) + (row.east_stock || 0) + nextVal;
      next.set(row.sku, { ...existing, transit_stock: nextVal, total_stock: newTotal });
      return next;
    });
    return true;
  }, []);

  const autoFill = useCallback(async (
    container: ContainerMeta,
    containerIndex: number,
    force = false,
  ): Promise<void> => {
    if (!container.container_id) return;
    const prevContainer = containers[containerIndex - 1];
    if (!prevContainer) return;
    const nextContainer = containers[containerIndex + 1];
    const nextGapDays = nextContainer
      ? Math.round((new Date(nextContainer.eta).getTime() - new Date(container.eta).getTime()) / 86400000)
      : 0;
    // SC: gap before = days from prev container arrival to this container arrival
    const gapBeforeDays = Math.round(
      (new Date(container.eta).getTime() - new Date(prevContainer.eta).getTime()) / 86400000
    );
    const seasonFactor = seasonalFactorForEta(container.eta, seasonalFactors);

    // CBM already consumed by SKUs that already have Con Qty (skipped in force mode)
    let usedCbm = 0;
    const skuInputs: SkuOrderInput[] = visibleRows
      .filter((r) => {
        const cat = r.category_code;
        if ((cat ?? "").toLowerCase() !== categoryFilter) return false;
        if ((r.cbm_per_unit ?? 0) <= 0 || r.total_avg_curr <= 0) return false;
        const key = `${r.sku}::${container.name}`;
        const existingQty = qtyOverrides.get(key)?.inbound_qty ?? r.containers?.[container.name]?.inbound_qty ?? 0;
        if (!force && existingQty > 0) {
          usedCbm += (existingQty / (r.case_qty || 1)) * (r.cbm_per_unit ?? 0);
          return false; // skip — already has Con Qty
        }
        return true;
      })
      .map((row) => {
        const isSC = row.category_code === "SC";
        const activeGradient = isSC && gradientSC.length > 0 ? gradientSC : gradient;
        const adjDaily = row.total_avg_curr * seasonFactor;
        const tier = getTier(adjDaily, activeGradient);
        const prev = chainMap.get(row.sku)?.get(prevContainer.name);
        const prevCarryover = prev?.carryover ?? 0;
        // SC Python: pre-deduct gap sales from carryover to get actual stock at this container's arrival
        const remainingAtArrival = isSC
          ? Math.max(0, prevCarryover - adjDaily * gapBeforeDays)
          : prevCarryover;
        return {
          sku: row.sku,
          adj_daily: adjDaily,
          cbm_per_unit: (row.cbm_per_unit ?? 0) / (row.case_qty || 1),
          moq: row.moq ?? 1,
          order_multiple: row.order_multiple ?? 1,
          remaining_at_arrival: remainingAtArrival,
          backorder_at_arrival: prev?.backorder ?? 0,
          tier_bonus: tier.bonus,
          use_gap_days: !isSC,
        };
      });

    const remainingCap = force ? container.cbm_cap : Math.max(0, container.cbm_cap - usedCbm);
    const base = findOptimalBaseTarget(skuInputs, remainingCap, nextGapDays);
    const orders = generateOrders(skuInputs, base, nextGapDays);
    if (orders.length === 0) return;

    if (force) {
      // Local-only update — do not save to DB; user must click Save
      const rowMap = new Map(visibleRows.map((r) => [r.sku, r]));
      setQtyOverrides((cur) => {
        const next = new Map(cur);
        for (const order of orders) {
          const key = `${order.sku}::${container.name}`;
          const raw = rowMap.get(order.sku);
          const cbmUnit = (raw?.cbm_per_unit ?? 0) / (raw?.case_qty || 1);
          next.set(key, {
            inbound_qty: order.qty,
            avail_qty: order.qty,
            cbm: order.qty * cbmUnit,
            cbm_unit: cbmUnit,
            item_id: raw?.containers?.[container.name]?.item_id ?? undefined,
            allocated_remaining_qty: raw?.containers?.[container.name]?.allocated_remaining_qty ?? null,
          });
        }
        return next;
      });
      setDirtyContainers((s) => new Set(s).add(container.name));
      return;
    }

    const res = await fetch(apiPath(`/api/planning/containers/${container.container_id}/auto-fill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: orders.map((o) => ({ sku: o.sku, qty: o.qty })) }),
    });
    const json = await res.json() as { success: boolean; items?: Array<{ sku: string; item_id: number; qty: number; cbm_unit: number; total_cbm: number; allocated_qty: number }> };
    if (!json.success || !json.items) return;

    const rowMap = new Map(visibleRows.map((r) => [r.sku, r]));
    setQtyOverrides((cur) => {
      const next = new Map(cur);
      for (const item of json.items ?? []) {
        const key = `${item.sku}::${container.name}`;
        const raw = rowMap.get(item.sku)?.containers?.[container.name];
        next.set(key, {
          inbound_qty: item.qty,
          avail_qty: item.qty,
          cbm: item.total_cbm,
          cbm_unit: item.cbm_unit,
          item_id: item.item_id,
          allocated_remaining_qty: raw?.allocated_remaining_qty ?? null,
        });
      }
      return next;
    });
  }, [containers, chainMap, visibleRows, gradient, gradientSC, seasonalFactors]);


  const saveContainer = useCallback(async (container: ContainerMeta): Promise<void> => {
    if (!container.container_id) return;
    setSavingContainers((s) => new Set(s).add(container.name));
    const items: Array<{ sku: string; qty: number }> = [];
    for (const [key, val] of qtyOverrides.entries()) {
      if (!key.endsWith(`::${container.name}`)) continue;
      const sku = key.slice(0, -(container.name.length + 2));
      if ((val.inbound_qty ?? 0) > 0) items.push({ sku, qty: val.inbound_qty! });
    }
    if (items.length > 0) {
      await fetch(apiPath(`/api/planning/containers/${container.container_id}/auto-fill`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    }
    setSavingContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
    setDirtyContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
  }, [qtyOverrides]);

  const saveStockMode = useCallback(async (row: DemandRow): Promise<void> => {
    const next: 'onhand' | 'available' = (row.stock_mode ?? 'onhand') === 'onhand' ? 'available' : 'onhand';
    const res = await fetch(apiPath(`/api/planning/sku/${encodeURIComponent(row.sku)}/stock-mode`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_mode: next }),
    });
    if (!res.ok) return;
    setRowOverrides((cur) => {
      const map = new Map(cur);
      map.set(row.sku, { ...(cur.get(row.sku) ?? {}), stock_mode: next });
      return map;
    });
    const updatedRow = { ...row, stock_mode: next };
    setChainMap((cur) => new Map(cur).set(row.sku, computeContainerChain(updatedRow, containers, qtyOverrides, seasonalFactors)));
    gridRef.current?.api.refreshCells({ force: true });
  }, [containers, qtyOverrides, seasonalFactors]);

  const pinnedBaseColumnLayout = useMemo(() => {
    const visibleBaseColumns = ALL_COLS
      .filter((column) => column.grp === "fix" || groupVis[column.grp])
      .filter((column) => columnVis[column.id] !== false)
      .filter((column) => !compactMode || COMPACT_COLUMN_IDS.has(column.id));
    const freezeIndex = visibleBaseColumns.findIndex((column) => column.id === freezeUntil);
    if (freezeIndex < 0) return { ids: [] as string[], widths: {} as Record<string, number>, width: 0 };

    const pinnedColumns = visibleBaseColumns.slice(0, freezeIndex + 1);
    const desiredWidths = Object.fromEntries(
      pinnedColumns.map((column) => [
        column.id,
        columnWidths[column.id as keyof typeof columnWidths] ?? baseColumnWidth(column),
      ]),
    ) as Record<string, number>;
    const desiredPinnedWidth = Object.values(desiredWidths).reduce((total, width) => total + width, 0);

    return {
      ids: pinnedColumns.map((column) => column.id),
      widths: desiredWidths,
      width: desiredPinnedWidth,
    };
  }, [columnVis, columnWidths, compactMode, freezeUntil, groupVis]);

  const gridMinWidth = Math.max(
    gridWidth,
    pinnedBaseColumnLayout.width + MIN_SCROLLABLE_CENTER_WIDTH,
  );
  const columnDefs = useMemo<Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>>>(() => {
    const visibleBaseColumns = ALL_COLS
      .filter((column) => column.grp === "fix" || groupVis[column.grp])
      .filter((column) => columnVis[column.id] !== false)
      .filter((column) => !compactMode || COMPACT_COLUMN_IDS.has(column.id));
    const pinnedBaseColumnIdSet = new Set(pinnedBaseColumnLayout.ids);
    const baseGroups = new Map<string, AgColDef<DemandRow>[]>();

  visibleBaseColumns.forEach((column) => {
    const columns = baseGroups.get(column.grp) ?? [];
    const isCopyable = column.id === "sku" || column.id === "inb_lst";
    const shouldPin = pinnedBaseColumnIdSet.has(column.id);
    const width = shouldPin
      ? pinnedBaseColumnLayout.widths[column.id]
      : columnWidths[column.id as keyof typeof columnWidths] ?? baseColumnWidth(column);
    const headerName = column.id === "tavg_p"
      ? "T. Avg 이전"
      : column.id === "tavg_r"
        ? "T. Avg 실제"
        : column.id === "tavg_c"
          ? "T. Avg 현재"
          : column.label.replace("\n", " ");
    columns.push({
      colId: column.id,
      headerName,
        headerTooltip: column.label.replace("\n", " "),
        width,
        minWidth: Math.min(36, column.w),
        sortable: column.id !== "row_num",
        comparator: column.sortVal
          ? (_a, _b, nodeA, nodeB) => {
              const a = nodeA.data ? column.sortVal!(nodeA.data) : null;
              const b = nodeB.data ? column.sortVal!(nodeB.data) : null;
              if (a === b) return 0;
              if (a === null || a === undefined) return -1;
              if (b === null || b === undefined) return 1;
              if (typeof a === "number" && typeof b === "number") return a - b;
              return String(a).localeCompare(String(b));
            }
          : undefined,
      pinned: shouldPin ? "left" : undefined,
      valueGetter: (params) => {
        if (!params.data) return "";
        // For pinned rows' SKU cell, show the real SKU (base_sku) not the synthetic key.
        if (column.id === "sku" && params.data.is_pinned) {
          const realSku = params.data.base_sku ?? params.data.sku;
          return { html: `<span class="dot d-ok"></span>${realSku}` };
        }
        return column.val(params.data, params.node?.rowIndex ?? 0, urgStatus(params.data));
      },
      cellRenderer: isCopyable ? CopyableCellRenderer : column.id === "cbm" ? CbmCellRenderer : column.id === "transit" ? TransitCellRenderer : column.id === "mode" ? StockModeCellRenderer : CellRenderer,
      cellRendererParams: isCopyable
        ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
            copyValue: column.id === "sku"
              ? (params.data?.base_sku ?? params.data?.sku ?? "")
              : params.data?.containers_list ?? "",
            label: column.id === "sku" ? "Master SKU" : "Containers List",
            badge: column.id === "sku" && params.data?.is_pinned ? (params.data.pin_label ?? "Ref") : undefined,
          })
        : column.id === "cbm"
          ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
              onSave: (cbm: number) => params.data ? saveCbm(params.data, cbm) : Promise.resolve(false),
            })
        : column.id === "transit"
          ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
              onSave: (qty: number) => params.data ? saveTransit(params.data, qty) : Promise.resolve(false),
            })
        : column.id === "mode"
          ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
              onToggle: () => params.data ? saveStockMode(params.data) : Promise.resolve(),
            })
        : undefined,
      headerStyle: headerStyleForColor(columnColors[column.id]?.header),
      cellStyle: (params) => {
        const key = cellColorKey(params.data?.sku, column.id);
        const selected = selectedCellsRef.current.has(key);
        return {
          backgroundColor: selected ? "#BFD7FF" : cellColors[key] ?? columnColors[column.id]?.cell ?? TINT_COLORS[column.tint] ?? "#fff",
          fontWeight: column.bold ? 700 : 400,
          textAlign: column.align === "num" ? "right" : column.align === "ctr" ? "center" : "left",
          ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
        };
      },
      });
      baseGroups.set(column.grp, columns);
    });

    const groups: Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>> = [...baseGroups.entries()].map(([groupId, children]) => ({
      groupId,
      headerName: GROUP_LABELS[groupId] || groupId,
      children,
    }));

    if (groupVis.con) {
      for (const [containerIndex, container] of containers.entries()) {
        const baseline = container.status === "baseline";
        groups.push({
          groupId: `container-${container.name}`,
          headerName: container.name,
          headerStyle: headerStyleForColor(columnColors[`container:${container.name}`]?.header),
          headerGroupComponent: ContainerGroupHeader,
          headerGroupComponentParams: {
            eta: container.eta,
            baseline,
            totalColumns: subColumns.map((column) => ({
              id: column.id,
              width: containerColumnWidth(column),
              total: containerColumnTotals.get(container.name)?.[column.id as keyof ContainerColumnTotals],
            })),
            onEtaChange: (eta: string) => updateEta(container, eta),
            onAutoFill: () => {
              setAutoFillingContainers((s) => new Set(s).add(container.name));
              void autoFill(container, containerIndex, true).finally(() => {
                setAutoFillingContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
              });
            },
            onSave: () => {
              if (!window.confirm('변경 사항을 저장하시겠습니까?')) return;
              void saveContainer(container);
            },
            onReset: () => {
              setQtyOverrides((prev) => {
                const next = new Map(prev);
                for (const key of next.keys()) {
                  if (key.endsWith(`::${container.name}`)) next.delete(key);
                }
                return next;
              });
              setDirtyContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
            },
            autoFilling: autoFillingContainers.has(container.name),
            saving: savingContainers.has(container.name),
            dirty: dirtyContainers.has(container.name),
          },
          children: subColumns.map((column, columnIndex) => ({
            headerStyle: headerStyleForColor(columnColors[`con:${column.id}`]?.header),
            headerClass: [
              columnIndex === 0 ? "container-column-start" : "",
              columnIndex === subColumns.length - 1 ? "container-column-end" : "",
            ].filter(Boolean).join(" "),
            colId: `${container.name}::${column.id}`,
            headerName: column.id === "oo"
              ? "Open Ord"
              : column.id === "remaining"
                ? "Rem. Qty"
                : column.label.replace("\n", " "),
            headerTooltip: column.id === "inb_qty" && !baseline
              ? "Right-click to filter Qty > 0"
              : column.label.replace("\n", " "),
            headerComponent: column.id === "inb_qty" && !baseline ? ConQtyHeader : undefined,
            headerComponentParams: column.id === "inb_qty" && !baseline ? {
              isFiltered: conQtyFilter === container.name,
              onRightClick: (x: number, y: number) => setQtyCtxMenu({ x, y, containerName: container.name }),
            } : undefined,
            width: containerColumnWidth(column),
            valueGetter: (params) => {
              if (!params.data) return "";
              const key = `${params.data.sku}::${container.name}`;
              const raw = params.data.containers?.[container.name] ?? {
                item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
                allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
                inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
              };
              const value = { ...raw, ...(qtyOverrides.get(key) ?? {}), ...(chainMap.get(params.data.sku)?.get(container.name) ?? {}) };
              return column.val(value, container, params.data);
            },
            comparator: column.id === "life" || column.id === "inb_qty" || column.id === "avail" || column.id === "est" || column.id === "cbo" || column.id === "carry" || column.id === "remaining"
              ? (_a, _b, nodeA, nodeB) => {
                  const getNum = (node: typeof nodeA): number => {
                    if (!node.data) return -1;
                    const key = `${node.data.sku}::${container.name}`;
                    const raw = node.data.containers?.[container.name];
                    const chain = chainMap.get(node.data.sku)?.get(container.name);
                    const override = qtyOverrides.get(key);
                    const merged = { ...raw, ...override, ...chain };
                    if (column.id === "life") return merged.inv_life ?? -1;
                    if (column.id === "inb_qty") return override?.inbound_qty ?? raw?.inbound_qty ?? 0;
                    if (column.id === "avail") return merged.avail_qty ?? -1;
                    if (column.id === "est") return merged.est_sales ?? -1;
                    if (column.id === "cbo") return merged.backorder ?? -1;
                    if (column.id === "carry") return merged.carryover ?? -1;
                    if (column.id === "remaining") return (raw as { remaining?: number })?.remaining ?? -1;
                    return -1;
                  };
                  return getNum(nodeA) - getNum(nodeB);
                }
              : undefined,
            cellRenderer: column.id === "inb_qty" && !baseline ? QtyCellRenderer : CellRenderer,
            cellRendererParams: column.id === "inb_qty" && !baseline ? (params: ICellRendererParams<DemandRow, CellContent>) => {
              const row = params.data;
              if (!row) return { onSave: async () => false };
              const raw = row.containers?.[container.name] ?? {
                item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
                allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
                inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
              };
              return { onSave: (qty: number) => saveQty(row, container, raw, qty) };
            } : undefined,
            cellStyle: (params) => {
              const columnId = `${container.name}::${column.id}`;
              const key = cellColorKey(params.data?.sku, columnId);
              const selected = selectedCellsRef.current.has(key);
              return {
                backgroundColor: selected ? "#BFD7FF" : cellColors[key] ?? columnColors[`con:${column.id}`]?.cell ?? (baseline ? "#E2E0DC" : TINT_COLORS[column.tint] || "#fff"),
                ...(columnIndex === 0 ? { borderLeft: "2px solid #5A5750" } : {}),
                textAlign: column.align === "num" ? "right" : column.align === "ctr" ? "center" : "left",
                ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
              };
            },
          })),
        });
      }
    }
    return groups;
  }, [cellColors, chainMap, columnColors, columnVis, columnWidths, compactMode, containerColumnTotals, containers, groupVis, pinnedBaseColumnLayout, qtyOverrides, saveCbm, saveQty, subColumns, updateEta]);

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const pinnedSet = new Set(pinnedBaseColumnLayout.ids);
    api.applyColumnState({
      state: (api.getColumns() ?? []).map((column) => ({
        colId: column.getColId(),
        pinned: pinnedSet.has(column.getColId()) ? "left" : null,
      })),
      applyOrder: false,
    });
  }, [columnDefs, pinnedBaseColumnLayout]);

  const exportCurrentView = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;

    const columns = api.getAllDisplayedColumns();
    const csv = api.getDataAsCsv({
      exportedRows: "filteredAndSorted",
      valueFrom: "edit",
      processCellCallback: (params) => String(exportCellValue(params.value)),
      processGroupHeaderCallback: (params) => {
        const groupId = params.columnGroup.getGroupId();
        const container = groupId.startsWith("container-")
          ? containers.find((entry) => `container-${entry.name}` === groupId)
          : undefined;
        return container
          ? `${container.name} | ETA ${container.eta}`
          : params.columnGroup.getColGroupDef()?.headerName ?? "";
      },
    });
    if (!csv) return;

    const XLSX = await import("xlsx");
    const csvWorkbook = XLSX.read(csv, { type: "string", raw: true });
    const worksheet = csvWorkbook.Sheets[csvWorkbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
    columns.forEach((column, columnIndex) => {
      const columnId = column.getColId();
      const isContainersList = columnId === "inb_lst";
      const isDate = columnId === "next_eta"
        || columnId === "sod"
        || columnId.endsWith("::esod")
        || columnId.endsWith("::psod");
      if (!isContainersList && !isDate) return;

      for (let rowIndex = 2; rowIndex <= range.e.r; rowIndex += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        if (!cell || cell.v === null || cell.v === undefined || cell.v === "") continue;
        if (isContainersList) {
          cell.t = "s";
          cell.v = String(cell.v);
          continue;
        }

        const serial = excelDateSerial(cell.v);
        if (serial === null) continue;
        cell.t = "n";
        cell.v = serial;
        cell.z = "yyyy-mm-dd";
      }
    });
    worksheet["!cols"] = columns.map((column) => ({
      wch: Math.max(8, Math.min(24, Math.ceil((column.getActualWidth() ?? 80) / 7))),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planning");
    XLSX.writeFile(workbook, `planning_${TODAY}.xlsx`);
  }, [containers]);

  useEffect(() => {
    if (!onExportReady) return;
    onExportReady(exportCurrentView);
    return () => onExportReady(null);
  }, [exportCurrentView, onExportReady]);

  return (
    <>
    <div ref={gridHostRef} className="planning-ag-grid h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-white">
      <style>{`
        @keyframes planning-spin { to { transform: rotate(360deg); } }
        .planning-ag-grid .ag-row-selected {
          outline: 1px solid #7aa7e8;
          outline-offset: -1px;
        }
        .planning-ag-grid .ag-cell-focus:not(.ag-cell-range-selected):focus-within {
          border-color: transparent;
        }
        .planning-ag-grid .container-column-start {
          border-left: 2px solid #5A5750 !important;
        }
        .planning-ag-grid .container-column-end {
          border-right: 0 !important;
        }
        .planning-ag-grid .ag-header-group-cell[col-id^="container-"] {
          border-left: 2px solid #5A5750 !important;
          border-right: 0 !important;
        }
      `}</style>
      <div className="h-full min-h-0" style={{ minWidth: gridMinWidth }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<DemandRow>
            ref={gridRef}
            theme={planningTheme}
            loading={loading}
            rowData={visibleRows}
            columnDefs={columnDefs}
            defaultColDef={{
              autoHeaderHeight: false,
              wrapHeaderText: true,
            }}
            getRowId={(params) => params.data.sku}
            rowSelection={{
              mode: "singleRow",
              checkboxes: false,
              enableClickSelection: true,
            }}
            onCellMouseDown={(event) => {
              if (!event.data || event.rowIndex === null) return;
              dragCellAnchorRef.current = { rowIndex: event.rowIndex, columnId: event.column.getColId() };
              const cells = selectedCellsBetween(event, dragCellAnchorRef.current);
              if (!cells.length) return;
              onAgCellSelected?.({
                ...cells[0],
                cells,
              });
            }}
            onCellMouseOver={(event) => {
              const anchor = dragCellAnchorRef.current;
              if (!anchor) return;
              const cells = selectedCellsBetween(event, anchor);
              if (!cells.length) return;
              onAgCellSelected?.({ ...cells[0], cells });
            }}
            onCellClicked={(event) => {
              event.node.setSelected(true, true);
              if (!event.data) return;
              const columnId = event.column.getColId();
              const key = `${event.data.sku}::${columnId}`;
              const nativeEvt = event.event as MouseEvent | undefined;
              if (nativeEvt?.ctrlKey || nativeEvt?.metaKey) {
                if (selectedCellsRef.current.has(key)) selectedCellsRef.current.delete(key);
                else { selectedCellsRef.current.add(key); lastSelectedRef.current = key; }
              } else if (nativeEvt?.shiftKey && lastSelectedRef.current) {
                const lastSku = lastSelectedRef.current.split("::")[0];
                const skus = visibleRows.map((r) => r.sku);
                const a = skus.indexOf(lastSku), b = skus.indexOf(event.data.sku);
                const [lo, hi] = a <= b ? [a, b] : [b, a];
                for (let i = lo; i <= hi; i++) selectedCellsRef.current.add(`${skus[i]}::${columnId}`);
              } else {
                selectedCellsRef.current.clear();
                selectedCellsRef.current.add(key);
                lastSelectedRef.current = key;
              }
              gridRef.current?.api.refreshCells({ force: true });
              onCellSelectionChange?.([...selectedCellsRef.current]);
              onAgCellSelected?.({ rowId: event.data.sku, columnId, label: `${event.data.base_sku ?? event.data.sku} / ${event.column.getColDef().headerName ?? columnId}` });
            }}
            rowHeight={28}
            headerHeight={45}
            groupHeaderHeight={42}
            animateRows={false}
            singleClickEdit
            suppressCellFocus
            suppressMovableColumns
            onColumnResized={(event) => {
              if (!event.finished || !event.column) return;
              const id = event.column.getColId();
              if (!isResizableColumnId(id)) return;
              const next = { ...columnWidths, [id]: event.column.getActualWidth() };
              onColumnWidthsChange(next);
              window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(next));
            }}
            getRowStyle={(params) => {
              if (!params.data) return undefined;
              if (params.data.is_pinned) return { backgroundColor: "#FFFBEB" };
              if (urgStatus(params.data) === "crit") return { backgroundColor: "#FFF5F5" };
              return undefined;
            }}
            overlayLoadingTemplate={containerDetailsLoading ? "Loading container details..." : "Loading..."}
          />
        </AgGridProvider>
      </div>

      {/* Con. Qty right-click context menu */}
      {qtyCtxMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setQtyCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setQtyCtxMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              top: qtyCtxMenu.y,
              left: qtyCtxMenu.x,
              zIndex: 1000,
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: 6,
              boxShadow: "0 4px 16px rgba(15,23,42,.16)",
              minWidth: 180,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "6px 10px 4px", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {qtyCtxMenu.containerName}
            </div>
            {conQtyFilter === qtyCtxMenu.containerName ? (
              <button
                type="button"
                onClick={() => { setConQtyFilter(null); setQtyCtxMenu(null); }}
                style={{ display: "block", width: "100%", padding: "7px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#C42020", background: "transparent", border: "none", cursor: "pointer", borderTop: "1px solid #F1F5F9" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FFF5F5"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                ✕ 필터 해제
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setConQtyFilter(qtyCtxMenu.containerName); setQtyCtxMenu(null); }}
                style={{ display: "block", width: "100%", padding: "7px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#1A1917", background: "transparent", border: "none", cursor: "pointer", borderTop: "1px solid #F1F5F9" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#F8FAFC"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                ▼ Qty &gt; 0 만 표시
              </button>
            )}
          </div>
        </>
      )}
    </div>
    {(savingContainers.size > 0 || containerDetailsLoading || !chainReadyAfterLoad || autoFillingContainers.size > 0) && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "32px 48px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
          <div style={{ width: 36, height: 36, border: "3px solid #E2E8F0", borderTopColor: "#3B82F6", borderRadius: "50%", animation: "planning-spin 0.7s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
            {savingContainers.size > 0 ? "저장 중..." : autoFillingContainers.size > 0 ? "발주량 계산 중..." : "컨테이너 데이터 로딩 중..."}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
