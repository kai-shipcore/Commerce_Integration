"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { CalendarDays, ChartColumn, ChevronLeft, ChevronRight, ClipboardPaste, Copy, ExternalLink, Scissors, Search } from "lucide-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef as AgColDef,
  type ColGroupDef,
  type CellClickedEvent,
  type CellMouseDownEvent,
  type CellMouseOverEvent,
  type ColumnResizedEvent,
  type GridApi,
  type ICellRendererParams,
  type IHeaderGroupParams,
  type IHeaderParams,
} from "ag-grid-community";
import {
  ALL_COLS,
  DEFAULT_COLUMN_FILTER_MENU_SIZE,
  COLUMN_WIDTHS_STORAGE_KEY,
  CON_SUBCOLS,
  GROUP_LABELS,
  TINT_COLORS,
  TODAY,
  normalizeColumnFilterMenuSize,
  skuMatchesPartFilters,
  urgStatus,
} from "./columns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  inventoryLifeDays,
  sheetBaselineBackorderQty,
  sheetContainerBackorderQty,
  sheetContainerEstimatedSales,
} from "@/lib/planning/forecast-calculations";
import { addSheetDays } from "@/lib/planning/date-utils";
import { seasonalFactorForEta, type SeasonalFactors } from "@/lib/planning/seasonal-factors";
import {
  DEFAULT_SALES_WINDOW_WEIGHTS,
  labelWithSalesWindowWeight,
} from "@/lib/planning/sales-window-weights";
import {
  findOptimalBaseTarget,
  generateOrders,
  getTier,
  type SkuOrderInput,
} from "@/lib/planning/order-optimizer";
import type { CellContent, ColumnFilterMenuSize, EditMenuActions, EditMenuAvailability, TextFormatSettings } from "./columns";
import type { DemandPlanningGridProps, PlanningFormatHistoryChange } from "./demand-planning-grid";
import type { CategoryFilter, ContainerMeta, ContainerRowData, DemandRow } from "@/types/demand-planning";
import { apiPath, withBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  applyColumnFilters, distinctColumnValuesExcluding, distinctColumnColorsExcluding, CONDITION_OPERATORS,
  type ColumnFilter, type ConditionFilter, type DistinctColor, type DistinctValue,
} from "@/lib/planning/column-filter";

const modules = [AllCommunityModule];
const MIN_SCROLLABLE_CENTER_WIDTH = 240;
const DEMAND_PLANNING_MUTATION_HEADER = { "X-Planning-Permission-Context": "demand-planning" };
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
  columnBorder: { color: "#D8D6CE" },
  selectedRowBackgroundColor: "#DCEAFF",
  spacing: 4,
});

// 2px dark grey on the left edge of every container block. Kept as a named
// constant so it is visibly not the same thing as CON_QTY_RAIL below.
const CONTAINER_BLOCK_RAIL = "2px solid #5A5750";

// Con. Qty is the one container column a planner types into, and it sits in a
// block of eleven columns that all share the t-cn tint and the theme's 1px
// column border — so nothing marked out the cell you are meant to edit. It
// gets a thin blue rail on both sides, a tint a step darker than the rest of
// the block, and a bold value.
//
// Blue and 1px, deliberately unlike CONTAINER_BLOCK_RAIL: a 2px dark grey rail
// here read as another block boundary, which is the opposite of what it is for.
// The colour belongs to the same family as the editable-qty text (#1A4FC0) and
// the native grid's dashed editable affordance (#90B8E0), so it says "you can
// type in this column" rather than "a section starts here".
//
// Handled here rather than in CON_SUBCOLS because that list is shared with the
// native grid, which is deliberately unchanged.
const CON_QTY_COLUMN_ID = "inb_qty";
const CON_QTY_TINT = "#CFE8F7";
const CON_QTY_RAIL = "1px solid #5B8FC9";
const SELECTED_CELL_FILL = "#DBEAFE";

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
  columnId: string;
  width: number;
  total?: number;
};

/** A hidden run's restore arrow, anchored to a real neighboring column's
 *  header rather than a column of its own — see `HideGapRestoreMarker`. */
type HideGapRestoreInfo = { hiddenLabels: string[]; onRestore: () => void };

/** A column's single active sort: either the usual value-based A-Z/Z-A, or a
 *  Sheets-style "Sort by color" — a one-off partition (rows whose cell in
 *  this column matches `color` first, everything else after, each half
 *  keeping its prior relative order) rather than a persistent value order. */
type GridSort =
  | { key: string; kind: "value"; dir: "asc" | "desc" }
  | { key: string; kind: "color"; colorType: "fill" | "text"; color: string };

type SelectedAgCell = { rowId: string; columnId: string; label: string };
type DragCellAnchor = { rowIndex: number; columnId: string };
type EditableCellTarget =
  | { kind: "cbm"; row: DemandRow }
  | { kind: "tavg"; row: DemandRow }
  | { kind: "note"; row: DemandRow; slot: 1 | 2 | 3 }
  | { kind: "qty"; row: DemandRow; container: ContainerMeta; raw: ContainerRowData };
type SheetHistoryChange = {
  rowId: string;
  columnId: string;
  before: string;
  after: string;
};
type SheetHistoryEntry = {
  valueChanges: SheetHistoryChange[];
  formatChanges: PlanningFormatHistoryChange[];
};
type SheetClipboardFormat = { background: string | null; textColor: string | null };
type SheetClipboardPayload = { text: string; formats: Array<Array<SheetClipboardFormat | null>> };
type SelectionModifiers = { toggle: boolean; range: boolean; replace?: boolean };
type SalesTargetTier = { minSales: number; targetDays: number };
type CapacityMode = "fit" | "unlimited";
type TargetOrder = { row: DemandRow; qty: number; cbmUnit: number };
type TargetOrderPreview = {
  orders: TargetOrder[];
  skuCount: number;
  totalQty: number;
  totalCbm: number;
  capacityCbm: number;
  excessCbm: number;
};

type QtyNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter";
type QtyEditorRegistration = {
  kind: "qty" | "cbm" | "tavg" | "note";
  open: (replacementValue?: string) => void;
  close: () => void;
};
const qtyEditorRegistry = new Map<string, QtyEditorRegistration>();
let activeQtyEditorKey: string | null = null;
const MAX_SHEET_HISTORY = 100;

function qtyEditorKey(rowId: string, columnId: string) {
  return `${rowId}\u0000${columnId}`;
}

function workNoteSlotForColumnId(columnId: string): 1 | 2 | 3 | null {
  if (columnId === "workflow_note") return 1;
  if (columnId === "workflow_note_2") return 2;
  if (columnId === "workflow_note_3") return 3;
  return null;
}

const DEFAULT_BACKFILL3_TIERS: SalesTargetTier[] = [
  { minSales: 10, targetDays: 90 },
  { minSales: 5, targetDays: 80 },
  { minSales: 3, targetDays: 70 },
  { minSales: 0, targetDays: 60 },
];

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

function headerStyleForColor(backgroundColor: string | undefined, textFormat?: TextFormatSettings) {
  if (!backgroundColor && !textFormat) return undefined;
  return {
    ...(backgroundColor ? { backgroundColor, color: readableTextColor(backgroundColor) } : {}),
    ...(textFormat?.fontSize ? { fontSize: textFormat.fontSize } : {}),
    ...(textFormat?.bold !== undefined ? { fontWeight: textFormat.bold ? 700 : 400 } : {}),
    ...(textFormat?.color ? { color: textFormat.color } : {}),
  };
}

/** Every header's right-click menu identifies its column by one of these keys:
 *  a base column's own id, or `<containerName>::<subColumnId>` for a
 *  container sub-column — matching the `colId` AG Grid already uses for that
 *  cell, so it composes with `qtyOverrides`/`cellColorKey` without a second
 *  id scheme. */
type ColumnMenuKey =
  | { kind: "base"; id: string }
  | { kind: "con"; container: string; sub: string };

function parseColumnMenuKey(key: string): ColumnMenuKey {
  const sep = key.indexOf("::");
  return sep === -1
    ? { kind: "base", id: key }
    : { kind: "con", container: key.slice(0, sep), sub: key.slice(sep + 2) };
}

/** The key `columnVis` (owned by the parent dashboard) already uses to hide a
 *  column: a base column's own id, or `con:<subColumnId>` for a container
 *  sub-column. Hiding a sub-column this way hides it on every container at
 *  once — the existing convention, reused rather than replaced, since Sort
 *  and Filter are the only menu items that need a specific container. */
function hideKeyForColumnMenuKey(key: string): string {
  const parsed = parseColumnMenuKey(key);
  return parsed.kind === "base" ? parsed.id : `con:${parsed.sub}`;
}

/** Raw, comparable value for a base column: `sortVal` when the column
 *  defines one, otherwise its own display value. Every base column without a
 *  `sortVal` prints a plain string or number already (never markup) — see
 *  `columns.ts`, where the two never disagree. */
function baseColumnValue(colId: string, row: DemandRow): unknown {
  const column = ALL_COLS.find((c) => c.id === colId);
  if (!column) return null;
  if (column.sortVal) return column.sortVal(row) ?? null;
  const value = column.val(row, 0, urgStatus(row));
  return typeof value === "object" && value !== null ? null : value;
}

const MENU_ITEM_STYLE: CSSProperties = {
  display: "block", width: "100%", padding: "7px 14px", textAlign: "left",
  fontSize: 12, fontWeight: 600, color: "#1A1917", background: "transparent",
  border: "none", cursor: "pointer",
};

function GridConditionFields({
  condition, onChange,
}: { condition: ConditionFilter | null; onChange: (next: ConditionFilter | null) => void }) {
  const { pick } = useI18n();
  const meta = condition ? CONDITION_OPERATORS.find((o) => o.operator === condition.operator) : undefined;
  const selectStyle: CSSProperties = {
    width: "100%", height: 28, boxSizing: "border-box", padding: "0 6px", fontSize: 12,
    border: "1px solid #E2E8F0", borderRadius: 4, outline: "none",
    marginBottom: meta && meta.inputs > 0 ? 4 : 0,
  };
  const inputStyle: CSSProperties = {
    flex: 1, height: 26, boxSizing: "border-box", padding: "0 6px", fontSize: 12,
    border: "1px solid #E2E8F0", borderRadius: 4, outline: "none",
  };
  return (
    <div style={{ marginBottom: 6 }}>
      <select
        value={condition?.operator ?? "none"}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "none") { onChange(null); return; }
          onChange({ operator: next as ConditionFilter["operator"], value: "", value2: "" });
        }}
        style={selectStyle}
      >
        <option value="none">{pick("없음", "None")}</option>
        {CONDITION_OPERATORS.filter((o) => o.group === 1).map((o) => (
          <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
        ))}
        <optgroup label={pick("텍스트", "Text")}>
          {CONDITION_OPERATORS.filter((o) => o.group === 2).map((o) => (
            <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
          ))}
        </optgroup>
        <optgroup label={pick("숫자", "Number")}>
          {CONDITION_OPERATORS.filter((o) => o.group === 3).map((o) => (
            <option key={o.operator} value={o.operator}>{pick(o.label[0], o.label[1])}</option>
          ))}
        </optgroup>
      </select>
      {meta && meta.inputs > 0 && (
        meta.inputs === 2 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              type={meta.inputType}
              value={condition?.value ?? ""}
              onChange={(e) => onChange({ ...(condition as ConditionFilter), value: e.target.value })}
              placeholder={pick("값 또는 수식", "Value or formula")}
              style={{ ...inputStyle, flex: "none", width: "100%" }}
            />
            <span style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{pick("그리고", "and")}</span>
            <input
              type={meta.inputType}
              value={condition?.value2 ?? ""}
              onChange={(e) => onChange({ ...(condition as ConditionFilter), value2: e.target.value })}
              placeholder={pick("값 또는 수식", "Value or formula")}
              style={{ ...inputStyle, flex: "none", width: "100%" }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type={meta.inputType}
              value={condition?.value ?? ""}
              onChange={(e) => onChange({ ...(condition as ConditionFilter), value: e.target.value })}
              placeholder={pick("값", "Value")}
              style={inputStyle}
            />
          </div>
        )
      )}
    </div>
  );
}

function MenuItem({
  children, onClick, disabled, danger, trailing,
}: { children: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; trailing?: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...MENU_ITEM_STYLE,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        color: disabled ? "#B8B5AE" : danger ? "#C42020" : "#1A1917",
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "#F8FAFC"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <span>{children}</span>
      {trailing && <span style={{ color: "#94A3B8", flexShrink: 0 }}>{trailing}</span>}
    </button>
  );
}

/** The right-click column menu: Sort A→Z, Sort Z→A, Filter, Hide column.
 *  A plain positioned popup, like the single-column "Con. Qty" menu this
 *  generalizes, rather than a Radix menu — the rest of this file's floating
 *  UI (dialogs aside) already uses this pattern, and a Radix dropdown's own
 *  focus/portal handling would be one more thing to reconcile with AG Grid's
 *  own DOM. Filter has no hover flyout for the same reason: clicking it
 *  swaps the panel to a checkbox list with a back arrow instead. */
function GridGroupMenu({
  x, y, label, kind, canHide, onHide, onClose,
}: {
  x: number;
  y: number;
  label: string;
  kind: "columns" | "container";
  canHide: boolean;
  onHide: () => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999 }}
        onClick={onClose}
        onContextMenu={(event) => { event.preventDefault(); onClose(); }}
      />
      <div
        style={{
          position: "fixed", top: y, left: x, zIndex: 1000, background: "#fff",
          border: "1px solid #E2E8F0", borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
          minWidth: 200, overflow: "hidden",
        }}
      >
        <div style={{ padding: "6px 10px 4px", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #F1F5F9" }}>
          {label}
        </div>
        <MenuItem disabled={!canHide} onClick={() => { onHide(); onClose(); }}>
          {kind === "container"
            ? pick("컨테이너 숨기기", "Hide container")
            : pick("그룹 열 숨기기", "Hide group columns")}
        </MenuItem>
      </div>
    </>
  );
}

function FilterSectionFooter({
  onCancel,
  onApply,
  onResetSize,
}: {
  onCancel: () => void;
  onApply: () => void;
  onResetSize?: () => void;
}) {
  const { pick } = useI18n();
  return (
    <div style={{ display: "flex", flexShrink: 0, justifyContent: "flex-end", gap: 6, paddingTop: 6, borderTop: "1px solid #F1F5F9", marginTop: "auto" }}>
      {onResetSize && (
        <button
          type="button"
          onClick={onResetSize}
          style={{ ...MENU_ITEM_STYLE, marginRight: "auto", width: "auto", padding: "5px 10px", fontSize: 12, color: "#64748B" }}
        >
          {pick("크기 초기화", "Reset size")}
        </button>
      )}
      <button type="button" onClick={onCancel} style={{ ...MENU_ITEM_STYLE, width: "auto", padding: "5px 10px", fontSize: 12 }}>{pick("취소", "Cancel")}</button>
      <button
        type="button"
        onClick={onApply}
        style={{ ...MENU_ITEM_STYLE, width: "auto", padding: "5px 10px", fontSize: 12, fontWeight: 700, color: "#1A4FC0" }}
      >
        {pick("적용", "Apply")}
      </button>
    </div>
  );
}

const GOOGLE_PALETTE_COLOR_NAMES = (() => {
  const names = new Map<string, readonly [string, string]>();
  const grayColors = ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"];
  const grayNames: Array<readonly [string, string]> = [
    ["검정", "black"], ["어두운 회색 4", "dark gray 4"], ["어두운 회색 3", "dark gray 3"],
    ["어두운 회색 2", "dark gray 2"], ["어두운 회색 1", "dark gray 1"], ["회색", "gray"],
    ["밝은 회색 1", "light gray 1"], ["밝은 회색 2", "light gray 2"], ["밝은 회색 3", "light gray 3"], ["흰색", "white"],
  ];
  grayColors.forEach((color, index) => names.set(color, grayNames[index]));

  const families: Array<readonly [string, string]> = [
    ["적갈색", "red berry"], ["빨강", "red"], ["주황", "orange"], ["노랑", "yellow"], ["초록", "green"],
    ["청록", "cyan"], ["연한 파랑", "cornflower blue"], ["파랑", "blue"], ["보라", "purple"], ["마젠타", "magenta"],
  ];
  const baseColors = ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"];
  baseColors.forEach((color, index) => names.set(color, families[index]));
  const shadeRows: Array<readonly ["light" | "dark", number, readonly string[]]> = [
    ["light", 3, ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"]],
    ["light", 2, ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"]],
    ["light", 1, ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"]],
    ["dark", 1, ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"]],
    ["dark", 2, ["#85200C", "#990000", "#B45F06", "#BF9000", "#38761D", "#134F5C", "#1155CC", "#0B5394", "#351C75", "#741B47"]],
    ["dark", 3, ["#5B0F00", "#660000", "#783F04", "#7F6000", "#274E13", "#0C343D", "#1C4587", "#073763", "#20124D", "#4C1130"]],
  ];
  for (const [shade, level, colors] of shadeRows) {
    colors.forEach((color, index) => {
      const [koFamily, enFamily] = families[index];
      names.set(color, [
        `${shade === "light" ? "밝은" : "어두운"} ${koFamily} ${level}`,
        `${shade} ${enFamily} ${level}`,
      ]);
    });
  }
  return names;
})();

function colorDisplayName(color: string, pick: (ko: string, en: string) => string) {
  const normalized = color.trim().toUpperCase();
  const paletteName = GOOGLE_PALETTE_COLOR_NAMES.get(normalized);
  if (paletteName) return pick(...paletteName);

  const hex = normalized.match(/^#([0-9A-F]{6})$/)?.[1];
  if (!hex) return pick("사용자 지정 색상", "custom color");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.12) {
    if (lightness < 0.15) return pick("검정", "black");
    if (lightness < 0.4) return pick("어두운 회색", "dark gray");
    if (lightness > 0.9) return pick("흰색", "white");
    if (lightness > 0.7) return pick("밝은 회색", "light gray");
    return pick("회색", "gray");
  }
  const delta = max - min;
  const hue = (((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60) + 360) % 360;
  const family = hue < 15 || hue >= 345 ? ["빨강", "red"]
    : hue < 45 ? ["주황", "orange"]
      : hue < 70 ? ["노랑", "yellow"]
        : hue < 165 ? ["초록", "green"]
          : hue < 195 ? ["청록", "cyan"]
            : hue < 255 ? ["파랑", "blue"]
              : hue < 290 ? ["보라", "purple"]
                : ["마젠타", "magenta"];
  if (lightness > 0.72) return pick(`밝은 ${family[0]}`, `light ${family[1]}`);
  if (lightness < 0.35) return pick(`어두운 ${family[0]}`, `dark ${family[1]}`);
  return pick(family[0], family[1]);
}

/** Third-level palette shared by the Fill Color and Text Color menus. */
function GridColorList({
  colors, selected, onPick, openLeft,
}: {
  colors: DistinctColor[];
  selected: string | null;
  onPick: (color: string) => void;
  openLeft: boolean;
}) {
  const { pick } = useI18n();
  return (
    <div
      role="menu"
      style={{
        position: "absolute", left: openLeft ? undefined : "100%", right: openLeft ? "100%" : undefined, top: -6, zIndex: 1001,
        width: 220, padding: 6, background: "#fff", border: "1px solid #E2E8F0",
        borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
      }}
    >
      <div style={{ maxHeight: 220, overflow: "auto" }}>
        {colors.map(({ color, count }) => (
          <button
            key={color}
            type="button"
            onClick={() => onPick(color)}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
              border: "none", background: selected === color ? "#EFF6FF" : "transparent",
              cursor: "pointer", fontSize: 12, textAlign: "left",
            }}
            onMouseEnter={(e) => { if (selected !== color) (e.currentTarget as HTMLButtonElement).style.background = "#F8FAFC"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = selected === color ? "#EFF6FF" : "transparent"; }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 3, border: "1px solid rgba(0,0,0,.15)", background: color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: "#1A1917" }}>{colorDisplayName(color, pick)}</span>
            <span style={{ color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Google Sheets-style second-level color menu. Filter includes None; Sort
 *  does not. Fill/Text entries are disabled when that color type is absent. */
function GridColorTypeMenu({
  mode, fillColors, textColors, selectedType, selectedColor, onNone, onPick, openLeft,
}: {
  mode: "sort" | "filter";
  fillColors: DistinctColor[];
  textColors: DistinctColor[];
  selectedType: "fill" | "text" | null;
  selectedColor: string | null;
  onNone?: () => void;
  onPick: (type: "fill" | "text", color: string) => void;
  openLeft: boolean;
}) {
  const { pick } = useI18n();
  const [colorTypeMenu, setColorTypeMenu] = useState<"fill" | "text" | null>(null);

  const colorTypeRow = (type: "fill" | "text", label: string, colors: DistinctColor[]) => {
    const enabled = colors.length > 0;
    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setColorTypeMenu(enabled ? type : null)}
        onMouseLeave={() => setColorTypeMenu(null)}
        onFocusCapture={() => setColorTypeMenu(enabled ? type : null)}
      >
        <MenuItem disabled={!enabled} onClick={() => enabled && setColorTypeMenu(type)} trailing="▶">
          {label}
        </MenuItem>
        {colorTypeMenu === type && enabled && (
          <GridColorList
            colors={colors}
            selected={selectedType === type ? selectedColor : null}
            onPick={(color) => onPick(type, color)}
            openLeft={openLeft}
          />
        )}
      </div>
    );
  };

  return (
    <div
      role="menu"
      style={{
        position: "absolute", left: openLeft ? undefined : "100%", right: openLeft ? "100%" : undefined, top: -6, zIndex: 1001,
        width: 196, padding: 6, background: "#fff", border: "1px solid #E2E8F0",
        borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
      }}
    >
      {mode === "filter" && (
        <>
          <MenuItem onClick={onNone ?? (() => {})}>
            {selectedType === null ? "✓ " : ""}{pick("없음", "None")}
          </MenuItem>
          <div style={{ borderTop: "1px solid #F1F5F9", margin: "4px 0" }} />
        </>
      )}
      {colorTypeRow("fill", pick("채우기 색상", "Fill Color"), fillColors)}
      {colorTypeRow("text", pick("텍스트 색상", "Text Color"), textColors)}
    </div>
  );
}

/** Right-click Cut/Copy/Paste for a Con. Qty cell (or the current multi-cell
 *  selection) — the same spreadsheet-style shortcuts already on Ctrl+X/C/V,
 *  just exposed as a visible menu. Cut is disabled when nothing in the
 *  selection is actually clearable (see performCut). */
function ClipboardContextMenu({
  x, y, canCut, canPaste, onCut, onCopy, onPaste, onClose,
}: {
  x: number;
  y: number;
  canCut: boolean;
  canPaste: boolean;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999 }}
        onClick={onClose}
        onContextMenu={(event) => { event.preventDefault(); onClose(); }}
      />
      <div
        style={{
          position: "fixed", top: y, left: x, zIndex: 1000, background: "#fff",
          border: "1px solid #E2E8F0", borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
          minWidth: 180, overflow: "hidden", padding: "4px 0",
        }}
      >
        <MenuItem disabled={!canCut} onClick={() => { onCut(); onClose(); }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Scissors size={14} aria-hidden="true" />{pick("잘라내기", "Cut")}</span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>Ctrl+X</span>
          </span>
        </MenuItem>
        <MenuItem onClick={() => { onCopy(); onClose(); }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Copy size={14} aria-hidden="true" />{pick("복사", "Copy")}</span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>Ctrl+C</span>
          </span>
        </MenuItem>
        <MenuItem disabled={!canPaste} onClick={() => { onPaste(); onClose(); }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><ClipboardPaste size={14} aria-hidden="true" />{pick("붙여넣기", "Paste")}</span>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>Ctrl+V</span>
          </span>
        </MenuItem>
      </div>
    </>
  );
}

/** The right-click column menu: Hide column first for quick access, followed
 *  by sorting and filtering actions. */
function GridColumnMenu({
  x, y, label, sortDir, onSortAsc, onSortDesc, activeColorSort, onSortByColor,
  canHide, onHide, committed, getValues, getFillColors, getTextColors, onOpenColumnData, onApplyFilter, onClose,
  size, onSizeChange,
}: {
  x: number;
  y: number;
  label: string;
  sortDir: "asc" | "desc" | null;
  onSortAsc: () => void;
  onSortDesc: () => void;
  activeColorSort: { type: "fill" | "text"; color: string } | null;
  onSortByColor: (type: "fill" | "text", color: string) => void;
  canHide: boolean;
  onHide: () => void;
  committed: ColumnFilter | null;
  getValues: () => DistinctValue[];
  getFillColors: () => DistinctColor[];
  getTextColors: () => DistinctColor[];
  /** Fires when a data-dependent section/view opens (values, filter-by-color,
   *  sort-by-color), so the caller can populate the value/color lists for
   *  this specific column before either is called. */
  onOpenColumnData: () => void;
  onApplyFilter: (next: ColumnFilter | null) => void;
  onClose: () => void;
  size: ColumnFilterMenuSize;
  onSizeChange?: (next: ColumnFilterMenuSize) => void;
}) {
  const { pick } = useI18n();
  const [colorMenu, setColorMenu] = useState<"sortColor" | "filterColor" | null>(null);
  // "Filter by values" starts expanded by default — only a committed
  // condition filter overrides that to expand "Filter by condition" instead.
  const [filterSection, setFilterSection] = useState<"condition" | "values" | null>(
    committed?.mode === "condition" ? "condition" : "values",
  );
  const [condition, setCondition] = useState<ConditionFilter | null>(
    committed?.mode === "condition" ? committed.condition : null,
  );
  const values = useMemo(() => (filterSection === "values" ? getValues() : []), [filterSection, getValues]);
  const fillColors = useMemo(() => (colorMenu !== null ? getFillColors() : []), [colorMenu, getFillColors]);
  const textColors = useMemo(() => (colorMenu !== null ? getTextColors() : []), [colorMenu, getTextColors]);
  const [staged, setStaged] = useState<Set<string>>(
    () => new Set(committed?.mode === "values" ? committed.values : []),
  );
  const [search, setSearch] = useState("");
  const [menuSize, setMenuSize] = useState(() => normalizeColumnFilterMenuSize(size));
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const shown = values.filter((v) => v.label.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = menuSize;
    let latestSize = startSize;
    const onMove = (moveEvent: PointerEvent) => {
      latestSize = normalizeColumnFilterMenuSize({
        width: startSize.width + moveEvent.clientX - startX,
        height: startSize.height + moveEvent.clientY - startY,
      });
      setMenuSize(latestSize);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizeCleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      onSizeChange?.(latestSize);
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const menuLeft = typeof window === "undefined" ? x : Math.max(8, Math.min(x, window.innerWidth - menuSize.width - 8));
  const menuTop = typeof window === "undefined" ? y : Math.max(8, Math.min(y, window.innerHeight - menuSize.height - 8));
  const openColorMenusLeft = typeof window !== "undefined"
    && menuLeft + menuSize.width + 416 > window.innerWidth - 8
    && menuLeft >= 416;

  // `values` only becomes available a render after the section opens —
  // `getValues` is answered by the parent, which needs to learn which column
  // is open first. Seeded once per visit, from whatever became available,
  // rather than at the click that opened it.
  const seededValues = useRef(false);
  useEffect(() => {
    if (filterSection !== "values") { seededValues.current = false; return; }
    if (seededValues.current || values.length === 0) return;
    setStaged(new Set(committed?.mode === "values" ? committed.values : values.map((v) => v.value)));
    seededValues.current = true;
  }, [filterSection, values, committed]);

  // "Filter by values" starts expanded (see `filterSection`'s initial value
  // above), not just when explicitly clicked open — so the parent needs to
  // learn this column is open on that initial render too, not only on a
  // later click.
  useEffect(() => {
    if (filterSection === "values") onOpenColumnData();
  }, [filterSection, onOpenColumnData]);

  const toggleFilterSection = (section: "condition" | "values") => {
    setFilterSection((current) => (current === section ? null : section));
  };

  const openColorMenu = (next: "sortColor" | "filterColor") => {
    onOpenColumnData();
    setColorMenu(next);
  };

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        style={{
          position: "fixed", top: menuTop, left: menuLeft, zIndex: 1000, background: "#fff",
          border: "1px solid #E2E8F0", borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
          width: menuSize.width, height: menuSize.height, minWidth: 200, minHeight: 400, overflow: "visible",
        }}
      >
        <div style={{ padding: "6px 10px 4px", fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #F1F5F9" }}>
          {label}
        </div>
        <div style={{ boxSizing: "border-box", display: "flex", flexDirection: "column", height: "calc(100% - 28px)", minHeight: 0, overflow: "visible", padding: 6, width: "100%" }}>
            <MenuItem disabled={!canHide} onClick={() => { onHide(); onClose(); }}>
              {pick("열 숨기기", "Hide column")}
            </MenuItem>
            <div style={{ borderTop: "1px solid #F1F5F9", margin: "4px 0" }} />
            <MenuItem onClick={() => { onSortAsc(); onClose(); }}>
              {sortDir === "asc" ? "✓ " : ""}{pick("오름차순 정렬 (A→Z)", "Sort A → Z")}
            </MenuItem>
            <MenuItem onClick={() => { onSortDesc(); onClose(); }}>
              {sortDir === "desc" ? "✓ " : ""}{pick("내림차순 정렬 (Z→A)", "Sort Z → A")}
            </MenuItem>
            <div
              style={{ position: "relative" }}
              onMouseEnter={() => openColorMenu("sortColor")}
              onMouseLeave={() => setColorMenu(null)}
              onFocusCapture={() => openColorMenu("sortColor")}
            >
              <MenuItem onClick={() => openColorMenu("sortColor")} trailing="▶">
                {pick("색상별 정렬", "Sort by color")}
              </MenuItem>
              {colorMenu === "sortColor" && (
                <GridColorTypeMenu
                  mode="sort"
                  fillColors={fillColors}
                  textColors={textColors}
                  selectedType={activeColorSort?.type ?? null}
                  selectedColor={activeColorSort?.color ?? null}
                  onPick={(type, color) => { onSortByColor(type, color); onClose(); }}
                  openLeft={openColorMenusLeft}
                />
              )}
            </div>
            <div style={{ borderTop: "1px solid #F1F5F9", margin: "4px 0" }} />
            <div
              style={{ position: "relative" }}
              onMouseEnter={() => openColorMenu("filterColor")}
              onMouseLeave={() => setColorMenu(null)}
              onFocusCapture={() => openColorMenu("filterColor")}
            >
              <MenuItem onClick={() => openColorMenu("filterColor")} trailing="▶">
                {pick("색상별 필터", "Filter by color")}
              </MenuItem>
              {colorMenu === "filterColor" && (
                <GridColorTypeMenu
                  mode="filter"
                  fillColors={fillColors}
                  textColors={textColors}
                  selectedType={committed?.mode === "color" ? committed.colorType ?? "fill" : null}
                  selectedColor={committed?.mode === "color" ? [...committed.colors][0] ?? null : null}
                  onNone={() => { onApplyFilter(null); onClose(); }}
                  openLeft={openColorMenusLeft}
                  onPick={(type, color) => {
                    onApplyFilter({ mode: "color", colorType: type, colors: new Set([color]) });
                    onClose();
                  }}
                />
              )}
            </div>
            <MenuItem onClick={() => toggleFilterSection("condition")} trailing={filterSection === "condition" ? "▾" : "▸"}>
              {pick("조건별 필터", "Filter by condition")}
            </MenuItem>
            {filterSection === "condition" && (
              <div style={{ padding: "0 8px" }}>
                <GridConditionFields condition={condition} onChange={setCondition} />
              </div>
            )}
            <MenuItem onClick={() => toggleFilterSection("values")} trailing={filterSection === "values" ? "▾" : "▸"}>
              {pick("값별 필터", "Filter by values")}
            </MenuItem>
            {filterSection === "values" && (
              <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, padding: "0 8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px", fontSize: 11, color: "#64748B" }}>
                  <span>
                    <button type="button" onClick={() => setStaged(new Set(shown.map((v) => v.value)))} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", padding: 0 }}>{pick("모두 선택", "Select all")} {shown.length}</button>
                    {" - "}
                    <button type="button" onClick={() => setStaged(new Set())} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", padding: 0 }}>{pick("모두 지우기", "Clear")}</button>
                  </span>
                  <span>{pick("표시 중", "Displaying")} {shown.length}</span>
                </div>
                <div style={{ position: "relative", marginBottom: 4 }}>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={pick("값 검색…", "Search values…")}
                    style={{ width: "100%", height: 28, boxSizing: "border-box", padding: "0 28px 0 8px", fontSize: 12, border: "1px solid #E2E8F0", borderRadius: 4, outline: "none" }}
                  />
                  <Search size={13} strokeWidth={2} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
                </div>
                <div
                  style={{
                    flex: "none",
                    height: Math.max(24, 96 + menuSize.height - DEFAULT_COLUMN_FILTER_MENU_SIZE.height),
                    minHeight: 24,
                    overflowY: "auto",
                  }}
                >
                  {shown.map((v) => (
                    <label key={v.value} style={{ boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, height: 24, padding: "3px 4px", fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={staged.has(v.value)}
                        onChange={(e) => setStaged((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(v.value); else next.delete(v.value);
                          return next;
                        })}
                      />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.label || pick("(공백)", "(blank)")}</span>
                      <span style={{ color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>{v.count}</span>
                    </label>
                  ))}
                  {shown.length === 0 && (
                    <p style={{ padding: "6px 4px", fontSize: 11, color: "#94A3B8" }}>{pick("일치하는 값 없음", "No matching values")}</p>
                  )}
                </div>
              </div>
            )}
            <FilterSectionFooter
              onCancel={onClose}
              onResetSize={() => {
                const defaultSize = { ...DEFAULT_COLUMN_FILTER_MENU_SIZE };
                setMenuSize(defaultSize);
                onSizeChange?.(defaultSize);
              }}
              onApply={() => {
                if (filterSection === "condition") {
                  onApplyFilter(condition === null ? null : { mode: "condition", condition });
                } else if (filterSection === "values") {
                  onApplyFilter(staged.size === values.length ? null : { mode: "values", values: staged });
                }
                onClose();
              }}
            />
            <div
              aria-label={pick("필터 창 크기 조절", "Resize filter window")}
              title={pick("드래그하여 필터 창 크기 조절", "Drag to resize filter window")}
              onPointerDown={startResize}
              style={{
                position: "absolute", right: 1, bottom: 1, zIndex: 4,
                width: 16, height: 16, cursor: "nwse-resize", touchAction: "none",
                background: "linear-gradient(135deg, transparent 48%, #94A3B8 49%, #94A3B8 57%, transparent 58%, transparent 68%, #64748B 69%, #64748B 77%, transparent 78%)",
              }}
            />
          </div>
      </div>
    </>
  );
}

function selectedCellsBetween(
  event: CellClickedEvent<DemandRow> | CellMouseDownEvent<DemandRow> | CellMouseOverEvent<DemandRow>,
  anchor: DragCellAnchor,
): SelectedAgCell[] {
  return selectedCellsBetweenPosition(event.api, event.rowIndex, event.column.getColId(), anchor);
}

function selectedCellsBetweenPosition(
  api: GridApi<DemandRow>,
  rowIndex: number | null,
  columnId: string,
  anchor: DragCellAnchor,
): SelectedAgCell[] {
  if (rowIndex === null) return [];
  const columns = api.getAllDisplayedColumns();
  const anchorColumnIndex = columns.findIndex((column) => column.getColId() === anchor.columnId);
  const currentColumnIndex = columns.findIndex((column) => column.getColId() === columnId);
  if (anchorColumnIndex < 0 || currentColumnIndex < 0) return [];

  const startRowIndex = Math.min(anchor.rowIndex, rowIndex);
  const endRowIndex = Math.max(anchor.rowIndex, rowIndex);
  const startColumnIndex = Math.min(anchorColumnIndex, currentColumnIndex);
  const endColumnIndex = Math.max(anchorColumnIndex, currentColumnIndex);
  const selected = new Map<string, SelectedAgCell>();

  for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
    const rowNode = api.getDisplayedRowAtIndex(rowIndex);
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
        label: `${row.sku} / ${column.getColDef().headerName ?? columnId}`,
      });
    }
  }

  return Array.from(selected.values());
}

function cellColorKey(rowId: string | undefined, columnId: string) {
  return rowId ? `${rowId}::${columnId}` : "";
}

/** Outer border for a multi-cell selection. The selected fill is applied by
 *  each cellStyle so the whole range reads as one highlighted blue area. */
function selectionEdgeStyle(
  api: GridApi<DemandRow>,
  rowIndex: number | null,
  rowId: string | undefined,
  columnId: string,
  selectedKeys: Set<string>,
): CSSProperties {
  if (rowIndex === null || !rowId) return {};
  const columns = api.getAllDisplayedColumns();
  const columnIndex = columns.findIndex((column) => column.getColId() === columnId);
  const leftColumnId = columnIndex > 0 ? columns[columnIndex - 1].getColId() : null;
  const rightColumnId = columnIndex >= 0 && columnIndex < columns.length - 1 ? columns[columnIndex + 1].getColId() : null;
  const aboveRowId = api.getDisplayedRowAtIndex(rowIndex - 1)?.data?.sku;
  const belowRowId = api.getDisplayedRowAtIndex(rowIndex + 1)?.data?.sku;

  const hasAbove = Boolean(aboveRowId && selectedKeys.has(cellColorKey(aboveRowId, columnId)));
  const hasBelow = Boolean(belowRowId && selectedKeys.has(cellColorKey(belowRowId, columnId)));
  const hasLeft = Boolean(leftColumnId && selectedKeys.has(cellColorKey(rowId, leftColumnId)));
  const hasRight = Boolean(rightColumnId && selectedKeys.has(cellColorKey(rowId, rightColumnId)));

  // Real `border*` properties, not box-shadow: the grid theme's columnBorder
  // draws an opaque border-right (and a same-width, transparent border-top/
  // -bottom) directly on every `.ag-cell` via its CSS class. An inset
  // box-shadow paints underneath a border on the same element, so on the
  // right/bottom edges the theme's own border silently covered it — the
  // selection's right/bottom edge never showed, which is why a multi-column
  // drag looked like it bled into whichever column came next. An inline
  // `border` of the same property always wins over that CSS-class border.
  // No position/zIndex here: AG Grid positions every cell with an inline
  // `position: absolute; left: ...px`, and a cellStyle-returned `position`
  // value is merged onto that same inline style, clobbering "absolute" with
  // "relative". Once that happens, the cell's own `left` is reinterpreted as
  // an offset from its normal-flow position instead of an absolute
  // coordinate, and it renders shifted far to the right of where it belongs.
  // A plain `border` doesn't need a stacking-context trick to show, so this
  // was always unnecessary.
  const SELECTED_BORDER = "1px solid #2563EB";
  return {
    ...(hasAbove ? {} : { borderTop: SELECTED_BORDER }),
    ...(hasBelow ? {} : { borderBottom: SELECTED_BORDER }),
    ...(hasLeft ? {} : { borderLeft: SELECTED_BORDER }),
    ...(hasRight ? {} : { borderRight: SELECTED_BORDER }),
  };
}

function cssEscapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function containerColumnWidth(column: { id: string; w: number }) {
  if (column.id === "ccbm") return 48;
  if (column.id === "inb_qty") return 42;
  if (column.id === "remaining") return 42;
  return column.w;
}

function baseColumnWidth(column: { id: string; w: number }) {
  if (column.id === "eavg_p" || column.id === "eavg_r" || column.id === "eavg_c") return 50;
  if (column.id === "tavg_p" || column.id === "tavg_r" || column.id === "tavg_c") return 50;
  return column.w;
}

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" | "AC" | "SWC" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.includes("SWC")) return "SWC";
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

// Base categories (sc/cc/fm/ac) checked in the multi-select — SWC is excluded since
// it's a cross-cutting status filter, not a category.
function checkedBaseCategories(selected: CategoryFilter[]): ("sc" | "cc" | "fm" | "ac")[] {
  return selected.filter((c): c is "sc" | "cc" | "fm" | "ac" => c !== "swc");
}

// A row matches if it belongs to a checked base category, OR if its status matches a checked
// SWC chip (regardless of the row's own category) — the SWC chip pulls in rows from
// outside the checked categories rather than narrowing the checked categories.
function matchesCategorySelection(row: DemandRow, selected: CategoryFilter[]): boolean {
  if (checkedBaseCategories(selected).some((c) => c.toUpperCase() === categoryCodeForRow(row))) return true;
  if (selected.includes("swc") && row.sales_status === "SWC") return true;
  return false;
}

function computeContainerChain(
  row: DemandRow,
  containers: ContainerMeta[],
  overrides: Map<string, QtyOverride>,
  seasonalFactors: SeasonalFactors,
): Map<string, ChainDerived> {
  const result = new Map<string, ChainDerived>();
  const effectiveTotal = (row.west_available_stock ?? 0) + (row.east_available_stock ?? 0) + (row.transit_stock ?? 0);
  const availableQty = effectiveTotal + (row.back ?? 0);
  const dailyRate = row.total_avg_curr ?? 0;
  let previousCarryover = Math.max(0, availableQty);
  let previousBackorder = sheetBaselineBackorderQty(row.sku, availableQty, row.total_30d ?? 0);
  let previousSod = row.sod;
  let previousEta = TODAY;
  const baseline = containers[0];
  const baselineInventoryLife = inventoryLifeDays(
    previousCarryover,
    dailyRate,
    seasonalFactorForEta(baseline?.eta ?? TODAY, seasonalFactors),
  );
  const baselinePlanSod = baselineInventoryLife === null
    ? null
    : addSheetDays(baseline?.eta ?? TODAY, baselineInventoryLife);

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
    const qty = overrides.get(key)?.inbound_qty ?? raw?.inbound_qty ?? 0;
    const eta = container.eta ?? TODAY;
    const openOrders = previousCarryover > 0 ? 0 : (previousBackorder > qty ? -qty : -previousBackorder);
    const available = previousCarryover > 0 ? previousCarryover + qty : qty - previousBackorder;
    const days = Math.round((new Date(eta).getTime() - new Date(previousEta).getTime()) / 86400000);
    const seasonalFactor = seasonalFactorForEta(eta, seasonalFactors);
    const estimatedSales = sheetContainerEstimatedSales(
      row.sku, days, dailyRate, seasonalFactor, available, qty,
    );
    const backorder = sheetContainerBackorderQty(
      row.sku, row.total_30d ?? 0, estimatedSales, available,
    );
    const carryover = backorder >= 1 ? 0 : Math.max(0, available - estimatedSales);
    const inventoryLife = inventoryLifeDays(carryover, dailyRate, seasonalFactor);
    const sodFromContainer = inventoryLife !== null
      ? addSheetDays(eta, inventoryLife)
      : null;
    const estimatedSod = (!qty || carryover === 0)
      ? previousSod
      : sodFromContainer === null
        ? null
        : (previousSod && previousSod > sodFromContainer ? previousSod : sodFromContainer);

    result.set(container.name, {
      open_orders: openOrders,
      avail_qty: available,
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
    return <span className="planning-rendered-cell-value" dangerouslySetInnerHTML={{ __html: value.html }} />;
  }
  return <span className="planning-rendered-cell-value">{String(value)}</span>;
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
  skuPlanningSku,
  memo: initialMemo,
  onMemoSave,
}: ICellRendererParams<DemandRow, CellContent> & {
  copyValue: string;
  label: string;
  badge?: string;
  skuPlanningSku?: string;
  memo?: string | null;
  onMemoSave?: (memo: string) => Promise<void>;
}) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [noteDraft, setNoteDraft] = useState(initialMemo ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
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

  const handleNoteSave = async (overrideValue?: string) => {
    if (!onMemoSave) return;
    const valueToSave = overrideValue !== undefined ? overrideValue : noteDraft;
    if (overrideValue === undefined && valueToSave === (initialMemo ?? "")) return;
    setNoteSaving(true);
    setNoteError(false);
    try {
      await onMemoSave(valueToSave);
      setNoteSaved(true);
    } catch {
      setNoteSaved(false);
      setNoteError(true);
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          title={`View ${label}`}
          onClick={() => node.setSelected(true, true)}
          onContextMenu={(event) => {
            event.preventDefault();
            node.setSelected(true, true);
            setNoteDraft(initialMemo ?? "");
            setNoteSaved(false);
            setNoteError(false);
            setOpen(true);
          }}
          className="flex h-full w-full min-w-0 items-center text-left"
        >
          <span className="min-w-0 flex-1 truncate">{renderCellValue(value)}</span>
          {skuPlanningSku && initialMemo?.trim() ? (
            <span
              aria-label={pick("메모 있음", "Has note")}
              title={pick("메모 있음", "Has note")}
              className="ml-1 h-0 w-0 shrink-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-500"
            />
          ) : null}
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.03em", padding: "1px 4px", borderRadius: 3, background: "#F59E0B", color: "#fff", flexShrink: 0, marginLeft: 4 }}>
              {badge}
            </span>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={0}
        className="w-[min(720px,calc(100vw-32px))] p-0"
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <div className="flex items-center gap-2">
            {skuPlanningSku && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(
                    withBasePath(`/planning/sku-forecasts?sku=${encodeURIComponent(skuPlanningSku)}`),
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {pick("SKU Planning에서 열기", "Open in SKU Planning")}
              </Button>
            )}
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
        </div>
        <div className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-4 pb-4 text-base">
          {copyValue || "-"}
        </div>
        {onMemoSave && (
          <div className="border-t border-[#e2dfd8] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-muted-foreground">{pick("메모", "Note")}</span>
              <span className={`text-[11px] ${noteError ? "text-red-600" : noteSaved ? "text-emerald-600" : noteSaving ? "text-slate-400" : "text-muted-foreground"}`}>
                {noteSaving ? pick("저장 중...", "Saving...") : noteError ? pick("저장 실패", "Save failed") : noteSaved ? pick("저장됨", "Saved") : pick("공유 SKU 메모", "Shared SKU note")}
              </span>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => {
                setNoteDraft(event.target.value);
                setNoteSaved(false);
                setNoteError(false);
              }}
              onBlur={() => void handleNoteSave()}
              placeholder={pick("이 SKU에 대한 메모를 입력하세요", "Add a note for this SKU")}
              className="min-h-[86px] w-full resize-y rounded-md border border-[#d8d6ce] px-3 py-2 text-sm leading-5 outline-none focus:border-[#1a5cdb] focus:ring-2 focus:ring-[#1a5cdb]/15 bg-white"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={noteSaving || (!noteDraft && !initialMemo?.trim())}
                onClick={() => {
                  setNoteDraft("");
                  void handleNoteSave("");
                }}
              >
                {pick("삭제", "Clear")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={noteSaving}
                onClick={() => void handleNoteSave()}
              >
                {pick("저장", "Save")}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Master SKU cell: a plain click only selects the cell. Existing notes expose
// the editor on hover; copy, navigation, and explicit note editing remain
// available from the right-click menu.
function SkuCellRenderer({
  value,
  node,
  sku,
  memo: initialMemo,
  onMemoSave,
  onCopySelection,
}: ICellRendererParams<DemandRow, CellContent> & {
  sku: string;
  memo?: string | null;
  onMemoSave?: (memo: string) => Promise<void>;
  onCopySelection?: () => Promise<void>;
}) {
  const { pick } = useI18n();
  const [noteDraft, setNoteDraft] = useState(initialMemo ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoPreviewOpen, setMemoPreviewOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const memo = initialMemo?.trim() ?? "";
  const memoPreviewCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (memoPreviewCloseTimerRef.current !== null) {
        window.clearTimeout(memoPreviewCloseTimerRef.current);
      }
    };
  }, []);

  const cancelMemoPreviewClose = () => {
    if (memoPreviewCloseTimerRef.current !== null) {
      window.clearTimeout(memoPreviewCloseTimerRef.current);
      memoPreviewCloseTimerRef.current = null;
    }
  };

  const openMemoPreview = () => {
    if (!memo || memoOpen) return;
    cancelMemoPreviewClose();
    if (!memoPreviewOpen) {
      setNoteDraft(initialMemo ?? "");
      setNoteSaved(false);
      setNoteError(false);
      setMemoPreviewOpen(true);
    }
  };

  const scheduleMemoPreviewClose = () => {
    if (memoOpen) return;
    cancelMemoPreviewClose();
    memoPreviewCloseTimerRef.current = window.setTimeout(() => {
      setMemoPreviewOpen(false);
      memoPreviewCloseTimerRef.current = null;
    }, 160);
  };

  const handleNoteSave = async (overrideValue?: string) => {
    if (!onMemoSave) return;
    const valueToSave = overrideValue !== undefined ? overrideValue : noteDraft;
    if (overrideValue === undefined && valueToSave === (initialMemo ?? "")) return;
    setNoteSaving(true);
    setNoteError(false);
    try {
      await onMemoSave(valueToSave);
      setNoteSaved(true);
    } catch {
      setNoteSaved(false);
      setNoteError(true);
    } finally {
      setNoteSaving(false);
    }
  };

  const openMemo = () => {
    cancelMemoPreviewClose();
    setMemoPreviewOpen(false);
    setNoteDraft(initialMemo ?? "");
    setNoteSaved(false);
    setNoteError(false);
    setMemoOpen(true);
  };

  return (
    <>
      <Popover
        open={memoOpen || memoPreviewOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelMemoPreviewClose();
            setMemoOpen(false);
            setMemoPreviewOpen(false);
          }
        }}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            title="Master SKU"
            onClick={() => node.setSelected(true, true)}
            onMouseEnter={openMemoPreview}
            onMouseLeave={scheduleMemoPreviewClose}
            onContextMenu={(event) => {
              event.preventDefault();
              setMemoPreviewOpen(false);
              setCtxMenu({ x: event.clientX, y: event.clientY });
            }}
            className="flex h-full w-full min-w-0 items-center text-left"
          >
            <span className="min-w-0 flex-1 truncate">{renderCellValue(value)}</span>
            {initialMemo?.trim() ? (
              <span
                aria-label={pick("메모 있음", "Has note")}
                title={pick("메모 있음", "Has note")}
                className="ml-1 h-0 w-0 shrink-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-500"
              />
            ) : null}
          </button>
        </PopoverAnchor>
        {(memo || onMemoSave) && (
          <PopoverContent
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(event) => {
              if (!memoOpen) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onMouseEnter={cancelMemoPreviewClose}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) {
                scheduleMemoPreviewClose();
              }
            }}
            className="w-[min(420px,calc(100vw-32px))] p-4"
          >
            {onMemoSave ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#1A1917]">{pick("메모", "Note")}</span>
                  <span className={`text-[11px] font-medium ${noteError ? "text-red-600" : noteSaved ? "text-emerald-600" : noteSaving ? "text-slate-400" : "text-[#1A5CDB]"}`}>
                    {noteSaving ? pick("저장 중...", "Saving...") : noteError ? pick("저장 실패", "Save failed") : noteSaved ? pick("저장됨", "Saved") : pick("공유 SKU 메모", "Shared SKU note")}
                  </span>
                </div>
                <textarea
                  autoFocus={memoOpen}
                  value={noteDraft}
                  onChange={(event) => {
                    setNoteDraft(event.target.value);
                    setNoteSaved(false);
                    setNoteError(false);
                  }}
                  onBlur={() => void handleNoteSave()}
                  placeholder={pick("이 SKU에 대한 메모를 입력하세요", "Add a note for this SKU")}
                  className="min-h-[86px] w-full resize-y rounded-md border border-[#d8d6ce] px-3 py-2 text-sm leading-5 outline-none focus:border-[#1a5cdb] focus:ring-2 focus:ring-[#1a5cdb]/15 bg-white"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={noteSaving || (!noteDraft && !initialMemo?.trim())}
                    onClick={() => {
                      setNoteDraft("");
                      void handleNoteSave("");
                    }}
                  >
                    {pick("삭제", "Clear")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={noteSaving}
                    onClick={() => void handleNoteSave()}
                  >
                    {pick("저장", "Save")}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[#1A1917]">{pick("메모", "Note")}</span>
                  <span className="truncate text-[11px] font-medium text-[#1A5CDB]">{sku}</span>
                </div>
                <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-[#3F3D38]">
                  {memo}
                </div>
              </div>
            )}
          </PopoverContent>
        )}
      </Popover>

      {ctxMenu && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9999 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(event) => { event.preventDefault(); setCtxMenu(null); }}
          />
          <div
            style={{
              position: "fixed", top: ctxMenu.y, left: ctxMenu.x, zIndex: 10000, background: "#fff",
              border: "1px solid #E2E8F0", borderRadius: 6, boxShadow: "0 4px 16px rgba(15,23,42,.16)",
              minWidth: 200, overflow: "hidden",
            }}
          >
            <MenuItem
              disabled={!sku}
              onClick={() => {
                void (onCopySelection ? onCopySelection() : copyText(sku)).catch(() => {});
                setCtxMenu(null);
              }}
            >
              {pick("SKU 복사", "Copy SKU")}
            </MenuItem>
            <MenuItem disabled={!sku} onClick={() => {
              window.open(
                withBasePath(`/planning/sku-forecasts?sku=${encodeURIComponent(sku)}`),
                "_blank",
                "noopener,noreferrer",
              );
              setCtxMenu(null);
            }}>
              {pick("SKU Planning에서 열기", "Open in SKU Planning")}
            </MenuItem>
            {onMemoSave && (
              <MenuItem onClick={() => { setCtxMenu(null); openMemo(); }}>
                {pick("메모", "Note")}
              </MenuItem>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function QtyCellRenderer({
  value,
  node,
  api,
  column,
  onSave,
  onRequestEdit,
  onSelectCell,
  onContextMenuRequest,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (qty: number) => Promise<boolean>;
  onRequestEdit: () => boolean;
  onSelectCell: (rowIndex: number, columnId: string) => void;
  onContextMenuRequest: (rowIndex: number, columnId: string, x: number, y: number, preserveSelection: boolean) => void;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowId = node.data?.sku ?? "";
  const columnId = column?.getColId() ?? "";

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(displayValue);
  }, [displayValue, editing]);

  useEffect(() => {
    if (!rowId || !columnId) return;
    const key = qtyEditorKey(rowId, columnId);
    const beginEditing = (replacementValue?: string) => {
      if (activeQtyEditorKey !== key) qtyEditorRegistry.get(activeQtyEditorKey ?? "")?.close();
      activeQtyEditorKey = key;
      node.setSelected(true, true);
      setInputValue(replacementValue ?? displayValue);
      setEditing(true);
    };
    const closeEditing = () => {
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
      setEditing(false);
    };
    const registration: QtyEditorRegistration = { kind: "qty", open: beginEditing, close: closeEditing };
    qtyEditorRegistry.set(key, registration);
    return () => {
      if (qtyEditorRegistry.get(key) === registration) qtyEditorRegistry.delete(key);
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
    };
  }, [columnId, displayValue, node, rowId]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [editing]);

  async function commit(): Promise<boolean> {
    if (savingRef.current) return false;
    const nextQty = inputValue.trim() === "" ? 0 : Number.parseInt(inputValue, 10);
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      setInputValue(displayValue);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return false;
    }
    if (String(nextQty) === displayValue) {
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return true;
    }

    savingRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      saved = await onSave(nextQty);
      if (!saved) setInputValue(displayValue);
    } catch {
      setInputValue(displayValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
    }
    return saved;
  }

  function moveToNextQtyCell(key: QtyNavigationKey) {
    if (!column || node.rowIndex === null) return;
    const editableQtyColumns = api.getAllDisplayedColumns().filter(
      (displayedColumn) => displayedColumn.getColDef().cellRenderer === QtyCellRenderer,
    );
    const currentColumnIndex = editableQtyColumns.indexOf(column);
    if (currentColumnIndex < 0) return;

    let nextRowIndex = node.rowIndex;
    let nextColumnIndex = currentColumnIndex;
    if (key === "ArrowUp") nextRowIndex -= 1;
    if (key === "ArrowDown" || key === "Enter") nextRowIndex += 1;
    if (key === "ArrowLeft") nextColumnIndex -= 1;
    if (key === "ArrowRight") nextColumnIndex += 1;
    if (nextRowIndex < 0 || nextRowIndex >= api.getDisplayedRowCount()) return;
    if (nextColumnIndex < 0 || nextColumnIndex >= editableQtyColumns.length) return;

    const nextNode = api.getDisplayedRowAtIndex(nextRowIndex);
    const nextColumn = editableQtyColumns[nextColumnIndex];
    const nextRowId = nextNode?.data?.sku;
    if (!nextNode || !nextRowId) return;

    onSelectCell(nextRowIndex, nextColumn.getColId());
  }

  if (editing) {
    return (
      <div className="h-full w-full overflow-hidden">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Edit Con. Qty"
          value={inputValue}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setInputValue(displayValue);
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              const parsedQty = inputValue.trim() === "" ? 0 : Number.parseInt(inputValue, 10);
              if (!Number.isFinite(parsedQty) || parsedQty < 0) {
                void commit();
                return;
              }
              // Start persistence first, then move focus immediately instead
              // of making keyboard navigation wait for React/grid rendering.
              skipNextBlurCommitRef.current = true;
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              moveToNextQtyCell("Enter");
              window.setTimeout(() => void commit(), 0);
            }
          }}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            void commit();
          }}
          className="planning-inline-cell-editor h-full w-full rounded-none border-0 bg-white px-1 text-center font-mono text-[11px] font-bold text-[#1A4FC0] outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title="Double-click or press F2 to edit quantity"
      onClick={(event) => {
        if (event.detail < 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestEdit()) return;
        const registration = qtyEditorRegistry.get(qtyEditorKey(rowId, columnId));
        if (registration) registration.open();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (node.rowIndex === null) return;
        onContextMenuRequest(
          node.rowIndex,
          columnId,
          event.clientX,
          event.clientY,
          event.ctrlKey || event.metaKey || event.shiftKey,
        );
      }}
      className="h-full w-full appearance-none border-0 bg-transparent px-1 text-center font-mono text-[11px] font-bold text-[#1A4FC0] shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}


function CbmCellRenderer({
  value,
  data,
  node,
  column,
  onSave,
  onRequestEdit,
  onSelectCell,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (cbm: number) => Promise<boolean>;
  onRequestEdit: () => boolean;
  onSelectCell: (rowIndex: number, columnId: string) => void;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "" : String(value);
  const rawCbm = typeof data?.cbm_per_unit === "number" && Number.isFinite(data.cbm_per_unit)
    ? data.cbm_per_unit
    : null;
  const editValue = rawCbm === null ? displayValue : rawCbm.toFixed(6);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(editValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowId = node.data?.sku ?? "";
  const columnId = column?.getColId() ?? "";

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(editValue);
  }, [editValue, editing]);

  useEffect(() => {
    if (!rowId || !columnId) return;
    const key = qtyEditorKey(rowId, columnId);
    const open = (replacementValue?: string) => {
      if (activeQtyEditorKey !== key) qtyEditorRegistry.get(activeQtyEditorKey ?? "")?.close();
      activeQtyEditorKey = key;
      setInputValue(replacementValue ?? editValue);
      setEditing(true);
    };
    const close = () => {
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
      setEditing(false);
    };
    const registration: QtyEditorRegistration = { kind: "cbm", open, close };
    qtyEditorRegistry.set(key, registration);
    return () => {
      if (qtyEditorRegistry.get(key) === registration) qtyEditorRegistry.delete(key);
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
    };
  }, [columnId, editValue, rowId]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
    const end = inputRef.current.value.length;
    inputRef.current.setSelectionRange(end, end);
  }, [editing]);

  async function commit() {
    if (savingRef.current) return;
    const nextCbm = Number.parseFloat(inputValue);
    if (!Number.isFinite(nextCbm) || nextCbm < 0) {
      setInputValue(editValue);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return;
    }
    if (rawCbm !== null && nextCbm === rawCbm) {
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(nextCbm);
      if (!saved) setInputValue(editValue);
    } catch {
      setInputValue(editValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="h-full w-full overflow-hidden">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          inputMode="decimal"
          value={inputValue}
          aria-label="Edit CBM"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setInputValue(editValue);
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              const parsedCbm = Number.parseFloat(inputValue);
              if (!Number.isFinite(parsedCbm) || parsedCbm < 0) {
                void commit();
                return;
              }
              skipNextBlurCommitRef.current = true;
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              if (node.rowIndex !== null) onSelectCell(node.rowIndex + 1, columnId);
              window.setTimeout(() => void commit(), 0);
            }
          }}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            void commit();
          }}
          className="planning-inline-cell-editor h-full w-full rounded-none border-0 bg-white px-0.5 text-center font-mono text-[10px] text-[#1A4FC0] outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title="Double-click or press F2 to edit CBM"
      onClick={(event) => {
        if (event.detail < 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestEdit()) return;
        qtyEditorRegistry.get(qtyEditorKey(rowId, columnId))?.open();
      }}
      className="h-full w-full appearance-none border-0 bg-transparent px-0.5 text-center font-mono text-[10px] text-[#1A4FC0] shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}

function TotalAvgCurrentCellRenderer({
  value,
  data,
  node,
  column,
  onSave,
  onRequestEdit,
  onSelectCell,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (value: number | null) => Promise<boolean>;
  onRequestEdit: () => boolean;
  onSelectCell: (rowIndex: number, columnId: string) => void;
}) {
  const displayValue = value === null || value === undefined || value === "" ? "" : String(value);
  const override = data?.total_avg_curr_override ?? null;
  const autoValue = data?.total_avg_curr_auto ?? data?.total_avg_curr ?? 0;
  const editValue = override === null ? displayValue : String(override);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(editValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowId = node.data?.sku ?? "";
  const columnId = column?.getColId() ?? "";

  useEffect(() => {
    if (!editing && !savingRef.current) setInputValue(editValue);
  }, [editValue, editing]);

  useEffect(() => {
    if (!rowId || !columnId) return;
    const key = qtyEditorKey(rowId, columnId);
    const open = (replacementValue?: string) => {
      if (activeQtyEditorKey !== key) qtyEditorRegistry.get(activeQtyEditorKey ?? "")?.close();
      activeQtyEditorKey = key;
      setInputValue(replacementValue ?? editValue);
      setEditing(true);
    };
    const close = () => {
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
      setEditing(false);
    };
    const registration: QtyEditorRegistration = { kind: "tavg", open, close };
    qtyEditorRegistry.set(key, registration);
    return () => {
      if (qtyEditorRegistry.get(key) === registration) qtyEditorRegistry.delete(key);
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
    };
  }, [columnId, editValue, rowId]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [editing]);

  async function commit() {
    if (savingRef.current) return;
    const trimmed = inputValue.trim();
    const parsedValue = trimmed === "" ? null : Number(trimmed.replace(/,/g, ""));
    if (parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
      setInputValue(editValue);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return;
    }
    const nextValue = parsedValue === null ? null : Math.round(parsedValue * 10_000) / 10_000;
    if (nextValue === override || (override === null && nextValue === data?.total_avg_curr)) {
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await onSave(nextValue);
      if (!saved) setInputValue(editValue);
    } catch {
      setInputValue(editValue);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="h-full w-full overflow-hidden">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          inputMode="decimal"
          value={inputValue}
          aria-label="Edit T. Avg current"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setInputValue(editValue);
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              skipNextBlurCommitRef.current = true;
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              if (node.rowIndex !== null) onSelectCell(node.rowIndex + 1, columnId);
              window.setTimeout(() => void commit(), 0);
            }
          }}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            void commit();
          }}
          className="planning-inline-cell-editor h-full w-full rounded-none border-0 bg-transparent px-0.5 text-center font-mono text-[10px] font-bold outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      title={override === null
        ? "Double-click or press F2 to set a manual T. Avg current value"
        : `Manual value (auto: ${autoValue}). Clear the cell to restore auto.`}
      onClick={(event) => {
        if (event.detail < 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestEdit()) return;
        qtyEditorRegistry.get(qtyEditorKey(rowId, columnId))?.open();
      }}
      className="h-full w-full appearance-none border-0 bg-transparent px-0.5 text-center font-mono text-[10px] font-bold shadow-none outline-none"
    >
      {saving ? "..." : displayValue}
    </button>
  );
}

function WorkNoteCellRenderer({
  value,
  node,
  column,
  onSave,
  onRequestEdit,
  onSelectCell,
}: ICellRendererParams<DemandRow, CellContent> & {
  onSave: (note: string) => Promise<boolean>;
  onRequestEdit: () => boolean;
  onSelectCell: (rowIndex: number, columnId: string) => void;
}) {
  const displayValue = value === null || value === undefined ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayValue);
  const skipNextBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowId = node.data?.sku ?? "";
  const columnId = column?.getColId() ?? "";

  useEffect(() => {
    if (!editing) setInputValue(displayValue);
  }, [displayValue, editing]);

  useEffect(() => {
    if (!rowId || !columnId) return;
    const key = qtyEditorKey(rowId, columnId);
    const open = (replacementValue?: string) => {
      if (activeQtyEditorKey !== key) qtyEditorRegistry.get(activeQtyEditorKey ?? "")?.close();
      activeQtyEditorKey = key;
      setInputValue(replacementValue ?? displayValue);
      setEditing(true);
    };
    const close = () => {
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
      setEditing(false);
    };
    const registration: QtyEditorRegistration = { kind: "note", open, close };
    qtyEditorRegistry.set(key, registration);
    return () => {
      if (qtyEditorRegistry.get(key) === registration) qtyEditorRegistry.delete(key);
      if (activeQtyEditorKey === key) activeQtyEditorKey = null;
    };
  }, [columnId, displayValue, rowId]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
    const end = inputRef.current.value.length;
    inputRef.current.setSelectionRange(end, end);
  }, [editing]);

  function commit() {
    const nextNote = inputValue.trim().replace(/\s*[\r\n]+\s*/g, " ");
    if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
    setEditing(false);
    if (nextNote === displayValue) {
      return;
    }

    // Paint the edited value immediately. The parent persists it in the
    // background and restores the last confirmed value only if saving fails.
    setInputValue(nextNote);
    void onSave(nextNote).then((saved) => {
      if (!saved) setInputValue(displayValue);
    }).catch(() => setInputValue(displayValue));
  }

  if (editing) {
    return (
      <div className="h-full w-full overflow-hidden">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          maxLength={200}
          aria-label="Edit Note"
          value={inputValue}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setInputValue(displayValue);
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              return;
            }
            // Plain Enter saves, matching every other single-line editor in
            // this grid. Shift+Enter inserts a line break instead — left
            // alone here so the textarea's own default behavior handles it.
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              skipNextBlurCommitRef.current = true;
              if (activeQtyEditorKey === qtyEditorKey(rowId, columnId)) activeQtyEditorKey = null;
              setEditing(false);
              if (node.rowIndex !== null) onSelectCell(node.rowIndex + 1, columnId);
              window.setTimeout(commit, 0);
            }
          }}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            commit();
          }}
          // Anchored to the row's own top edge rather than vertically
          // centered: centering a box this much taller than a 28px row means
          // roughly half of it sits above the row, which — for a row near
          // the top of the grid — lands behind the sticky header, hiding
          // exactly the first lines typed. Growing only downward keeps the
          // typed text visible regardless of which row is being edited.
          className="planning-inline-cell-editor h-full w-full rounded-none border-0 bg-white px-1 text-center text-[11px] outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      title={inputValue || "Double-click or press F2 to edit Note"}
      onClick={(event) => {
        if (event.detail < 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestEdit()) return;
        qtyEditorRegistry.get(qtyEditorKey(rowId, columnId))?.open();
      }}
      className="h-full w-full appearance-none truncate border-0 bg-transparent px-1 text-center shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
      style={{ color: "inherit", fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit" }}
    >
      {inputValue}
    </button>
  );
}

type HeaderEditorAnchor = { left: number; top: number; width: number; height: number };

function WideHeaderNameEditor({
  name,
  anchor,
  onSave,
  onCancel,
}: {
  name: string;
  anchor: HeaderEditorAnchor;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const editorWidth = Math.min(
    Math.max(anchor.width, Math.min(480, Math.max(160, window.innerWidth - 16)), draft.length * 14 + 48),
    Math.min(1200, Math.max(160, window.innerWidth - 16)),
  );
  const editorLeft = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - editorWidth / 2),
    Math.max(8, window.innerWidth - editorWidth - 8),
  );
  const editorTop = Math.max(8, anchor.top + anchor.height / 2 - 21);

  return createPortal(
    <input
      ref={inputRef}
      value={draft}
      maxLength={80}
      aria-label={`Rename ${name} header`}
      title="Enter to save, Escape to cancel. Leave blank to restore the default name."
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => onSave(draft)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onSave(draft);
        if (event.key === "Escape") onCancel();
      }}
      className="fixed h-[42px] rounded-lg border-2 border-blue-500 bg-white px-4 text-left text-sm font-semibold text-slate-900 shadow-2xl outline-none ring-4 ring-blue-500/20"
      style={{ left: editorLeft, top: editorTop, width: editorWidth, zIndex: 10000 }}
    />,
    document.body,
  );
}

function EditableGroupHeader(params: IHeaderGroupParams & {
  selectionId: string;
  onRename: (columnId: string, name: string) => void;
  onRightClick?: (x: number, y: number) => void;
}) {
  const [editorAnchor, setEditorAnchor] = useState<HeaderEditorAnchor | null>(null);

  if (editorAnchor) {
    return (
      <WideHeaderNameEditor
        name={params.displayName}
        anchor={editorAnchor}
        onSave={(name) => {
          params.onRename(params.selectionId, name);
          setEditorAnchor(null);
        }}
        onCancel={() => setEditorAnchor(null)}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Rename ${params.displayName} group header`}
      title="Right-click to hide this group. Double-click to rename."
      onContextMenu={params.onRightClick ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        params.onRightClick?.(event.clientX, event.clientY);
      } : undefined}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setEditorAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "F2") return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setEditorAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }}
      style={{ alignItems: "center", cursor: "text", display: "flex", fontWeight: 700, height: "100%", justifyContent: "center", overflow: "hidden", textAlign: "center", width: "100%" }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{params.displayName}</span>
    </div>
  );
}

function SelectableHeader(params: IHeaderParams & {
  selectionId: string;
  renameId?: string;
  isSelected: () => boolean;
  subscribeSelection: (listener: () => void) => () => void;
  onSelect: (columnId: string, modifiers: SelectionModifiers) => void;
  isFullColumnSelected: () => boolean;
  onFullColumnSelect: (columnId: string, modifiers: SelectionModifiers) => void;
  onRename: (columnId: string, name: string) => void;
  isFiltered?: boolean;
  onRightClick?: (x: number, y: number) => void;
  shouldPreserveContextSelection: () => boolean;
  showMenuButton?: boolean;
  /** Set when a hidden run's restore arrow anchors to this column — see
   *  `HideGapRestoreMarker`. At most one of these two is set per column. */
  restoreMarkerLeft?: HideGapRestoreInfo;
  restoreMarkerRight?: HideGapRestoreInfo;
}) {
  const [editing, setEditing] = useState(false);
  const [editorAnchor, setEditorAnchor] = useState<HeaderEditorAnchor | null>(null);
  const [, setSelectionVersion] = useState(0);
  const subscribeSelection = params.subscribeSelection;
  useEffect(
    () => subscribeSelection(() => setSelectionVersion((version) => version + 1)),
    [subscribeSelection],
  );
  const selected = params.isSelected();
  const fullColumnSelected = params.isFullColumnSelected();

  if (editing && editorAnchor) {
    return (
      <WideHeaderNameEditor
        name={params.displayName}
        anchor={editorAnchor}
        onSave={(name) => {
          params.onRename(params.renameId ?? params.selectionId, name);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", position: "relative", width: "calc(100% + 16px)", marginLeft: -8, marginRight: -8, boxShadow: fullColumnSelected ? "inset 1px 0 #2563EB, inset -1px 0 #2563EB, inset 0 4px #60A5FA" : undefined }}>
      <button
        type="button"
        aria-label={`Select entire ${params.displayName} column`}
        aria-pressed={fullColumnSelected}
        title="Select entire column. Ctrl/Cmd + click for multiple columns; Shift + click for a range."
        onClick={(event) => {
          event.stopPropagation();
          params.onFullColumnSelect(params.selectionId, {
            toggle: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
        onContextMenu={params.onRightClick ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          const preserveSelection = event.ctrlKey || event.metaKey || event.shiftKey
            || params.shouldPreserveContextSelection();
          if (!preserveSelection) {
            params.onFullColumnSelect(params.selectionId, { toggle: false, range: false, replace: true });
          }
          params.onRightClick?.(event.clientX, event.clientY);
        } : undefined}
        style={{ background: fullColumnSelected ? "#60A5FA" : "rgba(255,255,255,.16)", border: "none", borderBottom: "1px solid rgba(127,127,127,.3)", cursor: "pointer", height: 7, left: 0, padding: 0, position: "absolute", right: 0, top: 0, zIndex: 2 }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${params.displayName} header, ${selected ? "selected" : "not selected"}`}
        title="Drag to move. Ctrl/Cmd + click for multiple headers; Shift + click for a range. Double-click to rename."
        onClick={(event) => {
          event.stopPropagation();
          params.onSelect(params.selectionId, {
            toggle: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          params.onSelect(params.selectionId, {
            toggle: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setEditorAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
          setEditing(true);
        }}
        onContextMenu={params.onRightClick ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          const preserveSelection = event.ctrlKey || event.metaKey || event.shiftKey
            || params.shouldPreserveContextSelection();
          if (!preserveSelection) {
            params.onSelect(params.selectionId, { toggle: false, range: false, replace: true });
          }
          params.onRightClick?.(event.clientX, event.clientY);
        } : undefined}
        style={{
          alignItems: "center",
          boxShadow: selected ? "inset 0 0 0 1px #60A5FA" : undefined,
          cursor: "pointer",
          display: "flex",
          flex: 1,
          gap: 3,
          height: "100%",
          justifyContent: "center",
          minWidth: 0,
          padding: "7px 3px 0",
          textAlign: "center",
          userSelect: "none",
          whiteSpace: "normal",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden" }}>{params.displayName}</span>
        {params.showMenuButton ? (
          <button
            type="button"
            aria-label={`Open ${params.displayName} column menu`}
            title="Filter / Sort"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              params.onRightClick?.(rect.left, rect.bottom + 2);
            }}
            style={{ flexShrink: 0, width: 16, height: 18, padding: 0, border: "none", borderRadius: 3, background: params.isFiltered ? "rgba(96,165,250,.25)" : "rgba(255,255,255,.12)", color: params.isFiltered ? "#60A5FA" : "rgba(255,255,255,.8)", cursor: "pointer", fontSize: 9, lineHeight: "18px" }}
          >
            ▼
          </button>
        ) : params.isFiltered ? (
          <span aria-hidden="true" style={{ color: "#60A5FA", fontSize: 9, lineHeight: 1 }}>▼</span>
        ) : null}
      </div>
      {params.restoreMarkerLeft && <HideGapRestoreMarker side="left" info={params.restoreMarkerLeft} />}
      {params.restoreMarkerRight && <HideGapRestoreMarker side="right" info={params.restoreMarkerRight} />}
    </div>
  );
}

/** A hidden run's restore arrow — Google Sheets' own hidden-column sliver,
 *  but anchored to a real neighboring column's header instead of reserving a
 *  column of its own (an earlier version did that; hiding a column still
 *  showed a visible gap, just a narrower one — not what Sheets does). Clicking
 *  it restores every column in the run at once. At rest it's just a thin line
 *  hanging off the anchor column's edge; on hover it pops into a wider pill
 *  that overlaps both neighbors, via `position: absolute` escaping past the
 *  anchor cell's own `overflow: hidden` (enabled by the `planning-hidegap-header`
 *  CSS override applied to that cell only). The pill stays a DOM descendant
 *  of the hover-tracked wrapper even though it paints over the neighboring
 *  cell, so moving the pointer onto the pill doesn't fire `onMouseLeave`. */
function HideGapRestoreMarker({ side, info }: { side: "left" | "right"; info: HideGapRestoreInfo }) {
  const { pick } = useI18n();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute", top: 0, bottom: 0, width: 22, zIndex: 3,
        display: "flex", alignItems: "center", justifyContent: "center",
        [side]: -18,
      }}
    >
      {!hovered && (
        <div style={{ width: 2, height: 18, background: "rgba(255,255,255,.35)", borderRadius: 1 }} />
      )}
      {hovered && (
        <button
          type="button"
          title={pick(`숨김: ${info.hiddenLabels.join(", ")}`, `Hidden: ${info.hiddenLabels.join(", ")}`)}
          aria-label={pick("숨긴 열 다시 보기", "Restore hidden columns")}
          onClick={(event) => { event.stopPropagation(); info.onRestore(); }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
            width: 28, height: 20, padding: 0, border: "1px solid rgba(255,255,255,.35)", borderRadius: 4,
            cursor: "pointer", background: "#3A3733", boxShadow: "0 2px 6px rgba(0,0,0,.35)",
          }}
        >
          <ChevronLeft size={10} strokeWidth={3} style={{ color: "rgba(255,255,255,.85)" }} />
          <ChevronRight size={10} strokeWidth={3} style={{ color: "rgba(255,255,255,.85)" }} />
        </button>
      )}
    </div>
  );
}

function targetDaysForAverage(avgSales: number, tiers: SalesTargetTier[]): number {
  const sorted = [...tiers]
    .filter((tier) => Number.isFinite(tier.minSales) && Number.isFinite(tier.targetDays) && tier.targetDays > 0)
    .sort((a, b) => b.minSales - a.minSales);
  return sorted.find((tier) => avgSales >= tier.minSales)?.targetDays ?? 0;
}

function formatSalesThreshold(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function salesRangeLabel(
  minSales: number,
  upperSales: number | null,
  pick: (ko: string, en: string) => string,
): string {
  if (minSales <= 0 && upperSales != null) {
    return pick(`${formatSalesThreshold(upperSales)} 미만`, `Under ${formatSalesThreshold(upperSales)}`);
  }
  if (upperSales == null) {
    return pick(`${formatSalesThreshold(minSales)} 이상`, `${formatSalesThreshold(minSales)} or more`);
  }
  return pick(
    `${formatSalesThreshold(minSales)} 이상 ~ ${formatSalesThreshold(upperSales)} 미만`,
    `${formatSalesThreshold(minSales)} to under ${formatSalesThreshold(upperSales)}`,
  );
}

function validateSalesTargetTiers(
  tiers: SalesTargetTier[],
  pick: (ko: string, en: string) => string,
): string | null {
  const normalized = tiers
    .map((tier) => ({
      minSales: Number(tier.minSales),
      targetDays: Number(tier.targetDays),
    }))
    .sort((a, b) => b.minSales - a.minSales);

  if (normalized.length === 0) return pick("최소 1개 이상의 구간이 필요합니다.", "At least one sales range is required.");

  for (const tier of normalized) {
    if (!Number.isFinite(tier.minSales) || tier.minSales < 0) {
      return pick("최소 판매량은 0 이상의 숫자로 입력해주세요.", "Minimum sales must be a number greater than or equal to 0.");
    }

    if (!Number.isFinite(tier.targetDays) || tier.targetDays < 1 || tier.targetDays > 365) {
      return pick("목표일수는 1일부터 365일 사이로 입력해주세요.", "Target days must be between 1 and 365.");
    }
  }

  const minSalesValues = new Set(normalized.map((tier) => tier.minSales));
  if (minSalesValues.size !== normalized.length) {
    return pick(
      "같은 최소 판매량이 중복되어 있습니다. 각 구간의 시작값을 다르게 입력해주세요.",
      "Minimum sales values must be unique for each range.",
    );
  }

  const lowestTier = normalized[normalized.length - 1];
  if (lowestTier.minSales !== 0) {
    return pick(
      "가장 낮은 판매 구간을 계산할 수 있도록 최소 판매량 0 구간을 추가해주세요.",
      "Add a range with minimum sales set to 0 to cover the lowest sales range.",
    );
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const higherSalesTier = normalized[index - 1];
    const lowerSalesTier = normalized[index];

    if (lowerSalesTier.targetDays > higherSalesTier.targetDays) {
      return (
        pick(
          `${salesRangeLabel(lowerSalesTier.minSales, higherSalesTier.minSales, pick)} 구간의 목표일수가 ` +
            `${salesRangeLabel(higherSalesTier.minSales, null, pick)} 구간보다 큽니다. ` +
            "판매량이 낮은 구간의 목표일수는 위 구간보다 작거나 같아야 합니다.",
          `Target days for ${salesRangeLabel(lowerSalesTier.minSales, higherSalesTier.minSales, pick)} exceed ` +
            `the ${salesRangeLabel(higherSalesTier.minSales, null, pick)} range. ` +
            "A lower sales range must have target days less than or equal to the range above it.",
        )
      );
    }
  }

  return null;
}

function CapacityModePanel({
  mode,
  onChange,
  preview,
}: {
  mode: CapacityMode;
  onChange: (mode: CapacityMode) => void;
  preview: TargetOrderPreview;
}) {
  const { pick } = useI18n();
  const overCapacity = preview.excessCbm > 0.000001;

  return (
    <div className="space-y-3 rounded-lg border border-[#D8D6CE] bg-[#FAFAF7] p-3">
      <div className="text-xs font-bold text-[#2A2825]">{pick("컨테이너 CBM 적용 방식", "Container CBM option")}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`flex cursor-pointer gap-2 rounded-md border p-2.5 text-xs ${mode === "fit" ? "border-blue-500 bg-blue-50" : "border-[#D8D6CE] bg-white"}`}>
          <input type="radio" name="capacity-mode" checked={mode === "fit"} onChange={() => onChange("fit")} />
          <span>
            <strong className="block text-[#1A1917]">{pick("컨테이너 CBM 용량에 맞춤", "Fit to container CBM capacity")}</strong>
            <span className="mt-0.5 block text-[#7A766F]">{pick("용량이 부족하면 수량을 줄이거나 해당 SKU를 제외합니다.", "If capacity is insufficient, quantities are reduced or the SKU is excluded.")}</span>
          </span>
        </label>
        <label className={`flex cursor-pointer gap-2 rounded-md border p-2.5 text-xs ${mode === "unlimited" ? "border-amber-500 bg-amber-50" : "border-[#D8D6CE] bg-white"}`}>
          <input type="radio" name="capacity-mode" checked={mode === "unlimited"} onChange={() => onChange("unlimited")} />
          <span>
            <strong className="block text-[#1A1917]">{pick("전체 필요수량 계산", "Calculate full required quantity")}</strong>
            <span className="mt-0.5 block text-[#7A766F]">{pick("CBM 제한 없이 계산된 모든 SKU의 수량을 채웁니다.", "Fills the calculated quantities for all SKUs without a CBM limit.")}</span>
          </span>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricPreview label={pick("계산 SKU", "SKUs calculated")} value={preview.skuCount.toLocaleString()} />
        <MetricPreview label={pick("총 수량", "Total quantity")} value={preview.totalQty.toLocaleString()} />
        <MetricPreview label={pick("예상 CBM", "Estimated CBM")} value={`${preview.totalCbm.toFixed(2)} / ${preview.capacityCbm.toFixed(2)}`} />
        <MetricPreview
          label={pick("초과 CBM", "Excess CBM")}
          value={overCapacity ? `+${preview.excessCbm.toFixed(2)}` : "0.00"}
          warning={overCapacity}
        />
      </div>
      {overCapacity ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {pick(
            `컨테이너 용량을 ${preview.excessCbm.toFixed(2)} CBM 초과합니다.`,
            `Exceeds container capacity by ${preview.excessCbm.toFixed(2)} CBM.`,
          )}
        </div>
      ) : null}
    </div>
  );
}

function MetricPreview({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="rounded-md border border-[#E2DFD8] bg-white px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7A766F]">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold ${warning ? "text-amber-700" : "text-[#1A1917]"}`}>{value}</div>
    </div>
  );
}

function FixedTargetDialog({
  open,
  containerName,
  targetDays,
  capacityMode,
  preview,
  onCapacityModeChange,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  containerName: string;
  targetDays: number;
  capacityMode: CapacityMode;
  preview: TargetOrderPreview;
  onCapacityModeChange: (mode: CapacityMode) => void;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const { pick } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>{pick("고정 목표 자동 발주 계산", "Fixed-target automatic order calculation")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-xs text-[#7A766F]">
            {containerName ? `${containerName} - ` : ""}
            {pick(
              `${targetDays}일 고정 목표 재고일수를 기준으로 Con. Qty를 계산합니다.`,
              `Calculates Con. Qty using a fixed inventory target of ${targetDays} days.`,
            )}
          </div>
          <CapacityModePanel mode={capacityMode} onChange={onCapacityModeChange} preview={preview} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{pick("취소", "Cancel")}</Button>
          <Button onClick={onApply}>{pick("적용", "Apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Backfill3Dialog({
  open,
  containerName,
  tiers,
  onTierChange,
  onAddTier,
  onRemoveTier,
  capacityMode,
  preview,
  onCapacityModeChange,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  containerName: string;
  tiers: SalesTargetTier[];
  onTierChange: (index: number, patch: Partial<SalesTargetTier>) => void;
  onAddTier: () => void;
  onRemoveTier: (index: number) => void;
  capacityMode: CapacityMode;
  preview: TargetOrderPreview;
  onCapacityModeChange: (mode: CapacityMode) => void;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const { pick } = useI18n();
  const [validationMessage, setValidationMessage] = useState("");
  const sortedTiers = tiers
    .map((tier, originalIndex) => ({ ...tier, originalIndex }))
    .sort((a, b) => b.minSales - a.minSales);

  function handleApply() {
    const error = validateSalesTargetTiers(tiers, pick);
    if (error) {
      setValidationMessage(error);
      return;
    }

    setValidationMessage("");
    onApply();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setValidationMessage("");
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>{pick("자동 발주 목표일수", "Automatic order target days")}</DialogTitle>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
          <div style={{ fontSize: 12, color: "#7A766F" }}>
            {containerName ? `${containerName} - ` : ""}
            {pick("일평균 판매량 구간별 목표 재고일수를 설정합니다.", "Set target inventory days by average daily sales range.")}
          </div>
          <CapacityModePanel mode={capacityMode} onChange={onCapacityModeChange} preview={preview} />
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 96px 112px 32px", gap: 8, fontSize: 12, fontWeight: 700, color: "#5A5750" }}>
            <span>{pick("판매량 구간", "Sales range")}</span>
            <span>{pick("최소 판매량", "Minimum sales")}</span>
            <span>{pick("목표일수", "Target days")}</span>
            <span />
          </div>
          {sortedTiers.map((tier, index) => {
            const upperSales = index === 0 ? null : sortedTiers[index - 1].minSales;
            const rangeLabel = salesRangeLabel(tier.minSales, upperSales, pick);

            return (
            <div key={tier.originalIndex} style={{ display: "grid", gridTemplateColumns: "1.3fr 96px 112px 32px", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  minHeight: 32,
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid #E6E2D9",
                  borderRadius: 4,
                  background: "#FAFAF7",
                  padding: "4px 10px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#2A2825",
                }}
              >
                {rangeLabel}
              </div>
              <input
                type="number"
                min={0}
                step={0.1}
                value={tier.minSales}
                onChange={(event) => {
                  setValidationMessage("");
                  onTierChange(tier.originalIndex, { minSales: Math.max(0, Number(event.target.value) || 0) });
                }}
                style={{ height: 32, border: "1px solid #D8D6CE", borderRadius: 4, padding: "4px 8px", fontSize: 13 }}
              />
              <input
                type="number"
                min={1}
                max={365}
                value={tier.targetDays}
                onChange={(event) => {
                  setValidationMessage("");
                  onTierChange(tier.originalIndex, { targetDays: Math.max(1, Number(event.target.value) || 1) });
                }}
                style={{ height: 32, border: "1px solid #D8D6CE", borderRadius: 4, padding: "4px 8px", fontSize: 13 }}
              />
              <button
                type="button"
                onClick={() => {
                  setValidationMessage("");
                  onRemoveTier(tier.originalIndex);
                }}
                disabled={tiers.length <= 1}
                title={pick("구간 삭제", "Remove range")}
                style={{
                  height: 32,
                  border: "1px solid #D8D6CE",
                  borderRadius: 4,
                  background: tiers.length <= 1 ? "#F5F4EF" : "#fff",
                  color: tiers.length <= 1 ? "#A8A49E" : "#C42020",
                  cursor: tiers.length <= 1 ? "default" : "pointer",
                  fontSize: 16,
                  lineHeight: "16px",
                }}
              >
                ×
              </button>
            </div>
            );
          })}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setValidationMessage("");
                onAddTier();
              }}
            >
              {pick("구간 추가", "Add range")}
            </Button>
          </div>
          {validationMessage ? (
            <div
              role="alert"
              style={{
                border: "1px solid #F0B8B8",
                borderRadius: 6,
                background: "#FFF5F5",
                color: "#A31B1B",
                padding: "8px 10px",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {validationMessage}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: "#7A766F" }}>
            {pick(
              "최소 판매량이 높은 구간부터 적용됩니다. 가장 낮은 구간은 최소 판매량을 0으로 두면 됩니다.",
              "Ranges are applied from the highest minimum sales value. Set minimum sales to 0 for the lowest range.",
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {pick("취소", "Cancel")}
          </Button>
          <Button onClick={handleApply}>
            {pick("적용", "Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EtaPickerAnchor = { left: number; top: number; width: number; height: number };

function EtaDatePickerPortal({
  label,
  value,
  anchor,
  onChange,
  onClose,
}: {
  label: string;
  value: string;
  anchor: EtaPickerAnchor;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      try {
        input.showPicker();
      } catch {
        // The input remains focused and editable when a browser blocks showPicker().
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998]"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <input
        ref={inputRef}
        type="date"
        aria-label={label}
        defaultValue={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          event.stopPropagation();
        }}
        style={{
          position: "fixed",
          left: anchor.left,
          top: anchor.top,
          width: anchor.width,
          height: anchor.height,
          zIndex: 9999,
          colorScheme: "dark",
        }}
        className="rounded border border-white/30 bg-[#4b2728] px-2 text-[11px] font-semibold text-white outline-none ring-2 ring-blue-400"
      />
    </>,
    document.body,
  );
}

function ContainerGroupHeader(
  props: IHeaderGroupParams & {
    eta: string;
    baseline: boolean;
    editable: boolean;
    qtyEditable: boolean;
    status?: string;
    totalColumns: ContainerTotalColumn[];
    onEtaEditRequest: (anchor: EtaPickerAnchor) => void;
    onAutoFill?: () => void;
    onAutoFill2?: (days: number) => void;
    onAutoFill3?: () => void;
    onSave?: () => void;
    onReset?: () => void;
    onOpenInContainerPlanning?: () => void;
    autoFilling?: boolean;
    autoFilling2?: boolean;
    autoFilling3?: boolean;
    saving?: boolean;
    dirty?: boolean;
    selectionId: string;
    isSelected: () => boolean;
    subscribeSelection: (listener: () => void) => () => void;
    onSelect: (columnId: string, modifiers: SelectionModifiers) => void;
    onRename: (columnId: string, name: string) => void;
    onRightClick?: (x: number, y: number) => void;
    shouldPreserveContextSelection: () => boolean;
  },
) {
  const [targetDays, setTargetDays] = useState(90);
  const [nameEditorAnchor, setNameEditorAnchor] = useState<HeaderEditorAnchor | null>(null);
  const [liveColumnWidths, setLiveColumnWidths] = useState<Record<string, number>>({});
  const [liveColumnOrder, setLiveColumnOrder] = useState<string[]>(() => props.totalColumns.map((column) => column.columnId));
  const [, setSelectionVersion] = useState(0);
  const subscribeSelection = props.subscribeSelection;
  useEffect(
    () => subscribeSelection(() => setSelectionVersion((version) => version + 1)),
    [subscribeSelection],
  );
  const selected = props.isSelected();

  // AG Grid keeps its normal header, pinned row and body cells aligned while
  // the resize handle is moving. The totals strip is custom React content,
  // however, so prop-based widths only refresh after the saved settings make
  // a round trip through the dashboard. Read the displayed AG columns instead
  // so the custom strip follows the exact same live width during the drag.
  useEffect(() => {
    const columnIds = new Set(props.totalColumns.map((column) => column.columnId));
    const syncLayout = () => {
      const next: Record<string, number> = {};
      for (const column of props.totalColumns) {
        next[column.columnId] = props.api.getColumn(column.columnId)?.getActualWidth() ?? column.width;
      }
      setLiveColumnWidths((current) => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key])) {
          return current;
        }
        return next;
      });
      const displayedOrder = props.api.getAllDisplayedColumns()
        .map((column) => column.getColId())
        .filter((columnId) => columnIds.has(columnId));
      const displayedSet = new Set(displayedOrder);
      const nextOrder = [
        ...displayedOrder,
        ...props.totalColumns.map((column) => column.columnId).filter((columnId) => !displayedSet.has(columnId)),
      ];
      setLiveColumnOrder((current) => (
        current.length === nextOrder.length && current.every((columnId, index) => columnId === nextOrder[index])
          ? current
          : nextOrder
      ));
    };
    const handleColumnResized = (event: ColumnResizedEvent<DemandRow>) => {
      if (event.column && !columnIds.has(event.column.getColId())) return;
      syncLayout();
    };

    syncLayout();
    props.api.addEventListener("columnResized", handleColumnResized);
    props.api.addEventListener("columnMoved", syncLayout);
    props.api.addEventListener("displayedColumnsChanged", syncLayout);
    return () => {
      props.api.removeEventListener("columnResized", handleColumnResized);
      props.api.removeEventListener("columnMoved", syncLayout);
      props.api.removeEventListener("displayedColumnsChanged", syncLayout);
    };
  }, [props.api, props.totalColumns]);
  const orderedTotalColumns = useMemo(() => {
    const byId = new Map(props.totalColumns.map((column) => [column.columnId, column]));
    const liveSet = new Set(liveColumnOrder);
    return [...liveColumnOrder, ...props.totalColumns.map((column) => column.columnId).filter((columnId) => !liveSet.has(columnId))]
      .map((columnId) => byId.get(columnId))
      .filter((column): column is ContainerTotalColumn => Boolean(column));
  }, [liveColumnOrder, props.totalColumns]);
  const statusBg =
    props.status === "shipped"
      ? "border-t-[3px] border-blue-400 bg-blue-500/20"
      : props.status === "packing_received"
        ? "border-t-[3px] border-amber-400 bg-amber-500/20"
        : props.status === "draft"
          ? "border-t-[3px] border-red-400 bg-red-500/20"
          : "";
  const statusLabel =
    props.status === "shipped"          ? "Shipped" :
    props.status === "packing_received" ? "Final" :
    props.status === "draft"            ? "Draft" : null;
  const statusColor =
    props.status === "shipped"          ? "text-blue-300" :
    props.status === "packing_received" ? "text-amber-300" :
    props.status === "draft"            ? "text-red-300" : "";

  if (nameEditorAnchor) {
    return (
      <WideHeaderNameEditor
        name={props.displayName}
        anchor={nameEditorAnchor}
        onSave={(name) => {
          props.onRename(props.selectionId, name);
          setNameEditorAnchor(null);
        }}
        onCancel={() => setNameEditorAnchor(null)}
      />
    );
  }

  return (
    <div
      className={`flex w-full flex-col overflow-hidden whitespace-nowrap text-[11px] ${statusBg}`}
      style={{
        boxShadow: selected ? "inset 0 0 0 1px #60A5FA" : undefined,
        height: "100%",
        marginLeft: -8,
        marginRight: -8,
        width: "calc(100% + 16px)",
      }}
      onContextMenu={props.onRightClick ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        const preserveSelection = event.ctrlKey || event.metaKey || event.shiftKey
          || props.shouldPreserveContextSelection();
        if (!preserveSelection) {
          props.onSelect(props.selectionId, { toggle: false, range: false, replace: true });
        }
        props.onRightClick?.(event.clientX, event.clientY);
      } : undefined}
    >
      <div
        className="flex min-h-[26px] flex-none items-center justify-center gap-1 overflow-hidden px-1"
        onClick={(event) => {
          props.onSelect(props.selectionId, {
            toggle: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
      >
        <span
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          className="max-w-full truncate font-bold"
          title="Drag to move this container and all of its columns. Double-click to rename."
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(props.selectionId, {
              toggle: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            props.onSelect(props.selectionId, {
              toggle: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setNameEditorAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
          }}
          style={{ cursor: "grab" }}
        >
          {selected ? "✓ " : ""}
          {props.displayName}
        </span>
        {props.onOpenInContainerPlanning && !props.baseline && (
          <button
            type="button"
            aria-label={`Open ${props.displayName} details`}
            title="Open container details"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenInContainerPlanning?.();
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-0 bg-white/10 p-0 text-white/75 hover:bg-white/20 hover:text-white"
          >
            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        )}
        {statusLabel && (
          <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
            {statusLabel}
          </span>
        )}
        {props.baseline ? null : (
          <>
            <span>| ETA</span>
            <label className="flex items-center gap-1">
              <input
                type="date"
                value={props.eta}
                disabled={!props.editable}
                readOnly
                onPointerDown={(event) => {
                  if (!props.editable) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  props.onEtaEditRequest({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
                }}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (!props.editable || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  props.onEtaEditRequest({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
                }}
                onKeyUp={(event) => event.stopPropagation()}
                style={{ colorScheme: "dark" }}
                className="h-[24px] w-[108px] rounded border border-white/30 bg-transparent px-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <input
              type="number"
              value={targetDays}
              disabled={!props.qtyEditable}
              onChange={(e) => setTargetDays(Math.max(1, Number(e.target.value)))}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              min={1}
              max={365}
              title="목표 INV Life (일)"
              style={{ colorScheme: "dark" }}
              className="w-[52px] rounded border border-blue-400/50 bg-blue-900/30 px-1.5 py-1 text-[11px] font-bold text-white text-center"
            />
            <button
              onClick={(event) => {
                event.stopPropagation();
                props.onAutoFill2?.(targetDays);
              }}
              disabled={!props.qtyEditable || props.autoFilling2}
              title={`Con qty 고정 목표 계산 (${targetDays}일 INV Life)`}
              aria-label={`Calculate automatic order for a fixed ${targetDays}-day inventory target`}
              className="inline-flex items-center justify-center rounded px-2.5 py-1.5 bg-blue-500/30 hover:bg-blue-500/50 disabled:opacity-40 cursor-pointer"
            >
              {props.autoFilling2 ? "..." : <CalendarDays className="h-4 w-4" aria-hidden="true" />}
            </button>
<button
              onClick={(event) => {
                event.stopPropagation();
                props.onAutoFill3?.();
              }}
              disabled={!props.qtyEditable || props.autoFilling3}
              title="Con qty 세일즈 구간별 목표 계산"
              aria-label="판매량 구간별 자동 발주 계산"
              className="inline-flex items-center justify-center rounded px-2.5 py-1.5 bg-emerald-500/30 hover:bg-emerald-500/50 disabled:opacity-40 cursor-pointer"
            >
              {props.autoFilling3 ? "..." : <ChartColumn className="h-4 w-4" aria-hidden="true" />}
            </button>
            {props.qtyEditable && props.dirty && (
              <>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onReset?.();
                  }}
                  title="DB 원래 값으로 초기화"
                  className="rounded px-3 py-1.5 text-[15px] bg-red-500/70 hover:bg-red-500 cursor-pointer"
                >
                  ↺
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSave?.();
                  }}
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
        <div className="flex w-full text-[12px] leading-tight font-extrabold text-[#8FE6A6]">
          {orderedTotalColumns.map((column) => {
            const totalLabel = column.total === undefined
              ? ""
              : column.id === "ccbm"
                ? column.total.toFixed(1)
                : Math.round(column.total).toLocaleString();
            return (
              <span
                key={column.id}
                data-summary-column-id={column.columnId}
                title={totalLabel ? `Total: ${totalLabel}` : undefined}
                className={`shrink-0 overflow-visible whitespace-nowrap text-center${
                  column.id === CON_QTY_COLUMN_ID ? " font-bold" : ""
                }`}
                style={{
                  width: liveColumnWidths[column.columnId] ?? column.width,
                }}
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
  showZeroSales,
  freezeUntil,
  columnWidths,
  onColumnWidthsChange,
  columnFilterMenuSize = DEFAULT_COLUMN_FILTER_MENU_SIZE,
  onColumnFilterMenuSizeChange,
  columnOrder = [],
  onColumnOrderChange,
  onContainerOrderCustomized,
  onContainerEtaChange,
  seasonalFactors,
  columnColors = {},
  cellColors = {},
  columnTextFormats = {},
  cellTextFormats = {},
  onFormatHistoryRecorderReady,
  onApplyFormatHistoryChanges,
  skuCellNotes = {},
  skuWorkNotes = {},
  skuWorkNotes2 = {},
  skuWorkNotes3 = {},
  canEditSkuNotes = false,
  canEditPlanning = false,
  onSkuCellNoteChange,
  onSkuWorkNoteChange,
  onAgCellSelected,
  onCellSelectionChange,
  selectedColumnIds = [],
  onColumnHeaderSelect,
  selectedFullColumnIds = [],
  onFullColumnSelect,
  columnHeaderNames = {},
  onColumnHeaderRename,
  onExportReady,
  onEditActionsReady,
  gradient = [],
  gradientSC = [],
  hiddenContainers = new Set<string>(),
  hiddenBases = new Set<string>(),
  hiddenContainerColumns = new Set<string>(),
  salesWindowWeights = DEFAULT_SALES_WINDOW_WEIGHTS,
  onHideColumn,
  onHideColumns,
  onHideContainer,
  onToggleContainerColumns,
}: DemandPlanningGridProps) {
  const { pick } = useI18n();
  const gridRef = useRef<AgGridReact<DemandRow>>(null);
  const gridHostRef = useRef<HTMLDivElement>(null);
  const dragCellAnchorRef = useRef<DragCellAnchor | null>(null);
  const dragMovedRef = useRef(false);
  const selectedCellsRef = useRef<Set<string>>(new Set());
  const activeSelectedCellRef = useRef<{ rowId: string; columnId: string } | null>(null);
  const cellSelectionAnchorRef = useRef<DragCellAnchor | null>(null);
  const lastHeaderSelectionRef = useRef<string | null>(null);
  const lastFullColumnSelectionRef = useRef<string | null>(null);
  const selectedColumnIdsRef = useRef(new Set(selectedColumnIds));
  const selectedFullColumnIdsRef = useRef(new Set(selectedFullColumnIds));
  const selectionListenersRef = useRef(new Set<() => void>());
  const dragSelectionFrameRef = useRef<number | null>(null);
  const pendingDragSelectionRef = useRef<SelectedAgCell[] | null>(null);
  const columnDragAutoScrollRef = useRef({ active: false, clientX: 0, clientY: 0, frame: null as number | null });
  const columnDragAutoScrollTickRef = useRef<() => void>(() => {});
  const appliedColumnStructureRef = useRef<string | null>(null);
  const columnWidthsRef = useRef(columnWidths);
  const columnTextFormatsRef = useRef(columnTextFormats);
  const cellColorsRef = useRef(cellColors);
  const cellTextFormatsRef = useRef(cellTextFormats);
  const sheetClipboardRef = useRef<SheetClipboardPayload | null>(null);
  const [etaOverrides, setEtaOverrides] = useState<Map<number, string>>(new Map());
  const [etaEditor, setEtaEditor] = useState<{
    container: ContainerMeta;
    anchor: EtaPickerAnchor;
  } | null>(null);
  const [qtyOverrides, setQtyOverrides] = useState<Map<string, QtyOverride>>(new Map());
  const qtyOverridesRef = useRef(qtyOverrides);
  const lastChainedQtyOverridesRef = useRef(qtyOverrides);
  const clearingSelectedEditableCellsRef = useRef(false);
  const sheetUndoStackRef = useRef<SheetHistoryEntry[]>([]);
  const sheetRedoStackRef = useRef<SheetHistoryEntry[]>([]);
  const sheetHistoryBusyRef = useRef(false);
  const qtyPersistenceQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const qtyServerItemIdsRef = useRef<Map<string, number>>(new Map());
  const [chainMap, setChainMap] = useState<Map<string, Map<string, ChainDerived>>>(new Map());
  const chainMapRef = useRef(chainMap);
  const qtyRenderSyncTimerRef = useRef<number | null>(null);
  const [chainReadyAfterLoad, setChainReadyAfterLoad] = useState(true);
  const [cbmOverrides, setCbmOverrides] = useState<Map<string, number>>(new Map());
  const [rowOverrides, setRowOverrides] = useState<Map<string, Partial<DemandRow>>>(new Map());
  const [gridWidth, setGridWidth] = useState(0);
  // Right-click column menu (Sort A→Z, Sort Z→A, Filter, Hide), keyed the
  // same way `colId` already is: a base column's own id, or
  // `<containerName>::<subColumnId>` for a container sub-column.
  const [columnFilters, setColumnFilters] = useState<Map<string, ColumnFilter>>(new Map());
  const [sort, setSort] = useState<GridSort | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number; key: string; label: string } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; label: string; columnIds: string[] } | null>(null);
  const [containerMenu, setContainerMenu] = useState<{ x: number; y: number; label: string; containerName: string; baseline: boolean } | null>(null);
  const [qtyCtxMenu, setQtyCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterOpenKey, setFilterOpenKey] = useState<string | null>(null);
  const [dirtyContainers, setDirtyContainers] = useState<Set<string>>(new Set());
  const [autoFillingContainers, setAutoFillingContainers] = useState<Set<string>>(new Set());
  const [autoFillingContainers2, setAutoFillingContainers2] = useState<Set<string>>(new Set());
const [autoFillingContainers3, setAutoFillingContainers3] = useState<Set<string>>(new Set());
  const [savingContainers, setSavingContainers] = useState<Set<string>>(new Set());
  const [fixedTargetDialog, setFixedTargetDialog] = useState<{
    container: ContainerMeta;
    containerIndex: number;
    targetDays: number;
  } | null>(null);
  const [fixedTargetCapacityMode, setFixedTargetCapacityMode] = useState<CapacityMode>("fit");
  const [backfill3Dialog, setBackfill3Dialog] = useState<{ container: ContainerMeta; containerIndex: number } | null>(null);
  const [backfill3Tiers, setBackfill3Tiers] = useState<SalesTargetTier[]>(DEFAULT_BACKFILL3_TIERS);
  const [backfill3CapacityMode, setBackfill3CapacityMode] = useState<CapacityMode>("fit");

  useEffect(() => {
    qtyOverridesRef.current = qtyOverrides;
  }, [qtyOverrides]);

  useEffect(() => {
    chainMapRef.current = chainMap;
  }, [chainMap]);

  const pushHistoryEntry = useCallback((entry: SheetHistoryEntry) => {
    const valueChanges = entry.valueChanges.filter((change) => change.before !== change.after);
    const formatChanges = entry.formatChanges.filter(
      (change) => JSON.stringify(change.before) !== JSON.stringify(change.after),
    );
    if (!valueChanges.length && !formatChanges.length) return;
    sheetUndoStackRef.current = [
      ...sheetUndoStackRef.current.slice(-(MAX_SHEET_HISTORY - 1)),
      { valueChanges, formatChanges },
    ];
    sheetRedoStackRef.current = [];
  }, []);

  const pushSheetHistory = useCallback((changes: SheetHistoryChange[]) => {
    pushHistoryEntry({ valueChanges: changes, formatChanges: [] });
  }, [pushHistoryEntry]);

  const pushFormatHistory = useCallback((changes: PlanningFormatHistoryChange[]) => {
    pushHistoryEntry({ valueChanges: [], formatChanges: changes });
  }, [pushHistoryEntry]);

  useEffect(() => {
    if (!onFormatHistoryRecorderReady) return;
    onFormatHistoryRecorderReady(pushFormatHistory);
    return () => onFormatHistoryRecorderReady(null);
  }, [onFormatHistoryRecorderReady, pushFormatHistory]);

  const scheduleQtyRenderSync = useCallback(() => {
    if (qtyRenderSyncTimerRef.current !== null) window.clearTimeout(qtyRenderSyncTimerRef.current);
    qtyRenderSyncTimerRef.current = window.setTimeout(() => {
      qtyRenderSyncTimerRef.current = null;
      const overrides = qtyOverridesRef.current;
      const chains = chainMapRef.current;
      startTransition(() => {
        setQtyOverrides(overrides);
        setChainMap(chains);
      });
    }, 900);
  }, []);

  useEffect(() => () => {
    if (qtyRenderSyncTimerRef.current !== null) window.clearTimeout(qtyRenderSyncTimerRef.current);
  }, []);

  const containers = useMemo(() => {
    const filtered = data.containers
      .map((container) => container.container_id !== undefined && etaOverrides.has(container.container_id)
        ? { ...container, eta: etaOverrides.get(container.container_id)! }
        : container)
      .filter((container) => {
        if (container.status === "baseline") return true;
        if (hiddenContainers.has(container.name)) return false;
        const checkedBase = checkedBaseCategories(categoryFilter);
        // SWC has no container concept — if nothing category-shaped is checked, don't filter containers at all.
        if (!checkedBase.length) return true;
        if (!container.categories?.length) {
          if (container.name.endsWith("-FLOOR")) return checkedBase.includes("fm");
          if (container.name.endsWith("-SEAT")) return checkedBase.includes("sc");
          return true;
        }
        return checkedBase.some((cat) => container.categories!.includes(cat.toUpperCase()));
      });

    const baseline = filtered.filter((container) => container.status === "baseline");
    const ordered = filtered
      .filter((container) => container.status !== "baseline")
      .sort((a, b) => {
        const aTime = a.eta ? new Date(a.eta).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.eta ? new Date(b.eta).getTime() : Number.POSITIVE_INFINITY;
        return aTime !== bTime ? aTime - bTime : a.name.localeCompare(b.name);
      });
    return [...baseline, ...ordered];
  }, [categoryFilter, data.containers, etaOverrides, hiddenContainers]);

  // Raw, comparable value for a container sub-column, mirroring the "merged"
  // object each cell already builds from base data + qty override + chain
  // calc. "Rem. Qty" reads the ROW rather than the container on purpose —
  // that matches its cell renderer in columns.ts, which does the same.
  const containerSubColumnValue = useCallback((containerName: string, subId: string, row: DemandRow): unknown => {
    if (subId === "remaining") return (row.remaining ?? 0) + (row.mistake ?? 0);
    const key = `${row.sku}::${containerName}`;
    const raw = row.containers?.[containerName];
    const chain = chainMap.get(row.sku)?.get(containerName);
    const override = qtyOverrides.get(key);
    const merged = { ...raw, ...override, ...chain };
    switch (subId) {
      case "inb_qty": return override !== undefined ? override.inbound_qty ?? 0 : raw?.inbound_qty ?? 0;
      case "oo": return Math.round(merged.open_orders || 0);
      case "avail": return merged.avail_qty ?? null;
      case "est": return Math.round(merged.est_sales ?? 0) || 0;
      case "cbo": return Math.round(merged.backorder || 0);
      case "carry": return merged.carryover ?? null;
      case "life": return merged.inv_life ?? null;
      case "esod": return merged.est_sod ?? null;
      case "psod": return merged.plan_sod ?? null;
      case "ccbm": {
        const qty = merged.inbound_qty ?? 0;
        const cbmUnit = row.cbm_per_unit ?? 0;
        return qty && cbmUnit ? Math.round(qty * cbmUnit * 100) / 100 : null;
      }
      default: return null;
    }
  }, [chainMap, qtyOverrides]);

  const columnMenuValue = useCallback((key: string, row: DemandRow): unknown => {
    const parsed = parseColumnMenuKey(key);
    return parsed.kind === "base" ? baseColumnValue(parsed.id, row) : containerSubColumnValue(parsed.container, parsed.sub, row);
  }, [containerSubColumnValue]);

  const columnMenuAccessors = useCallback((keys: Iterable<string>): Record<string, (row: DemandRow) => unknown> =>
    Object.fromEntries([...new Set(keys)].map((key) => [key, (row: DemandRow) => columnMenuValue(key, row)])),
  [columnMenuValue]);

  const columnMenuLabel = useCallback((key: string, row: DemandRow): string => {
    const value = columnMenuValue(key, row);
    return value === null || value === undefined ? "" : String(value);
  }, [columnMenuValue]);

  // Only user-assigned colors belong in the Sheets-style color menu. Default
  // white/tint backgrounds and inherited black text must not enable a color
  // type that the user never configured.
  const columnMenuFillColor = useCallback((key: string, row: DemandRow): string => {
    const parsed = parseColumnMenuKey(key);
    const cellKey = cellColorKey(row.sku, key);
    const explicit = cellColors[cellKey];
    if (explicit) return explicit;
    if (parsed.kind === "base") {
      return columnColors[parsed.id]?.cell ?? "";
    }
    const sharedColumnId = `con:${parsed.sub}`;
    return columnColors[key]?.cell
      ?? columnColors[sharedColumnId]?.cell
      ?? "";
  }, [cellColors, columnColors]);

  const columnMenuTextColor = useCallback((key: string, row: DemandRow): string => {
    const parsed = parseColumnMenuKey(key);
    const cellKey = cellColorKey(row.sku, key);
    const explicit = cellTextFormats[cellKey]?.color;
    if (explicit) return explicit;
    if (parsed.kind === "base") return columnTextFormats[parsed.id]?.cell?.color ?? "";
    return columnTextFormats[key]?.cell?.color
      ?? columnTextFormats[`con:${parsed.sub}`]?.cell?.color
      ?? "";
  }, [cellTextFormats, columnTextFormats]);

  const columnMenuFillColorAccessors = useCallback((keys: Iterable<string>): Partial<Record<string, (row: DemandRow) => string>> =>
    Object.fromEntries([...new Set(keys)].map((key) => [key, (row: DemandRow) => columnMenuFillColor(key, row)])),
  [columnMenuFillColor]);

  const columnMenuTextColorAccessors = useCallback((keys: Iterable<string>): Partial<Record<string, (row: DemandRow) => string>> =>
    Object.fromEntries([...new Set(keys)].map((key) => [key, (row: DemandRow) => columnMenuTextColor(key, row)])),
  [columnMenuTextColor]);

  // Every filter above the column headers, applied but not yet sorted. This is
  // the population a column's own Filter submenu computes its distinct values
  // against (minus that column's own filter — see columnValuesForOpenKey).
  const bespokeFilteredRows = useMemo(() => {
    const query = search.toLowerCase();
    const filtered = data.rows.filter((row) => {
      if (!matchesCategorySelection(row, categoryFilter)) return false;
      if (!showZeroSales && !urgencyFilter &&
        !row.west_90d && !row.west_60d && !row.west_30d && !row.west_15d && !row.west_7d &&
        !row.east_90d && !row.east_60d && !row.east_30d && !row.east_15d && !row.east_7d) return false;
      if (productFilter === "orig" && row.sales_status !== "Original")      return false;
      if (productFilter === "cust" && row.sales_status !== "Custom")        return false;
      if (productFilter === "part" && row.sales_status !== "Part")          return false;
      if (!skuMatchesPartFilters(row, skuPartFilters)) return false;
      if (query && !row.sku.toLowerCase().includes(query) && !(row.containers_list ?? "").toLowerCase().includes(query)) return false;
      const urgency = urgStatus(row);
      if (urgencyFilter === "crit") return urgency === "crit";
      if (urgencyFilter === "warn") return urgency === "warn";
      if (urgencyFilter === "bo") return (row.back ?? 0) < 0;
      if (urgencyFilter === "over") return urgency === "over";
      return true;
    });
    return filtered.map((row) => {
      const merged: DemandRow = {
        ...row,
        ...(rowOverrides.get(row.sku) ?? {}),
        ...(cbmOverrides.has(row.sku) ? { cbm_per_unit: cbmOverrides.get(row.sku) } : {}),
        workflow_note: skuWorkNotes[row.sku] ?? null,
        workflow_note_2: skuWorkNotes2[row.sku] ?? null,
        workflow_note_3: skuWorkNotes3[row.sku] ?? null,
      };
      merged.stock_mode = "available";
      return merged;
    });
  }, [categoryFilter, cbmOverrides, data.rows, productFilter, rowOverrides, search, showZeroSales, skuPartFilters, skuWorkNotes, skuWorkNotes2, skuWorkNotes3, urgencyFilter]);

  const visibleRows = useMemo(
    () => applyColumnFilters(
      bespokeFilteredRows,
      columnFilters,
      columnMenuAccessors(columnFilters.keys()),
      undefined,
      columnMenuFillColorAccessors(columnFilters.keys()),
      columnMenuTextColorAccessors(columnFilters.keys()),
    ),
    [bespokeFilteredRows, columnFilters, columnMenuAccessors, columnMenuFillColorAccessors, columnMenuTextColorAccessors],
  );

  // The right-clicked column's distinct values, computed from every OTHER
  // active column filter but not its own — the sequential behaviour
  // Sheets/Excel use, so the checkbox list still shows values this column's
  // own filter has already hidden rather than only the ones left over.
  const columnValuesForOpenKey = useMemo((): DistinctValue[] => {
    if (!filterOpenKey) return [];
    const relevantKeys = new Set([...columnFilters.keys(), filterOpenKey]);
    return distinctColumnValuesExcluding(
      bespokeFilteredRows,
      columnFilters,
      columnMenuAccessors(relevantKeys),
      Object.fromEntries([...relevantKeys].map((key) => [key, (row: DemandRow) => columnMenuLabel(key, row)])),
      filterOpenKey,
      pick("(공백)", "(Blank)"),
      undefined,
      columnMenuFillColorAccessors(relevantKeys),
      columnMenuTextColorAccessors(relevantKeys),
    );
  }, [filterOpenKey, bespokeFilteredRows, columnFilters, columnMenuAccessors, columnMenuFillColorAccessors, columnMenuLabel, columnMenuTextColorAccessors, pick]);

  // Same sequential idea as `columnValuesForOpenKey`, but the swatch list
  // Sort by color / Filter by color show — distinct colors actually present
  // in this column, most-used first.
  const columnFillColorsForOpenKey = useMemo((): DistinctColor[] => {
    if (!filterOpenKey) return [];
    const relevantKeys = new Set([...columnFilters.keys(), filterOpenKey]);
    return distinctColumnColorsExcluding(
      bespokeFilteredRows,
      columnFilters,
      columnMenuAccessors(relevantKeys),
      filterOpenKey,
      (row) => columnMenuFillColor(filterOpenKey, row),
      undefined,
      columnMenuFillColorAccessors(relevantKeys),
      columnMenuTextColorAccessors(relevantKeys),
    );
  }, [filterOpenKey, bespokeFilteredRows, columnFilters, columnMenuAccessors, columnMenuFillColor, columnMenuFillColorAccessors, columnMenuTextColorAccessors]);

  const columnTextColorsForOpenKey = useMemo((): DistinctColor[] => {
    if (!filterOpenKey) return [];
    const relevantKeys = new Set([...columnFilters.keys(), filterOpenKey]);
    return distinctColumnColorsExcluding(
      bespokeFilteredRows,
      columnFilters,
      columnMenuAccessors(relevantKeys),
      filterOpenKey,
      (row) => columnMenuTextColor(filterOpenKey, row),
      undefined,
      columnMenuFillColorAccessors(relevantKeys),
      columnMenuTextColorAccessors(relevantKeys),
    );
  }, [filterOpenKey, bespokeFilteredRows, columnFilters, columnMenuAccessors, columnMenuFillColorAccessors, columnMenuTextColor, columnMenuTextColorAccessors]);

  // Sorted, for display only — order-fill and chain calculations read
  // `visibleRows` directly, since which rows are in scope should not depend
  // on how they're currently displayed.
  const sortedRows = useMemo(() => {
    if (!sort) return visibleRows;
    if (sort.kind === "color") {
      const target = sort.color;
      const colorAccessor = sort.colorType === "text" ? columnMenuTextColor : columnMenuFillColor;
      return [...visibleRows].sort((a, b) => {
        const aMatch = colorAccessor(sort.key, a) === target;
        const bMatch = colorAccessor(sort.key, b) === target;
        if (aMatch === bMatch) return 0;
        return aMatch ? -1 : 1;
      });
    }
    const accessor = (row: DemandRow) => columnMenuValue(sort.key, row);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...visibleRows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return 0;
        return (aEmpty ? 1 : -1) * dir;
      }
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return cmp * dir;
    });
  }, [visibleRows, sort, columnMenuFillColor, columnMenuTextColor, columnMenuValue]);

  useEffect(() => {
    onFilteredRowsChange(visibleRows);
  }, [onFilteredRowsChange, visibleRows]);

  const rowsInDisplayOrder = useCallback((): DemandRow[] => {
    const rows: DemandRow[] = [];
    gridRef.current?.api.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) rows.push(node.data);
    });
    return rows.length > 0 ? rows : visibleRows;
  }, [visibleRows]);

  function openContainerPlanning(container: ContainerMeta) {
    if (!container.container_id) {
      window.alert(pick("이 컨테이너는 아직 저장된 컨테이너 ID가 없습니다.", "This container does not have a saved container ID yet."));
      return;
    }

    const url = withBasePath(`/planning/container-planning?containerId=${encodeURIComponent(String(container.container_id))}`);
    window.open(url, "_blank", "noopener,noreferrer");
  }

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
    const dragState = columnDragAutoScrollRef.current;
    const handleMouseMove = (event: MouseEvent) => {
      dragState.clientX = event.clientX;
      dragState.clientY = event.clientY;
    };
    const stopAutoScroll = () => {
      dragState.active = false;
      if (dragState.frame !== null) window.cancelAnimationFrame(dragState.frame);
      dragState.frame = null;
    };
    const tick = () => {
      dragState.frame = null;
      if (!dragState.active) return;
      const host = gridHostRef.current;
      const centerViewport = host?.querySelector<HTMLElement>(".ag-center-cols-viewport");
      const horizontalViewport = host?.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport");
      if (host && centerViewport) {
        const rect = centerViewport.getBoundingClientRect();
        const edgeSize = Math.min(96, Math.max(48, rect.width * 0.14));
        let delta = 0;
        if (dragState.clientX > rect.right - edgeSize) {
          const ratio = Math.min(1, (dragState.clientX - (rect.right - edgeSize)) / edgeSize);
          delta = Math.ceil(4 + ratio * 24);
        } else if (dragState.clientX < rect.left + edgeSize) {
          const ratio = Math.min(1, ((rect.left + edgeSize) - dragState.clientX) / edgeSize);
          delta = -Math.ceil(4 + ratio * 24);
        }

        if (delta !== 0) {
          const candidates = [horizontalViewport, centerViewport, host].filter((element): element is HTMLElement => Boolean(element));
          const scrollTarget = candidates.reduce((best, element) => {
            const overflow = element.scrollWidth - element.clientWidth;
            const bestOverflow = best.scrollWidth - best.clientWidth;
            return overflow > bestOverflow ? element : best;
          }, candidates[0]);
          const before = scrollTarget.scrollLeft;
          scrollTarget.scrollLeft += delta;
          if (scrollTarget.scrollLeft !== before) {
            const pointerTarget = document.elementFromPoint(dragState.clientX, dragState.clientY);
            pointerTarget?.dispatchEvent(new MouseEvent("mousemove", {
              bubbles: true,
              buttons: 1,
              clientX: dragState.clientX,
              clientY: dragState.clientY,
            }));
          }
        }
      }
      dragState.frame = window.requestAnimationFrame(tick);
    };
    columnDragAutoScrollTickRef.current = tick;
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", stopAutoScroll, true);
    window.addEventListener("blur", stopAutoScroll);
    return () => {
      stopAutoScroll();
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", stopAutoScroll, true);
      window.removeEventListener("blur", stopAutoScroll);
    };
  }, []);

  useEffect(() => {
    if (!groupVis.con || containerDetailsLoaded || containerDetailsLoading) return;
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => onLoadContainerDetails());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [containerDetailsLoaded, containerDetailsLoading, groupVis.con, onLoadContainerDetails]);

  // CON_SUBCOLS reordered with "ccbm" moved to the front — the same reorder
  // `subColumns` used to apply only after filtering. Doing it unconditionally
  // here keeps hidden-run detection consistent regardless of whether "ccbm"
  // itself happens to be hidden: its canonical rendered position is always
  // the front of whatever's visible, so that's also where its gap belongs
  // when it's the one hidden.
  const conCandidates = useMemo(() => {
    const ccbm = CON_SUBCOLS.find((column) => column.id === "ccbm");
    const rest = CON_SUBCOLS.filter((column) => column.id !== "ccbm");
    return ccbm ? [ccbm, ...rest] : rest;
  }, []);

  // Sub-column visibility (`con:<id>`) has no per-container override, so this
  // is computed once and reused identically inside every container's own
  // column group below.
  const conHiddenRuns = useMemo(() => {
    const runs: { hiddenIds: string[]; hiddenLabels: string[]; startIndex: number }[] = [];
    let pending: typeof conCandidates = [];
    let startIndex = -1;
    const flush = () => {
      if (!pending.length) return;
      runs.push({
        hiddenIds: pending.map((c) => c.id),
        hiddenLabels: pending.map((c) => c.label.replace("\n", " ")),
        startIndex,
      });
      pending = [];
    };
    conCandidates.forEach((column, index) => {
      if (columnVis[`con:${column.id}`] === false) {
        if (!pending.length) startIndex = index;
        pending.push(column);
        return;
      }
      flush();
    });
    flush();
    return runs;
  }, [conCandidates, columnVis]);

  // Same anchoring idea as `baseRestoreMarkers`, but global (sub-column
  // visibility has no per-container override) — reused identically inside
  // every container's own column group below.
  const conRestoreMarkers = useMemo(() => {
    const left = new Map<string, HideGapRestoreInfo>();
    const right = new Map<string, HideGapRestoreInfo>();
    for (const run of conHiddenRuns) {
      const onRestore = () => run.hiddenIds.forEach((id) => onHideColumn?.(`con:${id}`));
      const afterId = conCandidates[run.startIndex + run.hiddenIds.length]?.id;
      if (afterId) { left.set(afterId, { hiddenLabels: run.hiddenLabels, onRestore }); continue; }
      const beforeId = conCandidates[run.startIndex - 1]?.id;
      if (beforeId) right.set(beforeId, { hiddenLabels: run.hiddenLabels, onRestore });
    }
    return { left, right };
  }, [conCandidates, conHiddenRuns, onHideColumn]);

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
        const conQty = override !== undefined ? override.inbound_qty ?? 0 : raw?.inbound_qty ?? 0;
        const cbmUnit = override?.cbm_unit ?? raw?.cbm_unit ?? row.cbm_per_unit ?? 0;
        containerTotals.ccbm! += conQty * cbmUnit;
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
      const currentOverrides = qtyOverridesRef.current;
      const nextChainMap = new Map(
        data.rows.map((row) => [row.sku, computeContainerChain(row, containers, currentOverrides, seasonalFactors)]),
      );
      lastChainedQtyOverridesRef.current = currentOverrides;
      chainMapRef.current = nextChainMap;
      setChainMap(nextChainMap);
      setChainReadyAfterLoad(true);
    });
    return () => { cancelled = true; };
  }, [containers, data.rows, seasonalFactors]);

  // Quantity edits affect only their SKU chain. Recomputing every row after
  // each keystroke made Con. Qty edits increasingly slow on large datasets.
  useEffect(() => {
    const previous = lastChainedQtyOverridesRef.current;
    if (previous === qtyOverrides) return;

    const changedSkus = new Set<string>();
    for (const [key, value] of qtyOverrides) {
      if (previous.get(key) !== value) changedSkus.add(key.slice(0, key.indexOf("::")));
    }
    for (const key of previous.keys()) {
      if (!qtyOverrides.has(key)) changedSkus.add(key.slice(0, key.indexOf("::")));
    }
    lastChainedQtyOverridesRef.current = qtyOverrides;
    if (!changedSkus.size) return;

    const rowsBySku = new Map(data.rows.map((row) => [row.sku, row]));
    setChainMap((current) => {
      const next = new Map(current);
      for (const sku of changedSkus) {
        const row = rowsBySku.get(sku);
        if (row) next.set(sku, computeContainerChain(row, containers, qtyOverrides, seasonalFactors));
      }
      chainMapRef.current = next;
      return next;
    });
  }, [containers, data.rows, qtyOverrides, seasonalFactors]);

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.refreshCells({ force: true });
    api.refreshHeader();
  }, [cbmOverrides, cellColors, chainMap, columnColors, qtyOverrides, rowOverrides]);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  const refreshFullSelectionColumns = useCallback((logicalIds: Set<string>) => {
    if (!logicalIds.size) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const columns = (api.getColumns() ?? []).filter((column) => {
      const columnId = column.getColId();
      for (const logicalId of logicalIds) {
        if (logicalId.includes("::") && columnId === logicalId) return true;
        if (logicalId.startsWith("con:") && columnId.endsWith(`::${logicalId.slice(4)}`)) return true;
        if (!logicalId.startsWith("container:") && columnId === logicalId) return true;
      }
      return false;
    });
    if (columns.length) api.refreshCells({ columns, force: true });
  }, []);

  const subscribeSelection = useCallback((listener: () => void) => {
    selectionListenersRef.current.add(listener);
    return () => selectionListenersRef.current.delete(listener);
  }, []);

  const notifySelectionChanged = useCallback(() => {
    for (const listener of selectionListenersRef.current) listener();
  }, []);

  const headerSelectionRange = useCallback((anchorId: string, columnId: string) => {
    const containerRange = anchorId.startsWith("container:") && columnId.startsWith("container:");
    const mixedContainerLevels = anchorId.startsWith("container:") !== columnId.startsWith("container:");
    if (mixedContainerLevels) return [columnId];

    const displayedLeafOrder: string[] = [];
    for (const column of gridRef.current?.api.getAllDisplayedColumns() ?? []) {
      const physicalId = column.getColId();
      if (physicalId.includes("hidegap:")) continue;
      if (!displayedLeafOrder.includes(physicalId)) displayedLeafOrder.push(physicalId);
    }
    const order = containerRange
      ? [
          ...containers.filter((container) => container.status === "baseline" && !hiddenBases.has("Base")),
          ...containers.filter((container) => container.status !== "baseline"),
        ].map((container) => `container:${container.name}`)
      : displayedLeafOrder.length ? displayedLeafOrder : [
          ...ALL_COLS
            .filter((column) => (column.grp === "fix" || groupVis[column.grp]) && columnVis[column.id] !== false)
            .map((column) => column.id),
          ...(groupVis.con
            ? containers.flatMap((container) => conCandidates
                .filter((column) => columnVis[`con:${column.id}`] !== false)
                .map((column) => `${container.name}::${column.id}`))
            : []),
        ];
    const anchorIndex = order.indexOf(anchorId);
    const columnIndex = order.indexOf(columnId);
    if (anchorIndex < 0 || columnIndex < 0) return [columnId];
    return order.slice(Math.min(anchorIndex, columnIndex), Math.max(anchorIndex, columnIndex) + 1);
  }, [columnVis, conCandidates, containers, groupVis, hiddenBases]);

  const handleColumnHeaderSelectFast = useCallback((columnId: string, modifiers: SelectionModifiers) => {
    const current = selectedColumnIdsRef.current;
    let next: Set<string>;
    if (modifiers.replace) {
      next = new Set([columnId]);
      lastHeaderSelectionRef.current = columnId;
    } else if (modifiers.range && lastHeaderSelectionRef.current) {
      const range = headerSelectionRange(lastHeaderSelectionRef.current, columnId);
      next = modifiers.toggle ? new Set([...current, ...range]) : new Set(range);
    } else {
      next = new Set(current);
      if (next.has(columnId)) next.delete(columnId);
      else {
        if (!modifiers.toggle) next.clear();
        next.add(columnId);
        lastHeaderSelectionRef.current = columnId;
      }
    }
    const clearedFullColumns = new Set(selectedFullColumnIdsRef.current);
    selectedColumnIdsRef.current = next;
    selectedFullColumnIdsRef.current = new Set();
    notifySelectionChanged();
    refreshFullSelectionColumns(clearedFullColumns);
    startTransition(() => onColumnHeaderSelect?.(columnId, modifiers.toggle || modifiers.range, [...next]));
  }, [headerSelectionRange, notifySelectionChanged, onColumnHeaderSelect, refreshFullSelectionColumns]);

  const handleFullColumnSelectFast = useCallback((columnId: string, modifiers: SelectionModifiers) => {
    const previous = new Set(selectedFullColumnIdsRef.current);
    let next: Set<string>;
    if (modifiers.replace) {
      next = new Set([columnId]);
      lastFullColumnSelectionRef.current = columnId;
    } else if (modifiers.range && lastFullColumnSelectionRef.current) {
      const range = headerSelectionRange(lastFullColumnSelectionRef.current, columnId);
      next = modifiers.toggle ? new Set([...previous, ...range]) : new Set(range);
    } else {
      next = new Set(previous);
      if (next.has(columnId)) next.delete(columnId);
      else {
        if (!modifiers.toggle) next.clear();
        next.add(columnId);
        lastFullColumnSelectionRef.current = columnId;
      }
    }
    selectedColumnIdsRef.current = new Set();
    selectedFullColumnIdsRef.current = next;
    notifySelectionChanged();
    refreshFullSelectionColumns(new Set([...previous, ...next]));
    startTransition(() => onFullColumnSelect?.(columnId, modifiers.toggle || modifiers.range, [...next]));
  }, [headerSelectionRange, notifySelectionChanged, onFullColumnSelect, refreshFullSelectionColumns]);

  useEffect(() => {
    const nextHeaders = new Set(selectedColumnIds);
    const nextFullColumns = new Set(selectedFullColumnIds);
    const headerChanged = nextHeaders.size !== selectedColumnIdsRef.current.size
      || [...nextHeaders].some((id) => !selectedColumnIdsRef.current.has(id));
    const fullChanged = nextFullColumns.size !== selectedFullColumnIdsRef.current.size
      || [...nextFullColumns].some((id) => !selectedFullColumnIdsRef.current.has(id));
    if (!headerChanged && !fullChanged) return;

    const affectedFullColumns = new Set([...selectedFullColumnIdsRef.current, ...nextFullColumns]);
    selectedColumnIdsRef.current = nextHeaders;
    selectedFullColumnIdsRef.current = nextFullColumns;
    notifySelectionChanged();
    if (fullChanged) refreshFullSelectionColumns(affectedFullColumns);
  }, [notifySelectionChanged, refreshFullSelectionColumns, selectedColumnIds, selectedFullColumnIds]);

  const refreshChangedCells = useCallback((previous: Set<string>, next: Set<string>) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const changed = new Set<string>();
    for (const key of previous) if (!next.has(key)) changed.add(key);
    for (const key of next) if (!previous.has(key)) changed.add(key);
    if (!changed.size) return;

    // A cell's selection border depends on whether its neighbors are also
    // selected, so a cell that stays selected still needs repainting when a
    // neighbor's selection state flips (e.g. the previous edge of a drag
    // range, once the range grows past it, must drop the border it no
    // longer needs). Widen the refresh to include each changed cell's four
    // neighbors, not just the cells whose own membership changed.
    const columns = api.getAllDisplayedColumns();
    const columnIndexById = new Map(columns.map((column, index) => [column.getColId(), index]));
    const toRefresh = new Set<string>(changed);
    for (const key of changed) {
      const separator = key.indexOf("::");
      if (separator < 0) continue;
      const rowId = key.slice(0, separator);
      const columnId = key.slice(separator + 2);
      const rowNode = api.getRowNode(rowId) ?? api.getRenderedNodes().find((node) => node.data?.sku === rowId);
      const rowIndex = rowNode?.rowIndex ?? null;
      if (rowIndex !== null) {
        const aboveRowId = api.getDisplayedRowAtIndex(rowIndex - 1)?.data?.sku;
        const belowRowId = api.getDisplayedRowAtIndex(rowIndex + 1)?.data?.sku;
        if (aboveRowId) toRefresh.add(cellColorKey(aboveRowId, columnId));
        if (belowRowId) toRefresh.add(cellColorKey(belowRowId, columnId));
      }
      const columnIndex = columnIndexById.get(columnId);
      if (columnIndex !== undefined) {
        const leftColumnId = columns[columnIndex - 1]?.getColId();
        const rightColumnId = columns[columnIndex + 1]?.getColId();
        if (leftColumnId) toRefresh.add(cellColorKey(rowId, leftColumnId));
        if (rightColumnId) toRefresh.add(cellColorKey(rowId, rightColumnId));
      }
    }

    const rowNodesByColumn = new Map<string, Set<NonNullable<ReturnType<typeof api.getRowNode>>>>();
    for (const key of toRefresh) {
      const separator = key.indexOf("::");
      if (separator < 0) continue;
      const rowId = key.slice(0, separator);
      const columnId = key.slice(separator + 2);
      const rowNode = api.getRowNode(rowId)
        ?? api.getRenderedNodes().find((node) => node.data?.sku === rowId);
      if (!rowNode || !api.getColumn(columnId)) continue;
      const rowNodes = rowNodesByColumn.get(columnId) ?? new Set();
      rowNodes.add(rowNode);
      rowNodesByColumn.set(columnId, rowNodes);
    }
    for (const [columnId, rowNodes] of rowNodesByColumn) {
      api.refreshCells({ columns: [columnId], rowNodes: [...rowNodes], force: true });
    }
  }, []);

  const selectSingleGridCell = useCallback((rowIndex: number, columnId: string) => {
    const api = gridRef.current?.api;
    const rowNode = api?.getDisplayedRowAtIndex(rowIndex);
    const column = api?.getColumn(columnId);
    const rowId = rowNode?.data?.sku;
    if (!api || !rowNode || !column || !rowId) return;

    const previous = selectedCellsRef.current;
    const key = `${rowId}::${columnId}`;
    const next = new Set([key]);
    selectedCellsRef.current = next;
    activeSelectedCellRef.current = { rowId, columnId };
    cellSelectionAnchorRef.current = { rowIndex, columnId };
    refreshChangedCells(previous, next);
    api.ensureIndexVisible(rowIndex, "middle");
    api.ensureColumnVisible(column);
    api.setFocusedCell(rowIndex, column);
    rowNode.setSelected(true, true);

    const selection: SelectedAgCell = {
      rowId,
      columnId,
      label: `${rowId} / ${column.getColDef().headerName ?? columnId}`,
    };
    startTransition(() => {
      onCellSelectionChange?.([key]);
      onAgCellSelected?.(selection);
    });
  }, [onAgCellSelected, onCellSelectionChange, refreshChangedCells]);

  const shouldPreserveContextSelection = useCallback(() => (
    selectedColumnIdsRef.current.size > 1
      || selectedFullColumnIdsRef.current.size > 1
      || selectedCellsRef.current.size > 1
  ), []);

  const extendSheetCellSelection = useCallback((direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") => {
    const api = gridRef.current?.api;
    const active = activeSelectedCellRef.current;
    if (!api || !active) return false;
    const currentRowIndex = api.getRowNode(active.rowId)?.rowIndex;
    if (currentRowIndex === null || currentRowIndex === undefined) return false;
    let nextRowIndex = currentRowIndex;
    let nextColumnId = active.columnId;

    if (direction === "ArrowUp" || direction === "ArrowDown") {
      nextRowIndex += direction === "ArrowUp" ? -1 : 1;
    } else {
      // Horizontal range extension is intentionally limited to adjacent Note
      // columns. If another column sits between them, do not select through it.
      const displayedColumns = api.getAllDisplayedColumns();
      const currentColumnIndex = displayedColumns.findIndex((column) => column.getColId() === active.columnId);
      const nextColumn = displayedColumns[currentColumnIndex + (direction === "ArrowLeft" ? -1 : 1)];
      if (
        currentColumnIndex < 0
        || workNoteSlotForColumnId(active.columnId) === null
        || !nextColumn
        || workNoteSlotForColumnId(nextColumn.getColId()) === null
      ) return false;
      nextColumnId = nextColumn.getColId();
    }
    if (nextRowIndex < 0 || nextRowIndex >= api.getDisplayedRowCount()) return false;

    const anchor = cellSelectionAnchorRef.current ?? { rowIndex: currentRowIndex, columnId: active.columnId };
    const cells = selectedCellsBetweenPosition(api, nextRowIndex, nextColumnId, anchor);
    const nextRow = api.getDisplayedRowAtIndex(nextRowIndex)?.data;
    if (!cells.length || !nextRow) return false;

    const previous = selectedCellsRef.current;
    const next = new Set(cells.map((cell) => `${cell.rowId}::${cell.columnId}`));
    selectedCellsRef.current = next;
    activeSelectedCellRef.current = { rowId: nextRow.sku, columnId: nextColumnId };
    cellSelectionAnchorRef.current = anchor;
    refreshChangedCells(previous, next);
    api.ensureIndexVisible(nextRowIndex, "middle");
    api.ensureColumnVisible(nextColumnId);
    api.setFocusedCell(nextRowIndex, nextColumnId);
    startTransition(() => {
      onCellSelectionChange?.([...next]);
      onAgCellSelected?.({ ...cells[0], cells });
    });
    return true;
  }, [onAgCellSelected, onCellSelectionChange, refreshChangedCells]);

  // Modifier-assisted or existing multi-selections survive a right-click,
  // including when the clicked cell is outside the selected range.
  const handleQtyContextMenu = useCallback((
    rowIndex: number,
    columnId: string,
    x: number,
    y: number,
    preserveSelection: boolean,
  ) => {
    const api = gridRef.current?.api;
    const rowId = api?.getDisplayedRowAtIndex(rowIndex)?.data?.sku;
    if (!preserveSelection && !shouldPreserveContextSelection()
      && rowId && !selectedCellsRef.current.has(`${rowId}::${columnId}`)) {
      selectSingleGridCell(rowIndex, columnId);
    }
    setQtyCtxMenu({ x, y });
  }, [selectSingleGridCell, shouldPreserveContextSelection]);

  const navigateActiveQtyCell = useCallback((navigationKey: QtyNavigationKey) => {
    const api = gridRef.current?.api;
    const active = activeSelectedCellRef.current;
    if (!api || !active || !active.columnId.endsWith("::inb_qty")) return false;
    const rowIndex = api.getRowNode(active.rowId)?.rowIndex;
    if (rowIndex === null || rowIndex === undefined) return false;
    const qtyColumns = api.getAllDisplayedColumns().filter(
      (column) => column.getColDef().cellRenderer === QtyCellRenderer,
    );
    const columnIndex = qtyColumns.findIndex((column) => column.getColId() === active.columnId);
    if (columnIndex < 0) return false;

    let nextRowIndex = rowIndex;
    let nextColumnIndex = columnIndex;
    if (navigationKey === "ArrowUp") nextRowIndex -= 1;
    if (navigationKey === "ArrowDown" || navigationKey === "Enter") nextRowIndex += 1;
    if (navigationKey === "ArrowLeft") nextColumnIndex -= 1;
    if (navigationKey === "ArrowRight") nextColumnIndex += 1;
    if (nextRowIndex < 0 || nextRowIndex >= api.getDisplayedRowCount()) return false;
    if (nextColumnIndex < 0 || nextColumnIndex >= qtyColumns.length) return false;
    selectSingleGridCell(nextRowIndex, qtyColumns[nextColumnIndex].getColId());
    return true;
  }, [selectSingleGridCell]);

  const getActiveCellEditor = useCallback(() => {
    const active = activeSelectedCellRef.current;
    if (!active) return null;
    return qtyEditorRegistry.get(qtyEditorKey(active.rowId, active.columnId)) ?? null;
  }, []);

  const navigateActiveBaseEditorCell = useCallback(() => {
    const api = gridRef.current?.api;
    const active = activeSelectedCellRef.current;
    if (!api || !active) return false;
    const rowIndex = api.getRowNode(active.rowId)?.rowIndex;
    if (rowIndex === null || rowIndex === undefined || rowIndex + 1 >= api.getDisplayedRowCount()) return false;
    selectSingleGridCell(rowIndex + 1, active.columnId);
    return true;
  }, [selectSingleGridCell]);

  const scheduleDragSelectionNotification = useCallback((cells: SelectedAgCell[]) => {
    pendingDragSelectionRef.current = cells;
    if (dragSelectionFrameRef.current !== null) return;
    dragSelectionFrameRef.current = window.requestAnimationFrame(() => {
      dragSelectionFrameRef.current = null;
      const pending = pendingDragSelectionRef.current;
      pendingDragSelectionRef.current = null;
      if (!pending?.length) return;
      startTransition(() => {
        onCellSelectionChange?.(pending.map((cell) => `${cell.rowId}::${cell.columnId}`));
        onAgCellSelected?.({ ...pending[0], cells: pending });
      });
    });
  }, [onAgCellSelected, onCellSelectionChange]);

  const handleQtyEditRequest = useCallback(() => {
    if (!dragMovedRef.current) return true;
    dragMovedRef.current = false;
    return false;
  }, []);

  // Copy/paste/fill-handle share this: the selected cells' rows and columns,
  // ordered the way they're actually displayed (not insertion order), so a
  // pasted block lands in the same shape it was copied from.
  const getSelectionBoundsOrdered = useCallback((): { rowIds: string[]; columnIds: string[] } | null => {
    const api = gridRef.current?.api;
    if (!api || selectedCellsRef.current.size === 0) return null;
    const rowIdSet = new Set<string>();
    const columnIdSet = new Set<string>();
    for (const key of selectedCellsRef.current) {
      const separator = key.indexOf("::");
      if (separator < 0) continue;
      rowIdSet.add(key.slice(0, separator));
      columnIdSet.add(key.slice(separator + 2));
    }
    const rowIds = [...rowIdSet]
      .map((id) => ({ id, index: api.getRowNode(id)?.rowIndex ?? -1 }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.id);
    const displayedColumns = api.getAllDisplayedColumns();
    const columnOrderIndex = new Map(displayedColumns.map((column, index) => [column.getColId(), index]));
    const columnIds = [...columnIdSet]
      .filter((id) => columnOrderIndex.has(id))
      .sort((a, b) => (columnOrderIndex.get(a) ?? 0) - (columnOrderIndex.get(b) ?? 0));
    if (!rowIds.length || !columnIds.length) return null;
    return { rowIds, columnIds };
  }, []);

  // Prefer the exact underlying value for the few cells users actually edit
  // (qty/cbm/note survive a copy → paste round trip as real numbers/text);
  // fall back to whatever text AG Grid rendered for everything else.
  const getCellCopyValue = useCallback((rowId: string, columnId: string): string => {
    const api = gridRef.current?.api;
    const row = api?.getRowNode(rowId)?.data;
    if (row) {
      if (columnId === "sku") return row.sku;
      if (columnId === "cbm") return row.cbm_per_unit ? row.cbm_per_unit.toFixed(6) : "";
      if (columnId === "tavg_c") return String(row.total_avg_curr ?? "");
      if (columnId === "workflow_note") return row.workflow_note ?? "";
      if (columnId === "workflow_note_2") return row.workflow_note_2 ?? "";
      if (columnId === "workflow_note_3") return row.workflow_note_3 ?? "";
      if (columnId.endsWith("::inb_qty")) {
        const containerName = columnId.slice(0, -"::inb_qty".length);
        const raw = row.containers?.[containerName];
        const override = qtyOverridesRef.current.get(`${row.sku}::${containerName}`);
        const qty = override !== undefined ? override.inbound_qty : raw?.inbound_qty;
        return qty != null ? String(qty) : "";
      }
    }
    const host = gridHostRef.current;
    if (!host) return "";
    const rowEl = host.querySelector<HTMLElement>(`[row-id="${cssEscapeAttr(rowId)}"]`);
    const cellEl = rowEl?.querySelector<HTMLElement>(`[col-id="${cssEscapeAttr(columnId)}"]`);
    return cellEl?.textContent?.trim() ?? "";
  }, []);


  const hideColumnsFromMenu = useCallback((menuColumnKey: string) => {
    const clickedSelectionKey = menuColumnKey;
    let selectedHideKeys: Set<string> | null = null;

    if (selectedColumnIdsRef.current.has(clickedSelectionKey)) {
      selectedHideKeys = new Set(selectedColumnIdsRef.current);
    } else if (selectedFullColumnIdsRef.current.has(clickedSelectionKey)) {
      selectedHideKeys = new Set(selectedFullColumnIdsRef.current);
    } else {
      const cellColumnKeys = new Set<string>();
      for (const cellKey of selectedCellsRef.current) {
        const separator = cellKey.indexOf("::");
        if (separator < 0) continue;
        cellColumnKeys.add(cellKey.slice(separator + 2));
      }
      if (cellColumnKeys.has(clickedSelectionKey)) selectedHideKeys = cellColumnKeys;
    }

    const requestedKeys = [...(selectedHideKeys ?? new Set([clickedSelectionKey]))]
      .filter((columnId) => !columnId.startsWith("container:"));
    const requestedPhysicalKeys = requestedKeys.filter((columnId) => columnId.includes("::"));
    const physicalKeys = requestedPhysicalKeys.filter((columnId) => {
      const column = gridRef.current?.api.getColumn(columnId);
      const displayedSiblings = column?.getParent()?.getDisplayedLeafColumns() ?? [];
      const selectedSiblingCount = displayedSiblings.filter((sibling) => requestedPhysicalKeys.includes(sibling.getColId())).length;
      // Keep one visible child so the container header and its restore arrow
      // always have a real column to anchor to.
      if (selectedSiblingCount < displayedSiblings.length) return true;
      return column !== displayedSiblings.at(-1);
    });
    const hideKeys = [...new Set(requestedKeys.filter((columnId) => !columnId.includes("::")).map(hideKeyForColumnMenuKey))]
      .filter((columnId) => !columnId.startsWith("container:") && columnVis[columnId] !== false);
    if (!hideKeys.length && !physicalKeys.length) return;

    if (onHideColumns) onHideColumns(hideKeys);
    else for (const columnId of hideKeys) onHideColumn?.(columnId);
    if (physicalKeys.length) onToggleContainerColumns?.(physicalKeys);

    selectedCellsRef.current = new Set();
    selectedColumnIdsRef.current = new Set();
    selectedFullColumnIdsRef.current = new Set();
    cellSelectionAnchorRef.current = null;
    lastHeaderSelectionRef.current = null;
    lastFullColumnSelectionRef.current = null;
    notifySelectionChanged();
    startTransition(() => onCellSelectionChange?.([]));
  }, [columnVis, notifySelectionChanged, onCellSelectionChange, onHideColumn, onHideColumns, onToggleContainerColumns]);

  const hideGroupColumns = useCallback((columnIds: string[]) => {
    const visibleColumnIds = columnIds.filter((columnId) => columnVis[columnId] !== false);
    if (!visibleColumnIds.length) return;
    if (onHideColumns) onHideColumns(visibleColumnIds);
    else for (const columnId of visibleColumnIds) onHideColumn?.(columnId);
  }, [columnVis, onHideColumn, onHideColumns]);

  useEffect(() => () => {
    if (dragSelectionFrameRef.current !== null) window.cancelAnimationFrame(dragSelectionFrameRef.current);
  }, []);

  useEffect(() => {
    cellColorsRef.current = cellColors;
  }, [cellColors]);

  useEffect(() => {
    columnTextFormatsRef.current = columnTextFormats;
    cellTextFormatsRef.current = cellTextFormats;
    const api = gridRef.current?.api;
    if (!api) return;
    // Text formatting does not change column structure. Refresh the rendered
    // cells/header in place instead of rebuilding every column definition.
    api.refreshCells({ force: true });
    api.refreshHeader();
  }, [cellTextFormats, columnTextFormats]);

  useEffect(() => {
    gridRef.current?.api?.refreshHeader();
  }, [gridWidth]);

  useEffect(() => {
    const finishDragSelection = () => {
      dragCellAnchorRef.current = null;
    };
    window.addEventListener("pointerup", finishDragSelection);
    window.addEventListener("pointercancel", finishDragSelection);
    window.addEventListener("mouseup", finishDragSelection);
    window.addEventListener("blur", finishDragSelection);
    return () => {
      window.removeEventListener("pointerup", finishDragSelection);
      window.removeEventListener("pointercancel", finishDragSelection);
      window.removeEventListener("mouseup", finishDragSelection);
      window.removeEventListener("blur", finishDragSelection);
    };
  }, []);

  const updateEta = useCallback(async (container: ContainerMeta, eta: string) => {
    if (!canEditPlanning || !eta || !container.container_id) return;
    const response = await fetch(apiPath(`/api/containers?id=${container.container_id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
      body: JSON.stringify({ eta }),
    });
    if (!response.ok) {
      toast.error(pick("ETA 변경에 실패했습니다.", "Failed to update ETA."));
      return;
    }
    const result = await response.json().catch(() => null) as { success?: boolean } | null;
    if (!result?.success) {
      toast.error(pick("ETA 변경에 실패했습니다.", "Failed to update ETA."));
      return;
    }
    setEtaOverrides((current) => new Map(current).set(container.container_id!, eta));
    onContainerEtaChange?.({ id: container.container_id, name: container.name, eta });
    const nextContainers = containers.map((entry) => entry.container_id === container.container_id ? { ...entry, eta } : entry);
    setChainMap(new Map(data.rows.map((row) => [row.sku, computeContainerChain(row, nextContainers, qtyOverrides, seasonalFactors)])));
    toast.success(pick("변경되었습니다.", "Updated."));
  }, [canEditPlanning, containers, data.rows, onContainerEtaChange, pick, qtyOverrides, seasonalFactors]);

  const saveCbm = useCallback(async (
    row: DemandRow,
    nextCbm: number,
    options: { recordHistory?: boolean } = {},
  ) => {
    if (!canEditPlanning) return false;
    if (!Number.isFinite(nextCbm) || nextCbm < 0) return false;
    if (nextCbm === row.cbm_per_unit) return true;
    const response = await fetch(apiPath(`/api/planning/products/${encodeURIComponent(row.sku)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
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
    if (options.recordHistory !== false) {
      pushSheetHistory([{
        rowId: row.sku,
        columnId: "cbm",
        before: String(row.cbm_per_unit ?? 0),
        after: String(nextCbm),
      }]);
    }

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
  }, [canEditPlanning, pushSheetHistory]);

  const saveTotalAvgCurrent = useCallback(async (
    row: DemandRow,
    nextOverride: number | null,
    options: { recordHistory?: boolean } = {},
  ) => {
    if (!canEditPlanning) return false;
    if (nextOverride !== null && (!Number.isFinite(nextOverride) || nextOverride < 0)) return false;
    const normalizedOverride = nextOverride === null ? null : Math.round(nextOverride * 10_000) / 10_000;
    if (normalizedOverride === (row.total_avg_curr_override ?? null)) return true;
    const response = await fetch(apiPath(`/api/planning/products/${encodeURIComponent(row.sku)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
      body: JSON.stringify({ total_avg_curr_override: normalizedOverride }),
    });
    const json = await response.json().catch(() => null) as { success?: boolean } | null;
    if (!json?.success) return false;

    if (options.recordHistory !== false) {
      pushSheetHistory([{
        rowId: row.sku,
        columnId: "tavg_c",
        before: row.total_avg_curr_override == null ? "" : String(row.total_avg_curr_override),
        after: normalizedOverride === null ? "" : String(normalizedOverride),
      }]);
    }

    const effectiveValue = normalizedOverride ?? row.total_avg_curr_auto ?? row.total_avg_curr;
    const updatedRow = {
      ...row,
      total_avg_curr: effectiveValue,
      total_avg_curr_override: normalizedOverride,
    };
    setRowOverrides((current) => {
      const next = new Map(current);
      next.set(row.sku, {
        ...(current.get(row.sku) ?? {}),
        total_avg_curr: effectiveValue,
        total_avg_curr_override: normalizedOverride,
      });
      return next;
    });
    const nextChain = new Map(chainMapRef.current).set(
      row.sku,
      computeContainerChain(updatedRow, containers, qtyOverridesRef.current, seasonalFactors),
    );
    chainMapRef.current = nextChain;
    setChainMap(nextChain);
    return true;
  }, [canEditPlanning, containers, pushSheetHistory, seasonalFactors]);

  const saveQty = useCallback(async (
    row: DemandRow,
    container: ContainerMeta,
    raw: ContainerRowData,
    nextQty: number,
    options: { recordHistory?: boolean } = {},
  ) => {
    if (!canEditPlanning) return false;
    if (!Number.isFinite(nextQty) || nextQty < 0 || !container.container_id) return false;
    const key = `${row.sku}::${container.name}`;
    const previous = qtyOverridesRef.current.get(key);
    const itemId = previous !== undefined ? previous.item_id : raw.item_id ?? undefined;
    if (itemId) qtyServerItemIdsRef.current.set(key, itemId);
    const oldQty = previous !== undefined ? previous.inbound_qty ?? 0 : raw.inbound_qty ?? 0;
    if (nextQty === oldQty || (previous === undefined && !itemId && nextQty === 0)) return true;
    if (options.recordHistory !== false) {
      pushSheetHistory([{
        rowId: row.sku,
        columnId: `${container.name}::inb_qty`,
        before: String(oldQty),
        after: String(nextQty),
      }]);
    }

    const oldAllocatedQty = previous?.allocated_remaining_qty ?? raw.allocated_remaining_qty ?? 0;
    const optimisticOverride: QtyOverride = {
      inbound_qty: nextQty === 0 ? null : nextQty,
      avail_qty: nextQty === 0 ? null : nextQty,
      cbm: nextQty === 0 ? null : nextQty * (previous?.cbm_unit ?? raw.cbm_unit ?? row.cbm_per_unit ?? 0),
      cbm_unit: previous?.cbm_unit ?? raw.cbm_unit,
      item_id: nextQty === 0 ? undefined : itemId,
      allocated_remaining_qty: nextQty === 0 ? 0 : oldAllocatedQty,
    };
    const nextOverrides = new Map(qtyOverridesRef.current).set(key, optimisticOverride);
    qtyOverridesRef.current = nextOverrides;
    lastChainedQtyOverridesRef.current = nextOverrides;
    const optimisticChainMap = new Map(chainMapRef.current).set(
      row.sku,
      computeContainerChain(row, containers, nextOverrides, seasonalFactors),
    );
    chainMapRef.current = optimisticChainMap;
    const immediateColumns = [`${container.name}::inb_qty`];
    gridRef.current?.api.refreshCells({
      rowNodes: [gridRef.current.api.getRowNode(row.sku)].filter((node) => node !== undefined),
      columns: immediateColumns,
      force: true,
    });
    scheduleQtyRenderSync();

    // Keep keyboard entry responsive: the grid is updated optimistically and
    // persistence finishes in the background. A failed request rolls back
    // only if this cell has not been edited again in the meantime.
    const previousPersistence = qtyPersistenceQueueRef.current.get(key) ?? Promise.resolve();
    const persistence = previousPersistence.catch(() => {}).then(async () => {
      try {
        let json: { success: boolean; qty?: number; total_cbm?: number; item_id?: number; allocated_qty?: number };
        const serverItemId = qtyServerItemIdsRef.current.get(key) ?? itemId;
        if (serverItemId && nextQty === 0) {
          json = await fetch(apiPath(`/api/planning/containers/items/${serverItemId}`), {
            method: "DELETE",
            headers: DEMAND_PLANNING_MUTATION_HEADER,
          }).then((response) => response.json());
        } else if (serverItemId) {
          json = await fetch(apiPath(`/api/planning/containers/items/${serverItemId}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
            body: JSON.stringify({ qty: nextQty }),
          }).then((response) => response.json());
        } else if (nextQty > 0) {
          json = await fetch(apiPath("/api/planning/containers/items"), {
            method: "POST",
            headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
            body: JSON.stringify({
              container_id: container.container_id,
              master_sku: row.sku,
              qty: nextQty,
              cbm_unit: previous?.cbm_unit ?? raw.cbm_unit ?? row.cbm_per_unit ?? 0,
            }),
          }).then((response) => response.json());
        } else {
          json = { success: true, qty: 0, allocated_qty: 0 };
        }
        if (!json.success) throw new Error("Failed to save Con. Qty");
        if (nextQty === 0) qtyServerItemIdsRef.current.delete(key);
        else if (json.item_id ?? serverItemId) qtyServerItemIdsRef.current.set(key, (json.item_id ?? serverItemId)!);
        if (qtyOverridesRef.current.get(key) !== optimisticOverride) return;

        const nextAllocatedQty = nextQty === 0 ? 0 : (json.allocated_qty ?? oldAllocatedQty);
        const confirmedOverride: QtyOverride = {
          ...optimisticOverride,
          inbound_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
          avail_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
          cbm: nextQty === 0 ? null : (json.total_cbm ?? optimisticOverride.cbm),
          item_id: nextQty === 0 ? undefined : (json.item_id ?? serverItemId),
          allocated_remaining_qty: nextAllocatedQty,
        };
        // A successful delete is already fully represented by the optimistic
        // value, so avoid a second expensive grid render for every deleted cell.
        if (nextQty !== 0) {
          const displayValueChanged = confirmedOverride.inbound_qty !== optimisticOverride.inbound_qty
            || confirmedOverride.cbm !== optimisticOverride.cbm;
          const chainValueChanged = confirmedOverride.allocated_remaining_qty !== optimisticOverride.allocated_remaining_qty
            || confirmedOverride.inbound_qty !== optimisticOverride.inbound_qty;
          let confirmed = qtyOverridesRef.current;
          if (displayValueChanged) {
            confirmed = new Map(confirmed).set(key, confirmedOverride);
            qtyOverridesRef.current = confirmed;
            lastChainedQtyOverridesRef.current = confirmed;
            gridRef.current?.api.refreshCells({
              rowNodes: [gridRef.current.api.getRowNode(row.sku)].filter((node) => node !== undefined),
              columns: immediateColumns,
              force: true,
            });
            scheduleQtyRenderSync();
          } else {
            // Server IDs and allocation metadata are needed by the next edit,
            // but do not require rebuilding hundreds of AG Grid columns.
            Object.assign(optimisticOverride, confirmedOverride);
          }
          if (chainValueChanged) {
            chainMapRef.current = new Map(chainMapRef.current).set(
              row.sku,
              computeContainerChain(row, containers, confirmed, seasonalFactors),
            );
            gridRef.current?.api.refreshCells({
              rowNodes: [gridRef.current.api.getRowNode(row.sku)].filter((node) => node !== undefined),
              columns: immediateColumns,
              force: true,
            });
            scheduleQtyRenderSync();
          }
        }

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
      } catch {
        if (qtyOverridesRef.current.get(key) !== optimisticOverride) return;
        const rolledBack = new Map(qtyOverridesRef.current);
        if (previous === undefined) rolledBack.delete(key);
        else rolledBack.set(key, previous);
        qtyOverridesRef.current = rolledBack;
        lastChainedQtyOverridesRef.current = rolledBack;
        const rolledBackChainMap = new Map(chainMapRef.current).set(
          row.sku,
          computeContainerChain(row, containers, rolledBack, seasonalFactors),
        );
        chainMapRef.current = rolledBackChainMap;
        gridRef.current?.api.refreshCells({
          rowNodes: [gridRef.current.api.getRowNode(row.sku)].filter((node) => node !== undefined),
          columns: immediateColumns,
          force: true,
        });
        scheduleQtyRenderSync();
      }
    });
    qtyPersistenceQueueRef.current.set(key, persistence);
    void persistence.finally(() => {
      if (qtyPersistenceQueueRef.current.get(key) === persistence) qtyPersistenceQueueRef.current.delete(key);
    });
    return true;
  }, [canEditPlanning, containers, pushSheetHistory, scheduleQtyRenderSync, seasonalFactors]);

const saveMemo = useCallback(async (row: DemandRow, memo: string): Promise<void> => {
    if (!canEditPlanning || !onSkuCellNoteChange) return;
    await onSkuCellNoteChange(row.sku, memo);
    // rowOverrides만 업데이트 — refreshCells 호출 안 함 (팝업 열린 상태 유지)
    setRowOverrides((cur) => {
      const map = new Map(cur);
      map.set(row.sku, { ...(cur.get(row.sku) ?? {}), memo });
      return map;
    });
  }, [canEditPlanning, onSkuCellNoteChange]);

  const saveWorkNote = useCallback(async (
    row: DemandRow,
    note: string,
    slot: 1 | 2 | 3 = 1,
    options: { recordHistory?: boolean } = {},
  ): Promise<boolean> => {
    if (!canEditPlanning || !onSkuWorkNoteChange) return false;
    const normalizedNote = note.trim().replace(/\s*[\r\n]+\s*/g, " ");
    await onSkuWorkNoteChange(row.sku, normalizedNote, slot);
    if (options.recordHistory !== false) {
      const columnId = slot === 2 ? "workflow_note_2" : slot === 3 ? "workflow_note_3" : "workflow_note";
      const before = slot === 2 ? row.workflow_note_2 ?? "" : slot === 3 ? row.workflow_note_3 ?? "" : row.workflow_note ?? "";
      pushSheetHistory([{ rowId: row.sku, columnId, before, after: normalizedNote }]);
    }
    return true;
  }, [canEditPlanning, onSkuWorkNoteChange, pushSheetHistory]);

  // Paste and fill both need to know, for an arbitrary "rowId::columnId" key,
  // whether it's one of the few genuinely-editable cells (Con. Qty, CBM,
  // Note) and what to call to write it — everything else is read-only and
  // silently skipped rather than rejected, so a pasted block over a mixed
  // selection still fills in whatever it can.
  const resolveEditableTarget = useCallback((rowId: string, columnId: string): EditableCellTarget | null => {
    if (!canEditPlanning) return null;
    const api = gridRef.current?.api;
    const row = api?.getRowNode(rowId)?.data;
    if (!row) return null;
    if (columnId === "cbm") return { kind: "cbm", row };
    if (columnId === "tavg_c") return { kind: "tavg", row };
    if (columnId === "workflow_note") return { kind: "note", row, slot: 1 };
    if (columnId === "workflow_note_2") return { kind: "note", row, slot: 2 };
    if (columnId === "workflow_note_3") return { kind: "note", row, slot: 3 };
    if (columnId.endsWith("::inb_qty")) {
      const containerName = columnId.slice(0, -"::inb_qty".length);
      const container = containers.find((item) => item.name === containerName);
      // Final (packing_received) remains editable; only containers that have
      // already shipped are locked against Con. Qty changes.
      if (!container || container.status === "baseline" || container.status === "shipped" || !container.container_id) return null;
      const raw = row.containers?.[containerName] ?? {
        item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
        allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
        inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
      };
      return { kind: "qty", row, container, raw };
    }
    return null;
  }, [canEditPlanning, containers]);

  const applyValueToTarget = useCallback(async (
    target: EditableCellTarget,
    rawText: string,
    options: { recordSheetHistory?: boolean } = {},
  ): Promise<boolean> => {
    if (target.kind === "note") {
      return saveWorkNote(target.row, rawText, target.slot, { recordHistory: options.recordSheetHistory });
    }
    const trimmed = rawText.trim();
    if (target.kind === "tavg") {
      const value = trimmed === "" ? null : Number(trimmed.replace(/,/g, ""));
      if (value !== null && (!Number.isFinite(value) || value < 0)) return false;
      return saveTotalAvgCurrent(target.row, value, { recordHistory: options.recordSheetHistory });
    }
    const numeric = trimmed === "" ? 0 : Number(trimmed.replace(/,/g, ""));
    if (!Number.isFinite(numeric) || numeric < 0) return false;
    if (target.kind === "cbm") {
      return saveCbm(target.row, numeric, { recordHistory: options.recordSheetHistory });
    }
    return saveQty(target.row, target.container, target.raw, Math.round(numeric), {
      recordHistory: options.recordSheetHistory,
    });
  }, [saveCbm, saveQty, saveTotalAvgCurrent, saveWorkNote]);

  const applyClipboardOperation = useCallback(async (
    operations: Array<{ target: EditableCellTarget; value: string }>,
    formatChanges: PlanningFormatHistoryChange[] = [],
  ) => {
    const changes: SheetHistoryChange[] = [];
    const validOperations: Array<{ target: EditableCellTarget; value: string }> = [];
    const seenKeys = new Set<string>();
    for (const { target, value } of operations) {
      const columnId = target.kind === "qty"
        ? `${target.container.name}::inb_qty`
        : target.kind === "cbm"
          ? "cbm"
          : target.kind === "tavg"
            ? "tavg_c"
            : target.slot === 2 ? "workflow_note_2" : target.slot === 3 ? "workflow_note_3" : "workflow_note";
      const key = `${target.row.sku}::${columnId}`;
      if (seenKeys.has(key)) continue;

      let before: string;
      let after: string;
      if (target.kind === "note") {
        after = value.trim().replace(/\s*[\r\n]+\s*/g, " ");
        if (after.length > 200) continue;
        before = target.slot === 2
          ? target.row.workflow_note_2 ?? ""
          : target.slot === 3 ? target.row.workflow_note_3 ?? "" : target.row.workflow_note ?? "";
      } else if (target.kind === "tavg") {
        const numeric = value.trim() === "" ? null : Number(value.trim().replace(/,/g, ""));
        if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) continue;
        after = numeric === null ? "" : String(numeric);
        before = target.row.total_avg_curr_override == null ? "" : String(target.row.total_avg_curr_override);
      } else {
        const numeric = value.trim() === "" ? 0 : Number(value.trim().replace(/,/g, ""));
        if (!Number.isFinite(numeric) || numeric < 0) continue;
        after = String(target.kind === "qty" ? Math.round(numeric) : numeric);
        if (target.kind === "cbm") {
          before = String(target.row.cbm_per_unit ?? 0);
        } else {
          const qtyKey = `${target.row.sku}::${target.container.name}`;
          const override = qtyOverridesRef.current.get(qtyKey);
          before = String(override !== undefined ? override.inbound_qty ?? 0 : target.raw.inbound_qty ?? 0);
        }
      }
      seenKeys.add(key);
      changes.push({ rowId: target.row.sku, columnId, before, after });
      validOperations.push({ target, value: after });
    }
    const results = await Promise.allSettled(
      validOperations.map(({ target, value }) => applyValueToTarget(target, value, { recordSheetHistory: false })),
    );
    const successfulValueChanges = changes.filter((_change, index) => {
      const result = results[index];
      return result?.status === "fulfilled" && result.value;
    });
    if (formatChanges.length) onApplyFormatHistoryChanges?.(formatChanges, "redo");
    pushHistoryEntry({ valueChanges: successfulValueChanges, formatChanges });
    return results;
  }, [applyValueToTarget, onApplyFormatHistoryChanges, pushHistoryEntry]);

  // Delete/Backspace clears Con. Qty, notes, and a T. Avg manual override.
  // CBM remains protected from accidental bulk deletion.
  const collectDeletableTargets = useCallback((): EditableCellTarget[] => {
    const targets: EditableCellTarget[] = [];
    for (const selectedKey of selectedCellsRef.current) {
      const separator = selectedKey.indexOf("::");
      if (separator < 0) continue;
      const editTarget = resolveEditableTarget(
        selectedKey.slice(0, separator),
        selectedKey.slice(separator + 2),
      );
      if (editTarget?.kind === "qty" || editTarget?.kind === "note" || editTarget?.kind === "tavg") targets.push(editTarget);
    }
    return targets;
  }, [resolveEditableTarget]);

  // Shared by the Delete/Backspace shortcut below and the Edit menu's Delete
  // item — same action, two triggers.
  const performDelete = useCallback((): boolean => {
    if (!canEditPlanning || clearingSelectedEditableCellsRef.current) return false;
    const targets = collectDeletableTargets();
    if (!targets.length) return false;
    clearingSelectedEditableCellsRef.current = true;
    void applyClipboardOperation(targets.map((target) => ({ target, value: "" })))
      .finally(() => {
        clearingSelectedEditableCellsRef.current = false;
      });
    return true;
  }, [applyClipboardOperation, canEditPlanning, collectDeletableTargets]);

  useEffect(() => {
    const handleSelectedEditableCellDelete = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!performDelete()) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleSelectedEditableCellDelete, true);
    return () => window.removeEventListener("keydown", handleSelectedEditableCellDelete, true);
  }, [performDelete]);

  useEffect(() => {
    const handleSheetSelectionKeyboard = (event: KeyboardEvent) => {
      if (!canEditPlanning || event.ctrlKey || event.metaKey || event.altKey || activeQtyEditorKey) return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      const active = activeSelectedCellRef.current;
      if (!active || !selectedCellsRef.current.has(`${active.rowId}::${active.columnId}`)) return;

      if (event.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        // Range selection must not depend on the current cell renderer still
        // being mounted. A forced refresh after the first Shift+Arrow can
        // briefly recreate Note renderers, which previously made rapid range
        // extension stop after one row.
        if (!resolveEditableTarget(active.rowId, active.columnId)) return;
        if (!extendSheetCellSelection(event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight")) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const editor = getActiveCellEditor();
      if (!editor) return;
      if (event.key === "F2") {
        editor.open();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Enter") {
        const moved = editor.kind === "qty" ? navigateActiveQtyCell("Enter") : navigateActiveBaseEditorCell();
        if (!moved) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (editor.kind === "qty" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        if (!navigateActiveQtyCell(event.key as QtyNavigationKey)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const replacementValue = editor.kind === "qty"
        ? (/^\d$/.test(event.key) ? event.key : null)
        : editor.kind === "cbm" || editor.kind === "tavg"
          ? (/^[\d.]$/.test(event.key) ? event.key : null)
          : event.key.length === 1 ? event.key : null;
      if (replacementValue === null) return;
      editor.open(replacementValue);
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleSheetSelectionKeyboard, true);
    return () => window.removeEventListener("keydown", handleSheetSelectionKeyboard, true);
  }, [canEditPlanning, extendSheetCellSelection, getActiveCellEditor, navigateActiveBaseEditorCell, navigateActiveQtyCell, resolveEditableTarget]);

  const getSelectedCellsTsv = useCallback((): string | null => {
    const bounds = getSelectionBoundsOrdered();
    if (!bounds) return null;
    const { rowIds, columnIds } = bounds;
    return rowIds.map((rowId) => columnIds.map((columnId) => {
      const key = `${rowId}::${columnId}`;
      return selectedCellsRef.current.has(key) ? getCellCopyValue(rowId, columnId) : "";
    }).join("\t")).join("\n");
  }, [getCellCopyValue, getSelectionBoundsOrdered]);

  const getSelectedClipboardPayload = useCallback((): SheetClipboardPayload | null => {
    const bounds = getSelectionBoundsOrdered();
    const text = getSelectedCellsTsv();
    const api = gridRef.current?.api;
    if (!bounds || text === null || !api) return null;
    return {
      text,
      formats: bounds.rowIds.map((rowId) => {
        const row = api.getRowNode(rowId)?.data;
        return bounds.columnIds.map((columnId) => {
          if (!row || !selectedCellsRef.current.has(`${rowId}::${columnId}`)) return null;
          return {
            background: columnMenuFillColor(columnId, row) || null,
            textColor: columnMenuTextColor(columnId, row) || null,
          };
        });
      }),
    };
  }, [columnMenuFillColor, columnMenuTextColor, getSelectedCellsTsv, getSelectionBoundsOrdered]);

  const buildCellFormatChanges = useCallback((targets: Array<{
    rowId: string;
    columnId: string;
    format: SheetClipboardFormat;
  }>): PlanningFormatHistoryChange[] => {
    const changes: PlanningFormatHistoryChange[] = [];
    const seen = new Set<string>();
    for (const { rowId, columnId, format } of targets) {
      const key = `${rowId}::${columnId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      changes.push({
        kind: "cell-background",
        key,
        before: cellColorsRef.current[key] ?? null,
        after: format.background,
      });

      const beforeTextFormat = cellTextFormatsRef.current[key] ?? null;
      const nextTextFormat = { ...(beforeTextFormat ?? {}) };
      if (format.textColor) nextTextFormat.color = format.textColor;
      else delete nextTextFormat.color;
      changes.push({
        kind: "cell-text-format",
        key,
        before: beforeTextFormat,
        after: Object.keys(nextTextFormat).length ? nextTextFormat : null,
      });
    }
    return changes;
  }, []);

  const hasEffectiveFormatChanges = useCallback((changes: PlanningFormatHistoryChange[]) =>
    changes.some((change) => JSON.stringify(change.before) !== JSON.stringify(change.after)), []);

  const selectionHasCuttableFormat = useCallback(() => [...selectedCellsRef.current].some((key) =>
    Boolean(cellColorsRef.current[key] || cellTextFormatsRef.current[key]?.color)), []);

  // Shared by the Ctrl+X/C/V shortcuts below and the Cut/Copy/Paste
  // right-click menu (ClipboardContextMenu) — same action, two triggers.
  const performCopy = useCallback(async () => {
    const payload = getSelectedClipboardPayload();
    if (!payload) return;
    await copyText(payload.text)
      .then(() => { sheetClipboardRef.current = payload; })
      .catch(() => {});
  }, [getSelectedClipboardPayload]);

  const performCut = useCallback(async () => {
    if (!canEditPlanning) return;
    const payload = getSelectedClipboardPayload();
    if (!payload) return;
    const operations: Array<{ target: EditableCellTarget; value: string }> = [];
    const formatTargets: Array<{ rowId: string; columnId: string; format: SheetClipboardFormat }> = [];
    for (const key of selectedCellsRef.current) {
      const separator = key.indexOf("::");
      if (separator < 0) continue;
      const rowId = key.slice(0, separator);
      const columnId = key.slice(separator + 2);
      const target = resolveEditableTarget(rowId, columnId);
      if (target) operations.push({ target, value: "" });
      formatTargets.push({ rowId, columnId, format: { background: null, textColor: null } });
    }
    const formatChanges = buildCellFormatChanges(formatTargets);
    if (!operations.length && !hasEffectiveFormatChanges(formatChanges)) return;
    await copyText(payload.text)
      .then(() => {
        sheetClipboardRef.current = payload;
        return applyClipboardOperation(operations, formatChanges);
      })
      .catch(() => {});
  }, [applyClipboardOperation, buildCellFormatChanges, canEditPlanning, getSelectedClipboardPayload, hasEffectiveFormatChanges, resolveEditableTarget]);

  const performPaste = useCallback(async () => {
    if (!canEditPlanning) return;
    const bounds = getSelectionBoundsOrdered();
    if (!bounds) return;
    const api = gridRef.current?.api;
    if (!api) return;

    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const copiedPayload = sheetClipboardRef.current?.text === text ? sheetClipboardRef.current : null;
    if (!text && !copiedPayload) return;
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const grid = lines.map((line) => line.split("\t"));
    const isSingleValue = grid.length === 1 && grid[0].length === 1;
    const copiedFormats = copiedPayload?.formats ?? null;

    const operations: Array<{ target: EditableCellTarget; value: string }> = [];
    const formatTargets: Array<{ rowId: string; columnId: string; format: SheetClipboardFormat }> = [];
    if (isSingleValue) {
      const value = grid[0][0];
      const copiedFormat = copiedFormats?.[0]?.[0] ?? null;
      for (const key of selectedCellsRef.current) {
        const separator = key.indexOf("::");
        if (separator < 0) continue;
        const rowId = key.slice(0, separator);
        const columnId = key.slice(separator + 2);
        const editTarget = resolveEditableTarget(rowId, columnId);
        if (editTarget) operations.push({ target: editTarget, value });
        if (copiedFormat) formatTargets.push({ rowId, columnId, format: copiedFormat });
      }
    } else {
      const displayedColumns = api.getAllDisplayedColumns();
      const startColIndex = displayedColumns.findIndex((column) => column.getColId() === bounds.columnIds[0]);
      const startRowIndex = api.getRowNode(bounds.rowIds[0])?.rowIndex ?? -1;
      if (startColIndex < 0 || startRowIndex < 0) return;
      grid.forEach((line, rowOffset) => {
        const rowNode = api.getDisplayedRowAtIndex(startRowIndex + rowOffset);
        const rowId = rowNode?.data?.sku;
        if (!rowId) return;
        line.forEach((value, colOffset) => {
          const column = displayedColumns[startColIndex + colOffset];
          if (!column) return;
          const columnId = column.getColId();
          const editTarget = resolveEditableTarget(rowId, columnId);
          if (editTarget) operations.push({ target: editTarget, value });
          const copiedFormat = copiedFormats?.[rowOffset]?.[colOffset] ?? null;
          if (copiedFormat) formatTargets.push({ rowId, columnId, format: copiedFormat });
        });
      });
    }
    await applyClipboardOperation(operations, buildCellFormatChanges(formatTargets));
  }, [applyClipboardOperation, buildCellFormatChanges, canEditPlanning, getSelectionBoundsOrdered, resolveEditableTarget]);

  const performFillDown = useCallback(() => {
    if (!canEditPlanning) return false;
    const bounds = getSelectionBoundsOrdered();
    if (!bounds || bounds.rowIds.length < 2) return false;

    const operations: Array<{ target: EditableCellTarget; value: string }> = [];
    for (const columnId of bounds.columnIds) {
      const sourceRowId = bounds.rowIds.find((rowId) => selectedCellsRef.current.has(`${rowId}::${columnId}`));
      if (!sourceRowId) continue;
      const sourceValue = getCellCopyValue(sourceRowId, columnId);
      let passedSource = false;
      for (const rowId of bounds.rowIds) {
        if (!selectedCellsRef.current.has(`${rowId}::${columnId}`)) continue;
        if (!passedSource) {
          passedSource = rowId === sourceRowId;
          continue;
        }
        const target = resolveEditableTarget(rowId, columnId);
        if (target) operations.push({ target, value: sourceValue });
      }
    }
    if (!operations.length) return false;
    void applyClipboardOperation(operations);
    return true;
  }, [applyClipboardOperation, canEditPlanning, getCellCopyValue, getSelectionBoundsOrdered, resolveEditableTarget]);

  useEffect(() => {
    const handleCopy = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      const tsv = getSelectedCellsTsv();
      if (tsv === null) return;
      event.preventDefault();
      void performCopy();
    };
    window.addEventListener("keydown", handleCopy, true);
    return () => window.removeEventListener("keydown", handleCopy, true);
  }, [getSelectedCellsTsv, performCopy]);

  useEffect(() => {
    const handleCut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "x") return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!canEditPlanning) return;
      let hasEditableTarget = false;
      for (const key of selectedCellsRef.current) {
        const separator = key.indexOf("::");
        if (separator < 0) continue;
        if (resolveEditableTarget(key.slice(0, separator), key.slice(separator + 2))) {
          hasEditableTarget = true;
          break;
        }
      }
      if (!hasEditableTarget && !selectionHasCuttableFormat()) return;
      event.preventDefault();
      event.stopPropagation();
      void performCut();
    };
    window.addEventListener("keydown", handleCut, true);
    return () => window.removeEventListener("keydown", handleCut, true);
  }, [canEditPlanning, performCut, resolveEditableTarget, selectionHasCuttableFormat]);

  useEffect(() => {
    const handlePaste = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "v") return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!canEditPlanning) return;
      const bounds = getSelectionBoundsOrdered();
      if (!bounds) return;
      event.preventDefault();
      void performPaste();
    };
    window.addEventListener("keydown", handlePaste, true);
    return () => window.removeEventListener("keydown", handlePaste, true);
  }, [canEditPlanning, getSelectionBoundsOrdered, performPaste]);

  useEffect(() => {
    const handleFillDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "d") return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!performFillDown()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleFillDown, true);
    return () => window.removeEventListener("keydown", handleFillDown, true);
  }, [performFillDown]);

  const applySheetHistoryEntry = useCallback(async (entry: SheetHistoryEntry, direction: "undo" | "redo") => {
    const results = await Promise.all(entry.valueChanges.map((change) => {
      const target = resolveEditableTarget(change.rowId, change.columnId);
      if (!target) return Promise.resolve(false);
      const value = direction === "undo" ? change.before : change.after;
      return applyValueToTarget(target, value, { recordSheetHistory: false });
    }));
    if (!results.every(Boolean)) return false;
    if (entry.formatChanges.length) {
      if (!onApplyFormatHistoryChanges) return false;
      onApplyFormatHistoryChanges(entry.formatChanges, direction);
    }
    return true;
  }, [applyValueToTarget, onApplyFormatHistoryChanges, resolveEditableTarget]);

  // Shared by the Ctrl+Z/Y shortcut below and the Edit menu's Undo/Redo items
  // — same action, two triggers. Returns whether an entry was actually
  // popped (and thus whether the caller should preventDefault), independent
  // of whether applying it eventually succeeds.
  const runSheetHistoryStep = useCallback((direction: "undo" | "redo"): boolean => {
    if (!canEditPlanning || sheetHistoryBusyRef.current) return false;
    const source = direction === "undo" ? sheetUndoStackRef.current : sheetRedoStackRef.current;
    const entry = source.pop();
    if (!entry) return false;

    sheetHistoryBusyRef.current = true;
    void applySheetHistoryEntry(entry, direction)
      .then((success) => {
        if (success) {
          const destination = direction === "undo" ? sheetRedoStackRef : sheetUndoStackRef;
          destination.current = [...destination.current.slice(-(MAX_SHEET_HISTORY - 1)), entry];
        } else {
          source.push(entry);
        }
      })
      .finally(() => {
        sheetHistoryBusyRef.current = false;
      });
    return true;
  }, [applySheetHistoryEntry, canEditPlanning]);

  const performUndo = useCallback(() => { runSheetHistoryStep("undo"); }, [runSheetHistoryStep]);
  const performRedo = useCallback(() => { runSheetHistoryStep("redo"); }, [runSheetHistoryStep]);

  useEffect(() => {
    const handleSheetHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const direction = key === "y" || (key === "z" && event.shiftKey) ? "redo" : key === "z" ? "undo" : null;
      if (!direction) return;
      const focusEl = event.target as HTMLElement | null;
      if (focusEl?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!runSheetHistoryStep(direction)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleSheetHistoryShortcut, true);
    return () => window.removeEventListener("keydown", handleSheetHistoryShortcut, true);
  }, [runSheetHistoryStep]);

  const autoFill = useCallback(async (
    container: ContainerMeta,
    containerIndex: number,
    force = false,
  ): Promise<void> => {
    if (!canEditPlanning) return;
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
        const cat = (r.category_code ?? "").toLowerCase();
        if (!checkedBaseCategories(categoryFilter).some((c) => c === cat)) return false;
        if ((r.cbm_per_unit ?? 0) <= 0 || r.total_avg_curr <= 0) return false;
        const key = `${r.sku}::${container.name}`;
        const override = qtyOverrides.get(key);
        const existingQty = override !== undefined ? override.inbound_qty ?? 0 : r.containers?.[container.name]?.inbound_qty ?? 0;
        if (!force && existingQty > 0) {
          const cbmUnit = override?.cbm_unit
            ?? r.containers?.[container.name]?.cbm_unit
            ?? r.cbm_per_unit
            ?? 0;
          usedCbm += existingQty * cbmUnit;
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
          cbm_per_unit: row.cbm_per_unit ?? 0,
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
          const cbmUnit = raw?.containers?.[container.name]?.cbm_unit ?? raw?.cbm_per_unit ?? 0;
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
      headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
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
  }, [canEditPlanning, categoryFilter, containers, chainMap, visibleRows, gradient, gradientSC, qtyOverrides, seasonalFactors]);

  const calculateTargetOrders = useCallback((
    container: ContainerMeta,
    containerIndex: number,
    resolveTargetDays: (row: DemandRow) => number,
    capacityMode: CapacityMode,
  ): TargetOrderPreview => {
    const prevContainer = containers[containerIndex - 1];
    const capacityCbm = Number(container.cbm_cap) || 0;
    if (!prevContainer) {
      return { orders: [], skuCount: 0, totalQty: 0, totalCbm: 0, capacityCbm, excessCbm: 0 };
    }

    const seasonFactor = seasonalFactorForEta(container.eta, seasonalFactors);
    const gapBeforeDays = Math.round(
      (new Date(container.eta).getTime() - new Date(prevContainer.eta).getTime()) / 86400000
    );
    const rows = rowsInDisplayOrder().filter((row) => {
      const cat = (row.category_code ?? "").toLowerCase();
      if (!checkedBaseCategories(categoryFilter).some((c) => c === cat)) return false;
      if ((row.cbm_per_unit ?? 0) <= 0 || row.total_avg_curr <= 0) return false;
      return true;
    });
    const orders: TargetOrder[] = [];
    let usedCbm = 0;

    for (const row of rows) {
      const targetDays = resolveTargetDays(row);
      if (!Number.isFinite(targetDays) || targetDays <= 0) continue;

      const adjDaily = row.total_avg_curr * seasonFactor;
      const step = Math.max(1, row.order_multiple ?? 1);
      const moq = Math.max(1, row.moq ?? 1);
      const prev = chainMap.get(row.sku)?.get(prevContainer.name);
      const prevCarryover = prev?.carryover ?? 0;
      const backorder = prev?.backorder ?? 0;
      const remainingAtArrival = Math.max(0, prevCarryover - adjDaily * gapBeforeDays);
      const need = adjDaily * targetDays + backorder - remainingAtArrival;
      if (need <= 0) continue;

      const cbmUnit = row.cbm_per_unit ?? 0;
      const remainingCbm = capacityMode === "fit" ? capacityCbm - usedCbm : Number.POSITIVE_INFINITY;
      if (remainingCbm <= 0) continue;

      let qty = Math.ceil(Math.max(need, moq) / step) * step;
      if (capacityMode === "fit" && qty * cbmUnit > remainingCbm) {
        const maxQty = Math.floor(remainingCbm / cbmUnit / step) * step;
        if (maxQty < moq) continue;
        qty = maxQty;
      }
      if (qty <= 0) continue;

      usedCbm += qty * cbmUnit;
      orders.push({ row, qty, cbmUnit });
    }

    const totalQty = orders.reduce((sum, order) => sum + order.qty, 0);
    const totalCbm = orders.reduce((sum, order) => sum + order.qty * order.cbmUnit, 0);
    return {
      orders,
      skuCount: orders.length,
      totalQty,
      totalCbm,
      capacityCbm,
      excessCbm: Math.max(0, totalCbm - capacityCbm),
    };
  }, [categoryFilter, chainMap, containers, rowsInDisplayOrder, seasonalFactors]);

  const applyTargetOrders = useCallback((container: ContainerMeta, preview: TargetOrderPreview): void => {
    if (!canEditPlanning) return;
    setQtyOverrides((current) => {
      const next = new Map(current);
      for (const { row, qty, cbmUnit } of preview.orders) {
        next.set(`${row.sku}::${container.name}`, {
          inbound_qty: qty,
          avail_qty: qty,
          cbm: qty * cbmUnit,
          cbm_unit: cbmUnit,
          item_id: row.containers?.[container.name]?.item_id ?? undefined,
          allocated_remaining_qty: row.containers?.[container.name]?.allocated_remaining_qty ?? null,
        });
      }
      return next;
    });
    setDirtyContainers((current) => new Set(current).add(container.name));
  }, [canEditPlanning]);

  const autoFill2 = useCallback((
    container: ContainerMeta,
    containerIndex: number,
    targetDays: number,
    capacityMode: CapacityMode,
  ): void => {
    applyTargetOrders(
      container,
      calculateTargetOrders(container, containerIndex, () => targetDays, capacityMode),
    );
  }, [applyTargetOrders, calculateTargetOrders]);

  const autoFill3 = useCallback((
    container: ContainerMeta,
    containerIndex: number,
    tiers: SalesTargetTier[],
    capacityMode: CapacityMode,
  ): void => {
    applyTargetOrders(
      container,
      calculateTargetOrders(
        container,
        containerIndex,
        (row) => targetDaysForAverage(row.total_avg_curr ?? 0, tiers),
        capacityMode,
      ),
    );
  }, [applyTargetOrders, calculateTargetOrders]);

  const fixedTargetPreview = useMemo<TargetOrderPreview>(() => {
    if (!fixedTargetDialog) {
      return { orders: [], skuCount: 0, totalQty: 0, totalCbm: 0, capacityCbm: 0, excessCbm: 0 };
    }
    return calculateTargetOrders(
      fixedTargetDialog.container,
      fixedTargetDialog.containerIndex,
      () => fixedTargetDialog.targetDays,
      fixedTargetCapacityMode,
    );
  }, [calculateTargetOrders, fixedTargetCapacityMode, fixedTargetDialog]);

  const backfill3Preview = useMemo<TargetOrderPreview>(() => {
    if (!backfill3Dialog) {
      return { orders: [], skuCount: 0, totalQty: 0, totalCbm: 0, capacityCbm: 0, excessCbm: 0 };
    }
    return calculateTargetOrders(
      backfill3Dialog.container,
      backfill3Dialog.containerIndex,
      (row) => targetDaysForAverage(row.total_avg_curr ?? 0, backfill3Tiers),
      backfill3CapacityMode,
    );
  }, [backfill3CapacityMode, backfill3Dialog, backfill3Tiers, calculateTargetOrders]);


  const buildContainerSaveSummary = useCallback((container: ContainerMeta): string => {
    const rowsBySku = new Map(data.rows.map((row) => [row.sku, row]));
    const lines: string[] = [];
    let totalQty = 0;
    let totalCbm = 0;

    for (const [key, val] of qtyOverrides.entries()) {
      if (!key.endsWith(`::${container.name}`)) continue;
      const qty = val.inbound_qty ?? 0;
      if (qty <= 0) continue;

      const sku = key.slice(0, -(container.name.length + 2));
      const row = rowsBySku.get(sku);
      const currentQty = row?.containers?.[container.name]?.inbound_qty ?? 0;
      const cbmUnit = val.cbm_unit ?? row?.cbm_per_unit ?? 0;
      const cbm = val.cbm ?? qty * cbmUnit;
      const delta = qty - currentQty;

      totalQty += qty;
      totalCbm += cbm;
      lines.push(`${sku}: ${currentQty} -> ${qty} (${delta >= 0 ? "+" : ""}${delta}), CBM ${cbm.toFixed(6)}`);
    }

    if (lines.length === 0) {
      return `${container.name}\n\n저장할 Backfill 수량이 없습니다.\n그래도 변경 상태를 완료 처리하시겠습니까?`;
    }

    return [
      `${container.name} Backfill 저장 전 확인`,
      "",
      `업데이트 SKU: ${lines.length}개`,
      `총 Con. Qty: ${totalQty.toLocaleString()}`,
      `총 CBM: ${totalCbm.toFixed(6)}`,
      "",
      "상세 변경:",
      ...lines,
      "",
      "위 내용으로 저장하시겠습니까?",
    ].join("\n");
  }, [data.rows, qtyOverrides]);

  const saveContainer = useCallback(async (container: ContainerMeta): Promise<void> => {
    if (!canEditPlanning || !container.container_id) return;
    setSavingContainers((s) => new Set(s).add(container.name));
    let saved = false;
    try {
      const items: Array<{ sku: string; qty: number }> = [];
      for (const [key, val] of qtyOverrides.entries()) {
        if (!key.endsWith(`::${container.name}`)) continue;
        const sku = key.slice(0, -(container.name.length + 2));
        if ((val.inbound_qty ?? 0) > 0) items.push({ sku, qty: val.inbound_qty! });
      }
      if (items.length === 0) return;
      const response = await fetch(apiPath(`/api/planning/containers/${container.container_id}/auto-fill`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...DEMAND_PLANNING_MUTATION_HEADER },
        body: JSON.stringify({ items }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean } | null;
      saved = response.ok && result?.success === true;
    } finally {
      setSavingContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
      if (saved) {
        setDirtyContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
      }
    }
  }, [canEditPlanning, qtyOverrides]);

  // The full base-column list minus only the group-visibility filter.
  // Compact mode is deliberately NOT filtered out here: turning it on
  // (`handleCompact` in the dashboard) sets `columnVis[id] = false` for
  // every non-compact column directly, the same way individually hiding a
  // column does — so from this component's side, "hidden by the Compact
  // preset" and "hidden via the right-click menu" are the same state, and
  // both get a restore indicator. Shared by pinning and columnDefs below so
  // the two can't disagree about where a hidden run falls.
  const baseCandidates = useMemo(
    () => ALL_COLS.filter((column) => column.grp === "fix" || groupVis[column.grp]),
    [groupVis],
  );

  const baseHiddenRuns = useMemo(() => {
    const runs: { hiddenIds: string[]; hiddenLabels: string[]; startIndex: number }[] = [];
    let pending: typeof baseCandidates = [];
    let startIndex = -1;
    const flush = () => {
      if (!pending.length) return;
      runs.push({
        hiddenIds: pending.map((c) => c.id),
        hiddenLabels: pending.map((c) => c.label.replace("\n", " ")),
        startIndex,
      });
      pending = [];
    };
    baseCandidates.forEach((column, index) => {
      if (columnVis[column.id] === false) {
        if (!pending.length) startIndex = index;
        pending.push(column);
        return;
      }
      flush();
    });
    flush();
    return runs;
  }, [baseCandidates, columnVis]);

  const pinnedBaseColumnLayout = useMemo(() => {
    const visibleBaseColumns = baseCandidates.filter((column) => columnVis[column.id] !== false);
    const freezeIndex = visibleBaseColumns.findIndex((column) => column.id === freezeUntil);
    if (freezeIndex < 0) return { ids: [] as string[], widths: {} as Record<string, number>, width: 0 };

    const pinnedColumns = visibleBaseColumns.slice(0, freezeIndex + 1);
    const desiredWidths = Object.fromEntries(
      pinnedColumns.map((column) => [
        column.id,
        columnWidths[column.id] ?? baseColumnWidth(column),
      ] as const),
    ) as Record<string, number>;
    const desiredPinnedWidth = Object.values(desiredWidths).reduce((total, width) => total + width, 0);

    return {
      ids: pinnedColumns.map((column) => column.id),
      widths: desiredWidths,
      width: desiredPinnedWidth,
    };
  }, [baseCandidates, columnVis, columnWidths, freezeUntil]);

  // Restore-arrow anchors: rather than reserving a column of its own, a
  // hidden run's restore arrow rides on the header of the real column right
  // after it (or, for a run with nothing after — hiding the last columns —
  // the real column right before it). At most one marker per side per real
  // column; two runs separated by exactly one visible column both anchor to
  // that column, one on each side.
  const baseRestoreMarkers = useMemo(() => {
    const left = new Map<string, HideGapRestoreInfo>();
    const right = new Map<string, HideGapRestoreInfo>();
    for (const run of baseHiddenRuns) {
      const onRestore = () => run.hiddenIds.forEach((id) => onHideColumn?.(id));
      const afterId = baseCandidates[run.startIndex + run.hiddenIds.length]?.id;
      if (afterId) { left.set(afterId, { hiddenLabels: run.hiddenLabels, onRestore }); continue; }
      const beforeId = baseCandidates[run.startIndex - 1]?.id;
      if (beforeId) right.set(beforeId, { hiddenLabels: run.hiddenLabels, onRestore });
    }
    return { left, right };
  }, [baseCandidates, baseHiddenRuns, onHideColumn]);

  const gridMinWidth = Math.max(
    gridWidth,
    pinnedBaseColumnLayout.width + MIN_SCROLLABLE_CENTER_WIDTH,
  );
  const columnDefs = useMemo<Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>>>(() => {
    const pinnedBaseColumnIdSet = new Set(pinnedBaseColumnLayout.ids);

    const buildRealBaseColDef = (column: (typeof baseCandidates)[number]): AgColDef<DemandRow> => {
      const shouldPin = pinnedBaseColumnIdSet.has(column.id);
      const width = shouldPin
        ? pinnedBaseColumnLayout.widths[column.id]
        : columnWidths[column.id] ?? baseColumnWidth(column);
      const defaultHeaderName = column.id === "tavg_p"
        ? "T. Avg 이전"
        : column.id === "tavg_r"
          ? "T. Avg 실제"
          : column.id === "tavg_c"
            ? "T. Avg 현재"
            : column.label.replace("\n", " ");
      const headerName = columnHeaderNames[column.id] ?? defaultHeaderName;
      return {
        colId: column.id,
        headerName,
        headerTooltip: labelWithSalesWindowWeight(column.id, column.label.replace("\n", " "), salesWindowWeights),
        width,
        minWidth: Math.min(36, column.w),
        sortable: false,
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
          if (column.id === "cbm") {
            return params.data.cbm_per_unit ? params.data.cbm_per_unit.toFixed(6) : "";
          }
          return column.val(params.data, params.node?.rowIndex ?? 0, urgStatus(params.data));
        },
        cellRenderer: column.id === "sku"
          ? SkuCellRenderer
          : column.id === "inb_lst"
            ? CopyableCellRenderer
            : column.id === "tavg_c" && canEditPlanning
              ? TotalAvgCurrentCellRenderer
            : column.id === "cbm" && canEditPlanning
              ? CbmCellRenderer
              : workNoteSlotForColumnId(column.id) !== null && canEditPlanning
                ? WorkNoteCellRenderer
                : CellRenderer,
        cellRendererParams: column.id === "sku"
          ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
              sku: params.data?.sku ?? "",
              memo: params.data ? (skuCellNotes[params.data.sku] ?? params.data.memo ?? null) : null,
              onMemoSave: params.data && onSkuCellNoteChange
                ? (memo: string) => saveMemo(params.data!, memo)
                : undefined,
              onCopySelection: performCopy,
            })
          : column.id === "inb_lst"
            ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
                copyValue: params.data?.containers_list ?? "",
                label: "Containers List",
              })
          : column.id === "tavg_c" && canEditPlanning
            ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
                onSave: (value: number | null) => params.data
                  ? saveTotalAvgCurrent(params.data, value)
                  : Promise.resolve(false),
                onRequestEdit: handleQtyEditRequest,
                onSelectCell: selectSingleGridCell,
              })
          : column.id === "cbm" && canEditPlanning
            ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
                onSave: (cbm: number) => params.data ? saveCbm(params.data, cbm) : Promise.resolve(false),
                onRequestEdit: handleQtyEditRequest,
                onSelectCell: selectSingleGridCell,
              })
          : workNoteSlotForColumnId(column.id) !== null && canEditPlanning
            ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
                onSave: (note: string) => params.data
                  ? saveWorkNote(params.data, note, workNoteSlotForColumnId(column.id) ?? 1)
                  : Promise.resolve(false),
                onRequestEdit: handleQtyEditRequest,
                onSelectCell: selectSingleGridCell,
              })
          : undefined,
        headerStyle: () => headerStyleForColor(columnColors[column.id]?.header, columnTextFormatsRef.current[column.id]?.header),
        headerClass: () => [
          columnTextFormatsRef.current[column.id]?.header?.color ? "planning-user-header-text-color" : "",
          baseRestoreMarkers.left.has(column.id) || baseRestoreMarkers.right.has(column.id) ? "planning-hidegap-header" : "",
        ].filter(Boolean).join(" "),
        headerComponent: SelectableHeader,
        headerComponentParams: {
          selectionId: column.id,
          isSelected: () => selectedColumnIdsRef.current.has(column.id),
          subscribeSelection,
          onSelect: handleColumnHeaderSelectFast,
          isFullColumnSelected: () => selectedFullColumnIdsRef.current.has(column.id),
          onFullColumnSelect: handleFullColumnSelectFast,
          onRename: onColumnHeaderRename ?? (() => {}),
          isFiltered: columnFilters.has(column.id),
          onRightClick: (x: number, y: number) => setColumnMenu({ x, y, key: column.id, label: headerName }),
          shouldPreserveContextSelection,
          showMenuButton: false,
          restoreMarkerLeft: baseRestoreMarkers.left.get(column.id),
          restoreMarkerRight: baseRestoreMarkers.right.get(column.id),
        },
        cellClassRules: {
          "planning-user-text-color": (params) => {
            const key = cellColorKey(params.data?.sku, column.id);
            return Boolean(cellTextFormatsRef.current[key]?.color ?? columnTextFormatsRef.current[column.id]?.cell?.color);
          },
        },
        cellStyle: (params) => {
          const key = cellColorKey(params.data?.sku, column.id);
          const selected = selectedCellsRef.current.has(key);
          const fullColumnSelected = selectedFullColumnIdsRef.current.has(column.id);
          const textFormat = { ...(columnTextFormatsRef.current[column.id]?.cell ?? {}), ...(cellTextFormatsRef.current[key] ?? {}) };
          return {
            backgroundColor: selected
              ? SELECTED_CELL_FILL
              : column.id === "tavg_c" && params.data?.total_avg_curr_override != null
                ? "#fecaca"
                : cellColors[key] ?? columnColors[column.id]?.cell ?? TINT_COLORS[column.tint] ?? "#fff",
            ...(textFormat.color ? { color: textFormat.color } : {}),
            ...((textFormat.fontSize ?? column.fontSize) ? { fontSize: textFormat.fontSize ?? column.fontSize } : {}),
            fontWeight: textFormat.bold !== undefined ? (textFormat.bold ? 700 : 400) : column.bold ? 700 : 400,
            textAlign: "center",
            ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
            ...(selected
              ? selectionEdgeStyle(params.api, params.node.rowIndex, params.data?.sku, column.id, selectedCellsRef.current)
              : fullColumnSelected
                ? { boxShadow: "inset 1px 0 #2563EB, inset -1px 0 #2563EB" }
                : {}),
          };
        },
      };
    };

    const groups: Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>> = [];
    let currentGroupId: string | null = null;
    let currentGroupChildren: AgColDef<DemandRow>[] = [];

    const flushGroup = () => {
      if (currentGroupId === null || currentGroupChildren.length === 0) return;
      const groupId = currentGroupId;
      const groupColumnIds = currentGroupChildren
        .map((column) => column.colId)
        .filter((id): id is string => Boolean(id));
      const groupHeaderName = columnHeaderNames[`group:${groupId}`] ?? GROUP_LABELS[groupId] ?? groupId;
      groups.push({
        groupId,
        headerName: groupHeaderName,
        headerGroupComponent: EditableGroupHeader,
        headerGroupComponentParams: {
          selectionId: `group:${groupId}`,
          onRename: onColumnHeaderRename ?? (() => {}),
          onRightClick: (x: number, y: number) => {
            setColumnMenu(null);
            setFilterOpenKey(null);
            setGroupMenu({ x, y, label: groupHeaderName, columnIds: groupColumnIds });
          },
        },
        children: currentGroupChildren,
      });
      currentGroupChildren = [];
    };

    for (const column of baseCandidates) {
      if (columnVis[column.id] === false) continue;
      if (column.grp !== currentGroupId) { flushGroup(); currentGroupId = column.grp; }
      currentGroupChildren.push(buildRealBaseColDef(column));
    }
    flushGroup();

    if (groupVis.con) {
      // Render order: baseline first, then all real containers.
      const renderOrder = [
        ...containers.filter((c) => c.status === "baseline"),
        ...containers.filter((c) => c.status !== "baseline"),
      ];
      for (const [containerIndex, container] of renderOrder.entries()) {
        if (container.status === "baseline" && hiddenBases.has("Base")) continue;
        const baseline = container.status === "baseline";
        const qtyEditable = canEditPlanning && !baseline && container.status !== "shipped";
        const globallyVisibleSubColumns = conCandidates.filter((column) => columnVis[`con:${column.id}`] !== false);
        const containerHiddenRuns: { hiddenIds: string[]; hiddenLabels: string[]; startIndex: number }[] = [];
        let pendingHiddenColumns: typeof globallyVisibleSubColumns = [];
        let hiddenRunStartIndex = -1;
        const flushContainerHiddenRun = () => {
          if (!pendingHiddenColumns.length) return;
          containerHiddenRuns.push({
            hiddenIds: pendingHiddenColumns.map((column) => column.id),
            hiddenLabels: pendingHiddenColumns.map((column) => column.label.replace("\n", " ")),
            startIndex: hiddenRunStartIndex,
          });
          pendingHiddenColumns = [];
        };
        globallyVisibleSubColumns.forEach((column, index) => {
          if (hiddenContainerColumns.has(`${container.name}::${column.id}`)) {
            if (!pendingHiddenColumns.length) hiddenRunStartIndex = index;
            pendingHiddenColumns.push(column);
          } else {
            flushContainerHiddenRun();
          }
        });
        flushContainerHiddenRun();
        const containerRestoreMarkers = { left: new Map<string, HideGapRestoreInfo>(), right: new Map<string, HideGapRestoreInfo>() };
        for (const run of containerHiddenRuns) {
          const onRestore = () => onToggleContainerColumns?.(run.hiddenIds.map((id) => `${container.name}::${id}`));
          const afterId = globallyVisibleSubColumns[run.startIndex + run.hiddenIds.length]?.id;
          if (afterId) {
            containerRestoreMarkers.left.set(afterId, { hiddenLabels: run.hiddenLabels, onRestore });
            continue;
          }
          const beforeId = globallyVisibleSubColumns[run.startIndex - 1]?.id;
          if (beforeId) containerRestoreMarkers.right.set(beforeId, { hiddenLabels: run.hiddenLabels, onRestore });
        }

        const buildRealSubColDef = (column: (typeof conCandidates)[number]): AgColDef<DemandRow> => {
          const physicalColumnId = `${container.name}::${column.id}`;
          const sharedColumnId = `con:${column.id}`;
          return ({
          // headerClass (text-color + start/end boundary) is assigned in the
          // combined post-pass below, once each column's final index in the
          // real+indicator list is known.
          headerStyle: () => headerStyleForColor(
            columnColors[physicalColumnId]?.header ?? columnColors[sharedColumnId]?.header,
            columnTextFormatsRef.current[physicalColumnId]?.header ?? columnTextFormatsRef.current[sharedColumnId]?.header,
          ),
          colId: physicalColumnId,
          headerName: columnHeaderNames[`con:${column.id}`] ?? (column.id === "oo"
            ? "Open Ord"
            : column.id === "remaining"
              ? "Rem. Qty"
              : column.label.replace("\n", " ")),
          headerTooltip: column.label.replace("\n", " "),
          headerComponent: SelectableHeader,
          headerComponentParams: {
            selectionId: physicalColumnId,
            renameId: sharedColumnId,
            isSelected: () => selectedColumnIdsRef.current.has(physicalColumnId),
            subscribeSelection,
            onSelect: handleColumnHeaderSelectFast,
            isFullColumnSelected: () => selectedFullColumnIdsRef.current.has(physicalColumnId),
            onFullColumnSelect: handleFullColumnSelectFast,
            onRename: onColumnHeaderRename ?? (() => {}),
            isFiltered: columnFilters.has(`${container.name}::${column.id}`),
            onRightClick: (x: number, y: number) => setColumnMenu({
              x, y,
              key: `${container.name}::${column.id}`,
              label: `${container.name} · ${column.label.replace("\n", " ")}`,
            }),
            shouldPreserveContextSelection,
            restoreMarkerLeft: containerRestoreMarkers.left.get(column.id) ?? conRestoreMarkers.left.get(column.id),
            restoreMarkerRight: containerRestoreMarkers.right.get(column.id) ?? conRestoreMarkers.right.get(column.id),
          },
          sortable: false,
          width: columnWidths[`${container.name}::${column.id}`] ?? containerColumnWidth(column),
          valueGetter: (params) => {
            if (!params.data) return "";
            const key = `${params.data.sku}::${container.name}`;
            const raw = params.data.containers?.[container.name] ?? {
              item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
              allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
              inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
            };
            const value = { ...raw, ...(qtyOverridesRef.current.get(key) ?? {}), ...(params.data.pinned ? {} : (chainMapRef.current.get(params.data.sku)?.get(container.name) ?? {})) };
            return column.val(value, container, params.data);
          },
          comparator: column.id === "life" || column.id === "inb_qty" || column.id === "avail" || column.id === "est" || column.id === "cbo" || column.id === "carry" || column.id === "remaining"
            ? (_a, _b, nodeA, nodeB) => {
                const getNum = (node: typeof nodeA): number => {
                  if (!node.data) return -1;
                  const key = `${node.data.sku}::${container.name}`;
                  const raw = node.data.containers?.[container.name];
                  const chain = chainMapRef.current.get(node.data.sku)?.get(container.name);
                  const override = qtyOverridesRef.current.get(key);
                  const merged = { ...raw, ...override, ...chain };
                  if (column.id === "life") return merged.inv_life ?? -1;
                  if (column.id === "inb_qty") return override !== undefined ? override.inbound_qty ?? 0 : raw?.inbound_qty ?? 0;
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
          cellRenderer: column.id === "inb_qty" && qtyEditable ? QtyCellRenderer : CellRenderer,
          cellRendererParams: column.id === "inb_qty" && qtyEditable ? (params: ICellRendererParams<DemandRow, CellContent>) => {
            const row = params.data;
            if (!row) return { onSave: async () => false };
            const raw = row.containers?.[container.name] ?? {
              item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
              allocated_remaining_qty: null, est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
              inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
            };
            return {
              onSave: (qty: number) => saveQty(row, container, raw, qty),
              onRequestEdit: handleQtyEditRequest,
              onSelectCell: selectSingleGridCell,
              onContextMenuRequest: handleQtyContextMenu,
            };
          } : undefined,
          cellClassRules: {
            "planning-user-text-color": (params) => {
              const columnId = `${container.name}::${column.id}`;
              const key = cellColorKey(params.data?.sku, columnId);
              return Boolean(cellTextFormatsRef.current[key]?.color
                ?? columnTextFormatsRef.current[physicalColumnId]?.cell?.color
                ?? columnTextFormatsRef.current[sharedColumnId]?.cell?.color);
            },
          },
          cellStyle: (params) => {
            const columnId = `${container.name}::${column.id}`;
            const key = cellColorKey(params.data?.sku, columnId);
            const selected = selectedCellsRef.current.has(key);
            const fullColumnSelected = selectedFullColumnIdsRef.current.has(physicalColumnId);
            const textFormat = {
              ...(columnTextFormatsRef.current[sharedColumnId]?.cell ?? {}),
              ...(columnTextFormatsRef.current[physicalColumnId]?.cell ?? {}),
              ...(cellTextFormatsRef.current[key] ?? {}),
            };
            const displayedColumns = params.column.getParent()?.getDisplayedLeafColumns() ?? [];
            const isFirstDisplayedColumn = displayedColumns[0] === params.column;
            const isConQty = column.id === CON_QTY_COLUMN_ID;
            return {
              // Selection temporarily overlays every underlying tint; the
              // user's cell/column colour returns when selection is cleared.
              backgroundColor: selected
                ? SELECTED_CELL_FILL
                : cellColors[key]
                  ?? columnColors[physicalColumnId]?.cell
                  ?? columnColors[sharedColumnId]?.cell
                  ?? (baseline ? "#E2E0DC" : isConQty ? CON_QTY_TINT : TINT_COLORS[column.tint] || "#fff"),
              ...(textFormat.color ? { color: textFormat.color } : {}),
              ...((textFormat.fontSize ?? column.fontSize) ? { fontSize: textFormat.fontSize ?? column.fontSize } : {}),
              ...(textFormat.bold !== undefined
                ? { fontWeight: textFormat.bold ? 700 : 400 }
                : isConQty ? { fontWeight: 700 } : {}),
              textAlign: "center",
              borderLeft: isFirstDisplayedColumn
                ? CONTAINER_BLOCK_RAIL
                : isConQty ? CON_QTY_RAIL : "none",
              ...(isConQty ? { borderRight: CON_QTY_RAIL } : {}),
              ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
              ...(selected
                ? selectionEdgeStyle(params.api, params.node.rowIndex, params.data?.sku, columnId, selectedCellsRef.current)
                : fullColumnSelected
                  ? { boxShadow: "inset 1px 0 #2563EB, inset -1px 0 #2563EB", position: "relative", zIndex: 1 }
                  : {}),
            };
          },
        });
        };

        const visibleSubColumns = globallyVisibleSubColumns.filter(
          (column) => !hiddenContainerColumns.has(`${container.name}::${column.id}`),
        );
        const children = visibleSubColumns.map((column) => buildRealSubColDef(column));
        const totalColumns: ContainerTotalColumn[] = visibleSubColumns.map((column) => ({
          id: column.id,
          columnId: `${container.name}::${column.id}`,
          width: columnWidths[`${container.name}::${column.id}`] ?? containerColumnWidth(column),
          total: containerColumnTotals.get(container.name)?.[column.id as keyof ContainerColumnTotals],
        }));
        // Resolve boundaries from AG Grid's live displayed order. The user can
        // reorder children, so the original definition index is not a stable
        // indicator of the left or right edge of the container block.
        children.forEach((child, columnIndex) => {
          const realId = visibleSubColumns[columnIndex].id;
          const physicalColumnId = `${container.name}::${realId}`;
          child.headerClass = (params) => {
            const displayedColumns = params.column?.getParent()?.getDisplayedLeafColumns() ?? [];
            return [
              (columnTextFormatsRef.current[physicalColumnId]?.header?.color
                ?? columnTextFormatsRef.current[`con:${realId}`]?.header?.color) ? "planning-user-header-text-color" : "",
              containerRestoreMarkers.left.has(realId) || containerRestoreMarkers.right.has(realId)
                || conRestoreMarkers.left.has(realId) || conRestoreMarkers.right.has(realId) ? "planning-hidegap-header" : "",
              displayedColumns[0] === params.column ? "container-column-start" : "",
              displayedColumns.at(-1) === params.column ? "container-column-end" : "",
              realId === CON_QTY_COLUMN_ID ? "con-qty-column" : "",
            ].filter(Boolean).join(" ");
          };
        });

        groups.push({
          groupId: `container-${container.name}`,
          // A container is one planning block. Moving its group header must
          // keep all 11 planning columns together, and individual column moves
          // must not split the block or insert another column inside it.
          marryChildren: true,
          headerName: columnHeaderNames[`container:${container.name}`] ?? container.name,
          headerStyle: () => headerStyleForColor(columnColors[`container:${container.name}`]?.header, columnTextFormatsRef.current[`container:${container.name}`]?.header),
          headerClass: () => columnTextFormatsRef.current[`container:${container.name}`]?.header?.color ? "planning-user-header-text-color" : "",
          headerGroupComponent: ContainerGroupHeader,
          headerGroupComponentParams: {
            selectionId: `container:${container.name}`,
            isSelected: () => selectedColumnIdsRef.current.has(`container:${container.name}`),
            subscribeSelection,
            onSelect: handleColumnHeaderSelectFast,
            onRename: onColumnHeaderRename ?? (() => {}),
            onRightClick: (x: number, y: number) => {
              setColumnMenu(null);
              setGroupMenu(null);
              setFilterOpenKey(null);
              setContainerMenu({
                x,
                y,
                label: columnHeaderNames[`container:${container.name}`] ?? container.name,
                containerName: container.name,
                baseline,
              });
            },
            shouldPreserveContextSelection,
            eta: container.eta,
            baseline,
            editable: canEditPlanning,
            qtyEditable,
            status: container.status,
            totalColumns,
            onEtaEditRequest: (anchor: EtaPickerAnchor) => setEtaEditor({ container, anchor }),
            onAutoFill: () => {
              setAutoFillingContainers((s) => new Set(s).add(container.name));
              void autoFill(container, containerIndex, true).finally(() => {
                setAutoFillingContainers((s) => { const n = new Set(s); n.delete(container.name); return n; });
              });
            },
            onAutoFill2: (days: number) => {
              setFixedTargetDialog({ container, containerIndex, targetDays: days });
            },
            onAutoFill3: () => {
              setBackfill3Dialog({ container, containerIndex });
            },
            onOpenInContainerPlanning: () => openContainerPlanning(container),
            onSave: () => {
              if (!window.confirm(buildContainerSaveSummary(container))) return;
              void saveContainer(container);
            },
            onReset: () => {
              if (!window.confirm(pick(
                "이 컨테이너의 저장하지 않은 수량을 DB 저장값으로 초기화하시겠습니까?",
                "Reset this container's unsaved quantities to the saved database values?",
              ))) return;
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
            autoFilling2: autoFillingContainers2.has(container.name),
autoFilling3: autoFillingContainers3.has(container.name),
            saving: savingContainers.has(container.name),
            dirty: dirtyContainers.has(container.name),
          },
          children,
        });
      }
    }
    return groups;
  }, [baseCandidates, baseRestoreMarkers, buildContainerSaveSummary, canEditPlanning, canEditSkuNotes, cellColors, chainMap, columnColors, columnFilters, columnHeaderNames, columnVis, columnWidths, conCandidates, conRestoreMarkers, containerColumnTotals, containers, groupVis, handleColumnHeaderSelectFast, handleFullColumnSelectFast, handleQtyEditRequest, hiddenBases, hiddenContainerColumns, onColumnHeaderRename, onHideColumn, onSkuCellNoteChange, onToggleContainerColumns, performCopy, pick, pinnedBaseColumnLayout, qtyOverrides, salesWindowWeights, saveCbm, saveMemo, saveQty, saveTotalAvgCurrent, saveWorkNote, selectSingleGridCell, shouldPreserveContextSelection, skuCellNotes, subscribeSelection, updateEta]);

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;

    const columnStructure = columnDefs.map((definition) => {
      if (!("children" in definition)) return definition.colId ?? definition.field ?? "";
      return `${definition.groupId ?? ""}[${definition.children.map((child) => (
        "children" in child
          ? child.groupId ?? ""
          : child.colId ?? child.field ?? ""
      )).join(",")}]`;
    }).join("|");

    if (appliedColumnStructureRef.current !== columnStructure) {
      // Container visibility changes add/remove whole column groups. Updating the
      // React prop alone can leave a previously removed group out of the displayed
      // tree until another grid update, so apply structural changes explicitly.
      api.setGridOption("columnDefs", columnDefs);
      appliedColumnStructureRef.current = columnStructure;
    }

    const pinnedSet = new Set(pinnedBaseColumnLayout.ids);
    const defaultOrder: string[] = [];
    const widthState: { colId: string; width: number }[] = [];
    const collectColumnIds = (definitions: Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>>) => {
      for (const definition of definitions) {
        if ("children" in definition) {
          collectColumnIds(definition.children as Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>>);
          continue;
        }
        const columnId = definition.colId ?? definition.field;
        if (!columnId) continue;
        defaultOrder.push(String(columnId));
        if (typeof definition.width === "number") widthState.push({ colId: String(columnId), width: definition.width });
      }
    };
    collectColumnIds(columnDefs);
    // `columnWidths` (loaded from localStorage/DB, or a live resize) always
    // feeds into `columnDefs`'s per-column `width`, but colId/groupId are all
    // the structure check above compares — a width-only change never flips
    // that signature, so `setGridOption` above skips it and the grid keeps
    // showing whatever width it was first initialized with. Applying widths
    // separately, every time, closes that gap without paying for a full
    // columnDefs replace on every resize.
    if (widthState.length) api.applyColumnState({ state: widthState, applyOrder: false });
    const availableIds = new Set((api.getColumns() ?? []).map((column) => column.getColId()));
    const requestedOrder = columnOrder.length ? columnOrder : defaultOrder;
    const desiredOrder = [
      ...requestedOrder.filter((id) => availableIds.has(id)),
      ...defaultOrder.filter((id) => availableIds.has(id) && !requestedOrder.includes(id)),
      ...Array.from(availableIds).filter((id) => !requestedOrder.includes(id) && !defaultOrder.includes(id)),
    ];
    api.applyColumnState({
      state: desiredOrder.map((columnId) => ({
        colId: columnId,
        pinned: pinnedSet.has(columnId) ? "left" : null,
      })),
      applyOrder: true,
    });
  }, [columnDefs, columnOrder, pinnedBaseColumnLayout]);

  const exportCurrentView = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;

    const columns = api.getAllDisplayedColumns();
    const csv = api.getDataAsCsv({
      columnKeys: columns.map((column) => column.getColId()),
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

  const getEditMenuAvailability = useCallback((): EditMenuAvailability => {
    const hasSelection = selectedCellsRef.current.size > 0;
    return {
      canUndo: canEditPlanning && !sheetHistoryBusyRef.current && sheetUndoStackRef.current.length > 0,
      canRedo: canEditPlanning && !sheetHistoryBusyRef.current && sheetRedoStackRef.current.length > 0,
      canCut: canEditPlanning && hasSelection && (
        [...selectedCellsRef.current].some((key) => {
          const separator = key.indexOf("::");
          return separator >= 0 && resolveEditableTarget(key.slice(0, separator), key.slice(separator + 2)) !== null;
        }) || selectionHasCuttableFormat()
      ),
      canCopy: hasSelection,
      canPaste: canEditPlanning && hasSelection,
      canDelete: canEditPlanning && collectDeletableTargets().length > 0,
    };
  }, [canEditPlanning, collectDeletableTargets, resolveEditableTarget, selectionHasCuttableFormat]);

  useEffect(() => {
    if (!onEditActionsReady) return;
    const actions: EditMenuActions = {
      undo: performUndo,
      redo: performRedo,
      cut: () => void performCut(),
      copy: () => void performCopy(),
      paste: () => void performPaste(),
      deleteSelection: () => { performDelete(); },
      getAvailability: getEditMenuAvailability,
    };
    onEditActionsReady(actions);
    return () => onEditActionsReady(null);
  }, [getEditMenuAvailability, onEditActionsReady, performCopy, performCut, performDelete, performPaste, performRedo, performUndo]);

  return (
    <>
    <div
      ref={gridHostRef}
      className="planning-ag-grid h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-white"
      onContextMenuCapture={(event) => event.preventDefault()}
    >
      <style>{`
        @keyframes planning-spin { to { transform: rotate(360deg); } }
        .planning-ag-grid .ag-row-selected {
          outline: 1px solid #7aa7e8;
          outline-offset: -1px;
        }
        .planning-ag-grid .ag-cell-focus:not(.ag-cell-range-selected):focus-within {
          border-color: transparent;
        }
        .planning-ag-grid .planning-rendered-cell-value,
        .planning-ag-grid .planning-rendered-cell-value * {
          font-size: inherit !important;
        }
        .planning-ag-grid .ag-cell.planning-user-text-color * {
          color: inherit !important;
        }
        .planning-ag-grid .ag-header-cell.planning-user-header-text-color *,
        .planning-ag-grid .ag-header-group-cell.planning-user-header-text-color * {
          color: inherit !important;
        }
        .planning-ag-grid .ag-cell:has(.planning-inline-cell-editor),
        .planning-ag-grid .ag-cell-wrapper:has(.planning-inline-cell-editor),
        .planning-ag-grid .ag-cell-value:has(.planning-inline-cell-editor) {
          padding: 0 !important;
          overflow: hidden !important;
        }
        /* Declared before the two container-block rules on purpose: these are
           all single !important classes, so the later rule wins, and a Con. Qty
           sitting at either edge of its block must keep that block's own
           border — the thin rail never replaces a block boundary. */
        .planning-ag-grid .con-qty-column {
          border-left: 1px solid #5B8FC9 !important;
          border-right: 1px solid #5B8FC9 !important;
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
        .planning-ag-grid .ag-row-pinned {
          font-style: italic;
          border-bottom: 2px solid #93c5fd !important;
        }
        .planning-ag-grid .ag-header-cell.planning-hidegap-header {
          overflow: visible !important;
          z-index: 5;
        }
      `}</style>
      <div className="h-full min-h-0" style={{ minWidth: gridMinWidth }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<DemandRow>
            ref={gridRef}
            theme={planningTheme}
            loading={loading}
            rowData={sortedRows}
            pinnedTopRowData={data.pinned_rows}
            columnDefs={columnDefs}
            defaultColDef={{
              autoHeaderHeight: false,
              resizable: true,
              wrapHeaderText: true,
              sortable: false,
            }}
            getRowId={(params) => params.data.pinned ? `pinned_${params.data.sku}` : params.data.sku}
            rowSelection={{
              mode: "singleRow",
              checkboxes: false,
              enableClickSelection: true,
            }}
            onCellMouseDown={(event) => {
              if (!event.data || event.rowIndex === null || event.node.rowPinned) return;
              const nativeEvt = event.event as MouseEvent | undefined;
              if (nativeEvt && nativeEvt.button !== 0) return;
              const target = nativeEvt?.target as HTMLElement | null;
              if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
              const columnId = event.column.getColId();
              dragCellAnchorRef.current = { rowIndex: event.rowIndex, columnId };
              activeSelectedCellRef.current = { rowId: event.data.sku, columnId };
              dragMovedRef.current = false;
            }}
            onCellMouseOver={(event) => {
              const anchor = dragCellAnchorRef.current;
              if (!anchor || !event.data || event.rowIndex === null) return;
              const nativeEvt = event.event as MouseEvent | undefined;
              if (nativeEvt && (nativeEvt.buttons & 1) !== 1) {
                dragCellAnchorRef.current = null;
                return;
              }
              const cells = selectedCellsBetween(event, anchor);
              if (!cells.length) return;
              const previous = selectedCellsRef.current;
              const next = new Set(cells.map((c) => `${c.rowId}::${c.columnId}`));
              if (next.size === previous.size && [...next].every((key) => previous.has(key))) return;
              dragMovedRef.current = true;
              selectedCellsRef.current = next;
              cellSelectionAnchorRef.current = anchor;
              refreshChangedCells(previous, next);
              scheduleDragSelectionNotification(cells);
            }}
            onCellClicked={(event) => {
              event.node.setSelected(true, true);
              if (!event.data) return;
              if (dragMovedRef.current) {
                dragMovedRef.current = false;
                return;
              }
              const columnId = event.column.getColId();
              const key = `${event.data.sku}::${columnId}`;
              const nativeEvt = event.event as MouseEvent | undefined;
              const previous = selectedCellsRef.current;
              const toggle = Boolean(nativeEvt?.ctrlKey || nativeEvt?.metaKey);
              const range = Boolean(nativeEvt?.shiftKey);
              const extendRange = range && cellSelectionAnchorRef.current !== null;
              let next: Set<string>;
              let rangeCells: SelectedAgCell[] | undefined;
              if (extendRange && cellSelectionAnchorRef.current) {
                rangeCells = selectedCellsBetween(event, cellSelectionAnchorRef.current);
                const rangeKeys = rangeCells.map((cell) => `${cell.rowId}::${cell.columnId}`);
                next = toggle ? new Set([...previous, ...rangeKeys]) : new Set(rangeKeys);
              } else {
                next = new Set(previous);
              }
              if (!extendRange && toggle) {
                if (next.has(key)) next.delete(key);
                else {
                  next.add(key);
                  cellSelectionAnchorRef.current = { rowIndex: event.rowIndex ?? 0, columnId };
                }
              } else if (!extendRange) {
                next.clear();
                next.add(key);
                cellSelectionAnchorRef.current = { rowIndex: event.rowIndex ?? 0, columnId };
              }
              selectedCellsRef.current = next;
              if (next.has(key)) {
                activeSelectedCellRef.current = { rowId: event.data.sku, columnId };
              } else {
                const firstKey = next.values().next().value as string | undefined;
                const separator = firstKey?.indexOf("::") ?? -1;
                activeSelectedCellRef.current = firstKey && separator >= 0
                  ? { rowId: firstKey.slice(0, separator), columnId: firstKey.slice(separator + 2) }
                  : null;
              }
              refreshChangedCells(previous, next);
              const selection = {
                rowId: event.data.sku,
                columnId,
                label: `${event.data.sku} / ${event.column.getColDef().headerName ?? columnId}`,
              };
              startTransition(() => {
                onCellSelectionChange?.([...next]);
                onAgCellSelected?.(rangeCells?.length ? { ...selection, cells: rangeCells } : selection);
              });
            }}
            onCellContextMenu={(event) => {
              const nativeEvent = event.event as MouseEvent | undefined;
              nativeEvent?.preventDefault();
              if (!event.data || event.node.rowPinned || event.node.rowIndex === null) return;
              const columnId = event.column.getColId();
              const key = `${event.data.sku}::${columnId}`;
              const preserveSelection = Boolean(
                nativeEvent?.ctrlKey || nativeEvent?.metaKey || nativeEvent?.shiftKey,
              ) || shouldPreserveContextSelection();
              if (!preserveSelection && !selectedCellsRef.current.has(key)) {
                selectSingleGridCell(event.node.rowIndex, columnId);
              }
              if (workNoteSlotForColumnId(columnId) !== null && nativeEvent) {
                setQtyCtxMenu({ x: nativeEvent.clientX, y: nativeEvent.clientY });
              }
            }}
            rowHeight={28}
            headerHeight={45}
            groupHeaderHeight={50}
            animateRows={false}
            suppressCellFocus
            maintainColumnOrder
            suppressDragLeaveHidesColumns
            onDragStarted={(event) => {
              const target = event.target instanceof Element ? event.target : null;
              const pointerTarget = document.elementFromPoint(
                columnDragAutoScrollRef.current.clientX,
                columnDragAutoScrollRef.current.clientY,
              );
              const header = target?.closest(".ag-header-cell, .ag-header-group-cell")
                ?? pointerTarget?.closest(".ag-header-cell, .ag-header-group-cell");
              if (!header || pointerTarget?.closest(".ag-header-cell-resize")) return;
              const dragState = columnDragAutoScrollRef.current;
              dragState.active = true;
              if (dragState.frame === null) {
                dragState.frame = window.requestAnimationFrame(columnDragAutoScrollTickRef.current);
              }
            }}
            onDragStopped={() => {
              const dragState = columnDragAutoScrollRef.current;
              dragState.active = false;
              if (dragState.frame !== null) window.cancelAnimationFrame(dragState.frame);
              dragState.frame = null;
            }}
            onDragCancelled={() => {
              const dragState = columnDragAutoScrollRef.current;
              dragState.active = false;
              if (dragState.frame !== null) window.cancelAnimationFrame(dragState.frame);
              dragState.frame = null;
            }}
            onColumnMoved={(event) => {
              if (!event.finished || event.source !== "uiColumnMoved") return;
              const affectedColumns = new Set(event.columns ?? (event.column ? [event.column] : []));
              for (const column of [...affectedColumns]) {
                for (const sibling of column.getParent()?.getDisplayedLeafColumns() ?? []) affectedColumns.add(sibling);
              }
              const movedContainerColumns = [...affectedColumns].some((column) => column.getColId().includes("::"));
              if (movedContainerColumns) {
                onContainerOrderCustomized?.();
                // Container groups may be reordered among themselves, but the
                // whole planning block must stay after the fixed/base columns
                // (the Inbound / Container / SOD boundary).
                const currentState = event.api.getColumnState();
                const baseColumnIds = currentState
                  .filter((state) => !state.colId.includes("::"))
                  .map((state) => state.colId);
                const containerColumnIds = currentState
                  .filter((state) => state.colId.includes("::"))
                  .map((state) => state.colId);
                event.api.applyColumnState({
                  state: [...baseColumnIds, ...containerColumnIds].map((colId) => ({ colId })),
                  applyOrder: true,
                });
              }
              event.api.refreshHeader();
              if (affectedColumns.size) event.api.refreshCells({ columns: [...affectedColumns], force: true });
              onColumnOrderChange?.(event.api.getColumnState().map((state) => state.colId));
            }}
            onColumnResized={(event) => {
              if (!event.column || event.source !== "uiColumnResized") return;
              const id = event.column.getColId();
              const next = { ...columnWidthsRef.current, [id]: event.column.getActualWidth() };
              columnWidthsRef.current = next;
              if (!event.finished) return;
              onColumnWidthsChange(next);
              window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(next));
            }}
            getRowStyle={(params): { backgroundColor: string } | undefined => {
              if (!params.data) return undefined;
              if (params.data.pinned) return { backgroundColor: "#EEF6FF" };
              if (urgStatus(params.data) === "crit") return { backgroundColor: "#FFF5F5" };
              return undefined;
            }}
            overlayLoadingTemplate={containerDetailsLoading ? "Loading container details..." : "Loading..."}
          />
        </AgGridProvider>
      </div>

      {/* Column header right-click menu: Sort A→Z, Sort Z→A, Filter, Hide. */}
      {columnMenu && (
        <GridColumnMenu
          x={columnMenu.x}
          y={columnMenu.y}
          label={columnMenu.label}
          size={columnFilterMenuSize}
          onSizeChange={onColumnFilterMenuSizeChange}
          sortDir={sort?.key === columnMenu.key && sort.kind === "value" ? sort.dir : null}
          onSortAsc={() => setSort({ key: columnMenu.key, kind: "value", dir: "asc" })}
          onSortDesc={() => setSort({ key: columnMenu.key, kind: "value", dir: "desc" })}
          activeColorSort={sort?.key === columnMenu.key && sort.kind === "color"
            ? { type: sort.colorType, color: sort.color }
            : null}
          onSortByColor={(colorType, color) => setSort({ key: columnMenu.key, kind: "color", colorType, color })}
          canHide={onHideColumn !== undefined || onHideColumns !== undefined}
          onHide={() => hideColumnsFromMenu(columnMenu.key)}
          committed={columnFilters.get(columnMenu.key) ?? null}
          getValues={() => (filterOpenKey === columnMenu.key ? columnValuesForOpenKey : [])}
          getFillColors={() => (filterOpenKey === columnMenu.key ? columnFillColorsForOpenKey : [])}
          getTextColors={() => (filterOpenKey === columnMenu.key ? columnTextColorsForOpenKey : [])}
          onOpenColumnData={() => setFilterOpenKey(columnMenu.key)}
          onApplyFilter={(next) => setColumnFilters((prev) => {
            const nextMap = new Map(prev);
            if (next === null) nextMap.delete(columnMenu.key);
            else nextMap.set(columnMenu.key, next);
            return nextMap;
          })}
          onClose={() => { setColumnMenu(null); setFilterOpenKey(null); }}
        />
      )}
      {groupMenu && (
        <GridGroupMenu
          x={groupMenu.x}
          y={groupMenu.y}
          label={groupMenu.label}
          kind="columns"
          canHide={onHideColumn !== undefined || onHideColumns !== undefined}
          onHide={() => hideGroupColumns(groupMenu.columnIds)}
          onClose={() => setGroupMenu(null)}
        />
      )}
      {containerMenu && (
        <GridGroupMenu
          x={containerMenu.x}
          y={containerMenu.y}
          label={containerMenu.label}
          kind="container"
          canHide={onHideContainer !== undefined}
          onHide={() => onHideContainer?.(containerMenu.containerName, containerMenu.baseline)}
          onClose={() => setContainerMenu(null)}
        />
      )}
      {qtyCtxMenu && (
        <ClipboardContextMenu
          x={qtyCtxMenu.x}
          y={qtyCtxMenu.y}
          canCut={canEditPlanning && (
            [...selectedCellsRef.current].some((key) => {
              const separator = key.indexOf("::");
              if (separator < 0) return false;
              const target = resolveEditableTarget(key.slice(0, separator), key.slice(separator + 2));
              return target?.kind === "qty" || target?.kind === "note";
            }) || selectionHasCuttableFormat()
          )}
          canPaste={canEditPlanning}
          onCut={() => void performCut()}
          onCopy={() => void performCopy()}
          onPaste={() => void performPaste()}
          onClose={() => setQtyCtxMenu(null)}
        />
      )}
    </div>
    {etaEditor && (
      <EtaDatePickerPortal
        label={`Edit ${etaEditor.container.name} ETA`}
        value={etaEditor.container.eta}
        anchor={etaEditor.anchor}
        onChange={(eta) => void updateEta(etaEditor.container, eta)}
        onClose={() => setEtaEditor(null)}
      />
    )}
    <FixedTargetDialog
      open={fixedTargetDialog !== null}
      containerName={fixedTargetDialog?.container.name ?? ""}
      targetDays={fixedTargetDialog?.targetDays ?? 90}
      capacityMode={fixedTargetCapacityMode}
      preview={fixedTargetPreview}
      onCapacityModeChange={setFixedTargetCapacityMode}
      onOpenChange={(open) => {
        if (!open) setFixedTargetDialog(null);
      }}
      onApply={() => {
        if (!fixedTargetDialog) return;
        const { container, containerIndex, targetDays } = fixedTargetDialog;
        setAutoFillingContainers2((current) => new Set(current).add(container.name));
        autoFill2(container, containerIndex, targetDays, fixedTargetCapacityMode);
        setAutoFillingContainers2((current) => {
          const next = new Set(current);
          next.delete(container.name);
          return next;
        });
        setFixedTargetDialog(null);
      }}
    />
    <Backfill3Dialog
      open={backfill3Dialog !== null}
      containerName={backfill3Dialog?.container.name ?? ""}
      tiers={backfill3Tiers}
      capacityMode={backfill3CapacityMode}
      preview={backfill3Preview}
      onCapacityModeChange={setBackfill3CapacityMode}
      onTierChange={(index, patch) => {
        setBackfill3Tiers((current) => current.map((tier, i) => i === index ? { ...tier, ...patch } : tier));
      }}
      onAddTier={() => {
        setBackfill3Tiers((current) => [...current, { minSales: 0, targetDays: 60 }]);
      }}
      onRemoveTier={(index) => {
        setBackfill3Tiers((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index));
      }}
      onOpenChange={(open) => {
        if (!open) setBackfill3Dialog(null);
      }}
      onApply={() => {
        if (!backfill3Dialog) return;
        const { container, containerIndex } = backfill3Dialog;
        setAutoFillingContainers3((s) => new Set(s).add(container.name));
        autoFill3(container, containerIndex, backfill3Tiers, backfill3CapacityMode);
        setAutoFillingContainers3((s) => { const n = new Set(s); n.delete(container.name); return n; });
        setBackfill3Dialog(null);
      }}
    />
    {(savingContainers.size > 0 || containerDetailsLoading || !chainReadyAfterLoad || autoFillingContainers.size > 0 || autoFillingContainers3.size > 0) && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "32px 48px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
          <div style={{ width: 36, height: 36, border: "3px solid #E2E8F0", borderTopColor: "#3B82F6", borderRadius: "50%", animation: "planning-spin 0.7s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
            {savingContainers.size > 0 ? "저장 중..." : autoFillingContainers.size > 0 || autoFillingContainers3.size > 0 ? "발주량 계산 중..." : "컨테이너 데이터 로딩 중..."}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
