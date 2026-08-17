"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { PaintBucket, Pipette, RotateCcw, Search } from "lucide-react";
import { DemandPlanningGrid } from "./demand-planning-grid";
import { StatusBar } from "./status-bar";
import {
  ALL_COLS,
  ALL_GROUP_KEYS,
  COMPACT_COLUMN_IDS,
  CON_SUBCOLS,
  CELL_COLORS_STORAGE_KEY,
  CELL_TEXT_FORMATS_STORAGE_KEY,
  COLUMN_COLORS_STORAGE_KEY,
  COLUMN_ORDER_STORAGE_KEY,
  COLUMN_TEXT_FORMATS_STORAGE_KEY,
  GROUP_BTN_LABELS,
  GROUP_LABELS,
  DEFAULT_FREEZE,
  COLUMN_WIDTHS_STORAGE_KEY,
  TODAY,
  EMPTY_SKU_PART_FILTERS,
  loadSavedColumnColors,
  loadSavedColumnOrder,
  ensureAdditionalNotesInColumnOrder,
  loadSavedCellColors,
  loadSavedColumnTextFormats,
  loadSavedCellTextFormats,
  loadSavedColumnWidths,
  skuFilterKeysForProduct,
  skuPartsForRow,
} from "./columns";
import type { CellColorSettings, CellTextFormatSettings, ColumnColorSettings, ColumnOrder, ColumnTextFormatSettings, ColumnVisibility, ColumnWidths, SkuPartFilterKey, SkuPartFilters, TextFormatSettings } from "./columns";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDemandPlanningData } from "@/features/planning/demand-planning-data";
import type { VelocityMode } from "@/features/planning/demand-planning-data";
import { planningLocalDateString } from "@/lib/planning/date-utils";
import {
  DEFAULT_SEASONAL_FACTORS,
  SEASONAL_FACTORS_STORAGE_KEY,
  loadSavedSeasonalFactors,
  type SeasonalFactors,
} from "@/lib/planning/seasonal-factors";
import {
  DEFAULT_SALES_WINDOW_WEIGHTS,
  SALES_WINDOW_WEIGHTS_STORAGE_KEY,
  labelWithSalesWindowWeight,
  loadSavedSalesWindowWeights,
  normalizeSalesWindowWeights,
  type SalesWindowWeights,
} from "@/lib/planning/sales-window-weights";
import {
  DEFAULT_OOS_LOST_DEMAND_WEIGHTS,
  OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY,
  loadSavedOosLostDemandWeights,
  normalizeOosLostDemandWeights,
  type OosLostDemandWeights,
} from "@/lib/planning/oos-lost-demand-weights";
import {
  DEFAULT_GRADIENT,
  DEFAULT_GRADIENT_SC,
  GRADIENT_SC_STORAGE_KEY,
  GRADIENT_STORAGE_KEY,
  loadSavedGradient,
  loadSavedGradientSC,
  saveGradient,
  saveGradientSC,
  type GradientTier,
} from "@/lib/planning/gradient-config";
import type { BaseCategoryFilter, CategoryFilter, ColumnGroupKey, ContainerMeta, DemandRow, ProductFilter, UrgencyFilter } from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";

const AgDemandPlanningGrid = dynamic(
  () => import("./ag-demand-planning-grid").then((module) => module.AgDemandPlanningGrid),
  { ssr: false },
);

const DEFAULT_GROUP_VIS: Record<ColumnGroupKey, boolean> = {
  fix: true,
  stock: true,
  wsales: true,
  esales: true,
  fbasales: true,
  wavg: true,
  eavg: true,
  fba: true,
  s30: true,
  tavg: true,
  oos: true,
  inb: true,
  con: false,
};

const COLUMN_SETTINGS_STORAGE_KEY = "planning-dashboard-column-settings";
const CONTAINER_VISIBILITY_STORAGE_KEY = "planning-dashboard-container-visibility";
const COLUMN_HEADER_NAMES_STORAGE_KEY = "planning-dashboard-column-header-names";
const SETTINGS_SECTION_TITLE_STYLE = {
  color: "#1D4ED8",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};

const FILL_COLOR_ROWS = [
  ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"],
  ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"],
  ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"],
  ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"],
  ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"],
  ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"],
  ["#85200C", "#990000", "#B45F06", "#BF9000", "#38761D", "#134F5C", "#1155CC", "#0B5394", "#351C75", "#741B47"],
  ["#5B0F00", "#660000", "#783F04", "#7F6000", "#274E13", "#0C343D", "#1C4587", "#073763", "#20124D", "#4C1130"],
] as const;

const STANDARD_FILL_COLORS = ["#000000", "#FFFFFF", "#EA4335", "#FB8C00", "#FABB05", "#34A853", "#24C1E0", "#4285F4", "#7E57C2", "#EC407A"] as const;

function defaultCellTextFontSize(columnId: string | undefined) {
  if (!columnId) return 11;
  return columnId === "next_eta" || /(?:^con:|::)(?:esod|psod)$/.test(columnId) ? 10 : 11;
}

function DeferredColorInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingColorRef = useRef(value.toUpperCase());
  const committedColorRef = useRef(value.toUpperCase());
  const commitTimerRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const commit = () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      const next = pendingColorRef.current.toUpperCase();
      if (next === committedColorRef.current) return;
      committedColorRef.current = next;
      onCommitRef.current(next);
    };
    const scheduleCommit = () => {
      pendingColorRef.current = input.value.toUpperCase();
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      // React's color-input onChange tracks the native `input` event and can fire
      // dozens of times while the OS picker is dragged. Listening to the native
      // committed `change` event and coalescing it keeps the picker responsive.
      commitTimerRef.current = window.setTimeout(commit, 120);
    };
    const handleInput = () => {
      pendingColorRef.current = input.value.toUpperCase();
    };

    input.addEventListener("input", handleInput);
    input.addEventListener("change", scheduleCommit);
    input.addEventListener("blur", commit);
    return () => {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("change", scheduleCommit);
      input.removeEventListener("blur", commit);
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="color"
      defaultValue={value}
      aria-label={ariaLabel}
      style={{ height: 1, opacity: 0, position: "absolute", width: 1 }}
    />
  );
}

function DeferredFontSizeControl({ value, onCommit, disabled = false }: { value: number; onCommit: (value: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  const pendingValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const commitTimerRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
  }, []);

  const normalized = (next: number) => Math.min(48, Math.max(6, Math.round(next)));
  const commit = (next = pendingValueRef.current) => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const finalValue = normalized(next);
    pendingValueRef.current = finalValue;
    setDraft(String(finalValue));
    if (finalValue === committedValueRef.current) return;
    committedValueRef.current = finalValue;
    onCommitRef.current(finalValue);
  };
  const updateDraft = (next: number) => {
    const finalValue = normalized(next);
    pendingValueRef.current = finalValue;
    setDraft(String(finalValue));
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    // Keep rapid typing/spinner/button repeats local to this small control, then
    // refresh and persist the grid once with the final value.
    commitTimerRef.current = window.setTimeout(() => commit(finalValue), 140);
  };

  return (
    <div style={{ alignItems: "center", display: "flex", gap: 5, opacity: disabled ? 0.45 : 1 }}>
      <button type="button" disabled={disabled} aria-label="Decrease font size" onClick={() => updateDraft(pendingValueRef.current - 1)} style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 4, cursor: disabled ? "default" : "pointer", fontSize: 16, height: 27, lineHeight: 1, padding: 0, width: 27 }}>−</button>
      <input
        type="number"
        min={6}
        max={48}
        disabled={disabled}
        aria-label="Font size"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (Number.isFinite(next)) updateDraft(next);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.blur();
          }
        }}
        style={{ border: "1px solid #94A3B8", borderRadius: 4, fontSize: 12, height: 27, padding: "2px 3px", textAlign: "center", width: 44, cursor: disabled ? "default" : "text" }}
      />
      <button type="button" disabled={disabled} aria-label="Increase font size" onClick={() => updateDraft(pendingValueRef.current + 1)} style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 4, cursor: disabled ? "default" : "pointer", fontSize: 16, height: 27, lineHeight: 1, padding: 0, width: 27 }}>+</button>
    </div>
  );
}

function FillColorPopover({
  enabled,
  currentColor,
  targetLabel,
  onApply,
  onReset,
}: {
  enabled: boolean;
  currentColor: string;
  targetLabel: string;
  onApply: (color: string) => void;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!enabled}
          aria-label="Fill color"
          title={enabled ? `Fill color: ${targetLabel}` : "Select column headers or grid cells first"}
          style={{
            alignItems: "center",
            background: enabled ? "#fff" : "#F5F4EF",
            border: "1px solid #C2BFB5",
            borderRadius: 4,
            color: enabled ? "#1A1917" : "#A8A49E",
            cursor: enabled ? "pointer" : "default",
            display: "inline-flex",
            flexDirection: "column",
            flexShrink: 0,
            height: 30,
            justifyContent: "center",
            padding: "3px 7px 2px",
            width: 32,
          }}
        >
          <PaintBucket size={15} aria-hidden="true" />
          <span aria-hidden="true" style={{ background: enabled ? currentColor : "#A8A49E", height: 3, marginTop: 1, width: 18 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} style={{ background: "#FFFFFF", boxShadow: "0 10px 28px rgba(15,23,42,.2)", opacity: 1, width: 244, padding: 10 }}>
        <div style={{ color: "#64748B", fontSize: 10, fontWeight: 700, marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={targetLabel}>
          {targetLabel}
        </div>
        <button
          type="button"
          onClick={onReset}
          style={{ alignItems: "center", background: "transparent", border: "none", color: "#334155", cursor: "pointer", display: "flex", fontSize: 12, gap: 7, marginBottom: 8, padding: "2px 0" }}
        >
          <RotateCcw size={14} aria-hidden="true" /> Reset
        </button>
        <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(10, 19px)" }}>
          {FILL_COLOR_ROWS.flat().map((color, index) => (
            <button
              key={`${color}-${index}`}
              type="button"
              aria-label={`Set fill color ${color}`}
              title={color}
              onClick={() => onApply(color)}
              style={{
                background: color,
                border: currentColor.toUpperCase() === color ? "2px solid #2563EB" : color === "#FFFFFF" ? "1px solid #CBD5E1" : "1px solid transparent",
                borderRadius: "50%",
                boxShadow: currentColor.toUpperCase() === color ? "0 0 0 1px #fff inset" : undefined,
                cursor: "pointer",
                height: 19,
                padding: 0,
                width: 19,
              }}
            />
          ))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>STANDARD</div>
        <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
          {STANDARD_FILL_COLORS.map((color) => (
            <button key={color} type="button" aria-label={`Set standard fill color ${color}`} onClick={() => onApply(color)} style={{ background: color, border: color === "#FFFFFF" ? "1px solid #CBD5E1" : "1px solid transparent", borderRadius: "50%", cursor: "pointer", height: 19, padding: 0, width: 19 }} />
          ))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>CUSTOM</div>
        <label title="Choose custom color" style={{ alignItems: "center", cursor: "pointer", display: "inline-flex", gap: 6, marginTop: 6 }}>
          <span aria-hidden="true" style={{ background: currentColor, border: "1px solid #CBD5E1", borderRadius: "50%", height: 19, width: 19 }} />
          <Pipette size={15} aria-hidden="true" />
          <span style={{ color: "#475569", fontSize: 11 }}>Custom color</span>
          <DeferredColorInput key={currentColor} value={currentColor} ariaLabel="Custom fill color" onCommit={onApply} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function TextFormatPopover({
  enabled,
  format,
  targetLabel,
  onChange,
  onReset,
  fontSizeDisabled = false,
}: {
  enabled: boolean;
  format: Required<TextFormatSettings>;
  targetLabel: string;
  onChange: (patch: TextFormatSettings) => void;
  onReset: () => void;
  fontSizeDisabled?: boolean;
}) {
  const { pick } = useI18n();
  const currentColor = format.color.toUpperCase();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!enabled}
          aria-label="Text formatting"
          title={enabled ? `Text formatting: ${targetLabel}` : "Select column headers or grid cells first"}
          style={{ alignItems: "center", background: enabled ? "#fff" : "#F5F4EF", border: "1px solid #C2BFB5", borderRadius: 4, color: enabled ? "#1A1917" : "#A8A49E", cursor: enabled ? "pointer" : "default", display: "inline-flex", flexDirection: "column", flexShrink: 0, fontFamily: "Arial, sans-serif", fontSize: 15, fontWeight: format.bold ? 800 : 500, height: 30, justifyContent: "center", padding: "2px 7px 1px", width: 32 }}
        >
          <span aria-hidden="true" style={{ lineHeight: 15 }}>A</span>
          <span aria-hidden="true" style={{ background: enabled ? currentColor : "#A8A49E", height: 3, marginTop: 1, width: 18 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} style={{ background: "#FFFFFF", boxShadow: "0 10px 28px rgba(15,23,42,.2)", opacity: 1, padding: 10, width: 244 }}>
        <div style={{ color: "#64748B", fontSize: 10, fontWeight: 700, marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={targetLabel}>
          {targetLabel}
        </div>
        <button type="button" onClick={onReset} style={{ alignItems: "center", background: "transparent", border: "none", color: "#334155", cursor: "pointer", display: "flex", fontSize: 12, gap: 7, marginBottom: 8, padding: "2px 0" }}>
          <RotateCcw size={14} aria-hidden="true" /> Reset
        </button>
        <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: fontSizeDisabled ? 2 : 10 }}>
          <DeferredFontSizeControl
            key={`${targetLabel}:${format.fontSize}`}
            value={format.fontSize}
            onCommit={(fontSize) => onChange({ fontSize })}
            disabled={fontSizeDisabled}
          />
          <button
            type="button"
            disabled={fontSizeDisabled}
            aria-label="Bold"
            aria-pressed={format.bold}
            onClick={() => onChange({ bold: !format.bold })}
            style={{ background: format.bold ? "#DBEAFE" : "#fff", border: format.bold ? "1px solid #60A5FA" : "1px solid #CBD5E1", borderRadius: 4, color: format.bold ? "#1D4ED8" : "#1E293B", cursor: fontSizeDisabled ? "default" : "pointer", fontSize: 14, fontWeight: 800, height: 27, marginLeft: 3, opacity: fontSizeDisabled ? 0.45 : 1, padding: 0, width: 29 }}
          >
            B
          </button>
        </div>
        {fontSizeDisabled && (
          <div
            style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8, lineHeight: 1.35 }}
            title={pick(
              "컨테이너 헤더 안의 글자 크기와 굵기는 고정되어 있어 변경이 반영되지 않습니다.",
              "Font size and bold are fixed for container headers, so changes are not applied.",
            )}
          >
            {pick(
              "컨테이너 헤더는 글자 크기와 굵기를 지원하지 않습니다.",
              "Container headers do not support font size or bold formatting.",
            )}
          </div>
        )}
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", paddingTop: 7 }}>FONT COLOR</div>
        <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(10, 19px)", marginTop: 6 }}>
          {FILL_COLOR_ROWS.flat().map((color, index) => (
            <button
              key={`${color}-${index}`}
              type="button"
              aria-label={`Set font color ${color}`}
              title={color}
              onClick={() => onChange({ color })}
              style={{ background: color, border: currentColor === color ? "2px solid #2563EB" : color === "#FFFFFF" ? "1px solid #CBD5E1" : "1px solid transparent", borderRadius: "50%", boxShadow: currentColor === color ? "0 0 0 1px #fff inset" : undefined, cursor: "pointer", height: 19, padding: 0, width: 19 }}
            />
          ))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>STANDARD</div>
        <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
          {STANDARD_FILL_COLORS.map((color) => (
            <button key={color} type="button" aria-label={`Set standard font color ${color}`} onClick={() => onChange({ color })} style={{ background: color, border: color === "#FFFFFF" ? "1px solid #CBD5E1" : "1px solid transparent", borderRadius: "50%", cursor: "pointer", height: 19, padding: 0, width: 19 }} />
          ))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>CUSTOM</div>
        <label title="Choose custom font color" style={{ alignItems: "center", cursor: "pointer", display: "inline-flex", gap: 6, marginTop: 6 }}>
          <span aria-hidden="true" style={{ background: currentColor, border: "1px solid #CBD5E1", borderRadius: "50%", height: 19, width: 19 }} />
          <Pipette size={15} aria-hidden="true" />
          <span style={{ color: "#475569", fontSize: 11 }}>Custom color</span>
          <DeferredColorInput key={currentColor} value={currentColor} ariaLabel="Custom font color" onCommit={(color) => onChange({ color })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

type ColumnSettings = {
  groupVis: Record<ColumnGroupKey, boolean>;
  columnVis: ColumnVisibility;
  compactMode: boolean;
  showMistake: boolean;
  showZeroSales: boolean;
  freezeUntil: string;
};

type ColumnSettingsDraft = {
  columnVis: ColumnVisibility;
  compactMode: boolean;
  showZeroSales: boolean;
  freezeUntil: string;
  skuPartFilters: SkuPartFilters;
  hiddenContainers: Set<string>;
  hiddenBases: Set<string>;
  hiddenContainerColumns: Set<string>;
};

const BASE_COLORABLE_COLUMNS = [
  ...ALL_COLS.map((column) => ({
    id: column.id,
    label: column.label.replace("\n", " "),
  })),
  ...CON_SUBCOLS.map((column) => ({
    id: `con:${column.id}`,
    label: `Container ${column.label.replace("\n", " ")}`,
  })),
];

type ColumnVisibilityItem = {
  id: string;
  label: string;
  group: ColumnGroupKey;
  compact: boolean;
  kind: "base" | "container";
};

const COLUMN_VISIBILITY_GROUP_KEYS: ColumnGroupKey[] = ["fix", ...ALL_GROUP_KEYS];
const CONTAINER_VISIBILITY_SUBCOLUMNS = [
  ...CON_SUBCOLS.filter((column) => column.id === "ccbm"),
  ...CON_SUBCOLS.filter((column) => column.id !== "ccbm"),
];

const COLUMN_VISIBILITY_ITEMS: ColumnVisibilityItem[] = [
  ...ALL_COLS.map((column) => ({
    id: column.id,
    label: column.label.replace("\n", " "),
    group: column.grp,
    compact: COMPACT_COLUMN_IDS.has(column.id),
    kind: "base" as const,
  })),
  ...CONTAINER_VISIBILITY_SUBCOLUMNS.map((column) => ({
    id: `con:${column.id}`,
    label: column.id === "remaining" ? "Rem. Qty" : column.label.replace("\n", " "),
    group: "con" as const,
    compact: false,
    kind: "container" as const,
  })),
];

const DEFAULT_COLUMN_VISIBILITY_GROUPS_OPEN = Object.fromEntries(
  COLUMN_VISIBILITY_GROUP_KEYS.map((key) => [key, true]),
) as Record<ColumnGroupKey, boolean>;

const SKU_FILTER_LABELS: Record<SkuPartFilterKey, string> = {
  formula: "Type",
  fabric: "Fabric",
  seat: "Seat",
  no: "No.",
  size: "Size",
  color: "Color",
  tone: "Tone",
  type: "Color Type",
  prefix: "Prefix",
  productCode: "Product",
  surface: "Surface",
  material: "Material",
  vehiclePosition: "Position",
  make: "Make",
  model: "Model#",
};

function sortSkuFilterValues(values: Iterable<string>) {
  return Array.from(values)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function cloneSkuPartFilters(filters: SkuPartFilters): SkuPartFilters {
  return Object.fromEntries(
    Object.entries(filters).map(([key, values]) => [key, [...values]]),
  ) as SkuPartFilters;
}

function freezeColumnForVisibility(columnVis: ColumnVisibility, currentFreeze: string): string {
  const visible = ALL_COLS.filter((column) => columnVis[column.id] !== false);
  return visible.some((column) => column.id === currentFreeze)
    ? currentFreeze
    : visible.at(-1)?.id ?? currentFreeze;
}

function skuFilterSummary(values: string[]) {
  if (!values.length) return "All";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

const CATEGORY_FILTER_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "sc", label: "Seat Cover" },
  { value: "cc", label: "Car Cover" },
  { value: "fm", label: "Floor Mat" },
  { value: "ac", label: "Accessories" },
  { value: "swc", label: "SWC" },
];

const BASE_CATEGORY_ORDER: BaseCategoryFilter[] = ["sc", "cc", "fm", "ac"];

function categoryFilterSummary(selected: CategoryFilter[]) {
  if (!selected.length) return "None";
  const labelByValue = new Map(CATEGORY_FILTER_OPTIONS.map((option) => [option.value, option.label]));
  const labels = selected.map((value) => labelByValue.get(value) ?? value);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

const VALID_CATEGORY_FILTER_VALUES = new Set<CategoryFilter>(CATEGORY_FILTER_OPTIONS.map((option) => option.value));

function parseCategoryFilterParam(value: string | null): CategoryFilter[] {
  if (!value) return ["sc"];
  const parsed = value.split(",").filter((token): token is CategoryFilter => VALID_CATEGORY_FILTER_VALUES.has(token as CategoryFilter));
  return parsed.length ? parsed : ["sc"];
}

function skuFilterLabel(key: SkuPartFilterKey, product: BaseCategoryFilter | undefined) {
  if (product === "sc" && key === "seat") return "Seat Position";
  if (product === "sc" && key === "no") return "Size";
  if (product === "sc" && key === "tone") return "Color Type";
  if (product === "fm") {
    const floorMatLabels: Partial<Record<SkuPartFilterKey, string>> = {
      prefix: "SKU 1",
      productCode: "SKU 2",
      surface: "SKU 3",
      material: "SKU 4",
      vehiclePosition: "SKU 5",
      make: "SKU 6",
      model: "SKU 7",
    };
    return floorMatLabels[key] ?? SKU_FILTER_LABELS[key];
  }
  return SKU_FILTER_LABELS[key];
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

function containerMatchesCategory(container: ContainerMeta, categoryFilter: CategoryFilter[]) {
  if (container.status === "baseline") return true;
  const checkedBaseCategories = BASE_CATEGORY_ORDER.filter((c) => categoryFilter.includes(c));
  // SWC has no container concept — if nothing category-shaped is checked, don't filter containers at all.
  if (!checkedBaseCategories.length) return true;
  if (!container.categories?.length) {
    if (container.name.endsWith("-FLOOR")) return checkedBaseCategories.includes("fm");
    if (container.name.endsWith("-SEAT")) return checkedBaseCategories.includes("sc");
    return true;
  }
  return checkedBaseCategories.some((c) => container.categories!.includes(c.toUpperCase()));
}

function getColumnVisibilityForPreset(preset: "all" | "core" | "compact"): ColumnVisibility {
  const coreGroups = new Set<ColumnGroupKey>(["fix", "stock", "s30", "tavg", "inb"]);
  return Object.fromEntries(
    COLUMN_VISIBILITY_ITEMS.map((item) => {
      const visible = preset === "all"
        ? true
        : preset === "core"
          ? item.group === "con" || item.group === "fix" || coreGroups.has(item.group)
          : item.group === "con" || (item.kind === "base" && (item.group === "fix" || coreGroups.has(item.group)) && item.compact);
      return [item.id, visible];
    }),
  );
}

function getColumnVisibilityFromGroups(groupVis: Record<ColumnGroupKey, boolean>, compactMode: boolean): ColumnVisibility {
  return Object.fromEntries(
    COLUMN_VISIBILITY_ITEMS.map((item) => {
      const groupVisible = item.group === "fix" || groupVis[item.group];
      const compactVisible = !compactMode || (item.kind === "base" && item.compact);
      return [item.id, groupVisible && compactVisible];
    }),
  );
}

function getGroupVisibilityFromColumns(columnVis: ColumnVisibility): Record<ColumnGroupKey, boolean> {
  return {
    ...DEFAULT_GROUP_VIS,
    ...Object.fromEntries(
      ALL_GROUP_KEYS.map((key) => [
        key,
        COLUMN_VISIBILITY_ITEMS.some((item) => item.group === key && columnVis[item.id] !== false),
      ]),
    ),
  } as Record<ColumnGroupKey, boolean>;
}

function normalizeColumnVisibility(value: unknown): ColumnVisibility | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(
    COLUMN_VISIBILITY_ITEMS.map((item) => [item.id, typeof stored[item.id] === "boolean" ? stored[item.id] : true]),
  ) as ColumnVisibility;
}

function columnVisibilityEquals(left: ColumnVisibility, right: ColumnVisibility): boolean {
  return COLUMN_VISIBILITY_ITEMS.every((item) => left[item.id] !== false === (right[item.id] !== false));
}

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
    const compactMode = typeof stored.compactMode === "boolean" ? stored.compactMode : undefined;
    const columnVis = normalizeColumnVisibility(stored.columnVis) ?? getColumnVisibilityFromGroups(groupVis, compactMode ?? false);

    return {
      groupVis,
      columnVis,
      compactMode,
      showMistake: typeof stored.showMistake === "boolean" ? stored.showMistake : undefined,
      showZeroSales: typeof stored.showZeroSales === "boolean" ? stored.showZeroSales : undefined,
      freezeUntil,
    };
  } catch {
    return {};
  }
}

export function DemandPlanningDashboard({ gridMode = "native" }: { gridMode?: "native" | "ag-grid" }) {
  const { pick } = useI18n();
  const confirmReset = useCallback((koreanTarget: string, englishTarget: string) => window.confirm(
    pick(
      `${koreanTarget} 설정을 초기화하시겠습니까?\n\n확인을 누르면 즉시 초기화됩니다.`,
      `Reset ${englishTarget}?\n\nClick OK to apply the reset.`,
    ),
  ), [pick]);
  const { can, ready: permissionsReady } = usePermissions();
  const router = useRouter();
  const [velocityMode, setVelocityMode] = useState<VelocityMode>("custom");
  const [todayStr, setTodayStr] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const isHistoricalDate = Boolean(todayStr && asOfDate && asOfDate !== todayStr);
  const searchParams = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter[]>(() => parseCategoryFilterParam(searchParams.get("product")));
  const [salesWindowWeights, setSalesWindowWeights] = useState<SalesWindowWeights>(DEFAULT_SALES_WINDOW_WEIGHTS);
  const [oosLostDemandWeights, setOosLostDemandWeights] = useState<OosLostDemandWeights>(DEFAULT_OOS_LOST_DEMAND_WEIGHTS);
  const {
    data,
    loading,
    containerDetailsLoading,
    containerDetailsLoaded,
    error: loadError,
    reload,
    loadContainerDetails,
  } = useDemandPlanningData(velocityMode, isHistoricalDate ? asOfDate : undefined, false, categoryFilter, salesWindowWeights, oosLostDemandWeights);
  const [isCategoryPending, startCategoryTransition] = useTransition();
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter | null>(null);
  const [search, setSearch] = useState("");
  const [skuPartFilters, setSkuPartFilters] = useState<SkuPartFilters>(EMPTY_SKU_PART_FILTERS);
  const [isSkuFiltersOpen, setIsSkuFiltersOpen] = useState(true);
  const [openSkuFilterKey, setOpenSkuFilterKey] = useState<SkuPartFilterKey | null>(null);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [categoryDropdownPos, setCategoryDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [filteredRows, setFilteredRows] = useState<DemandRow[]>([]);
  const [selectedColorColumns, setSelectedColorColumns] = useState<string[]>([]);
  const [selectedFullColumnIds, setSelectedFullColumnIds] = useState<string[]>([]);
  const [columnHeaderNames, setColumnHeaderNames] = useState<Record<string, string>>({});
  const [activeColorTarget, setActiveColorTarget] = useState<"headers" | "columns" | "cells">("headers");
  const canEditDemandPlanning = permissionsReady && can("demand-planning", "edit");
  const canEditSkuNotes = canEditDemandPlanning;

  useEffect(() => {
    const today = planningLocalDateString();
    // Hydration-safe: browser-local date is only available after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayStr(today);
    setAsOfDate((current) => current || today);

    const productParam = searchParams.get("product");
    if (productParam) {
      setCategoryFilter(parseCategoryFilterParam(productParam));
    }
    const statusParam = searchParams.get("status");
    if (statusParam === "crit" || statusParam === "warn" || statusParam === "bo" || statusParam === "over") {
      setUrgencyFilter(statusParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProductFilter = useCallback((filter: ProductFilter) => {
    setProductFilter(filter);
    setUrgencyFilter(null);
  }, []);

  const handleCategoryFilter = useCallback((value: CategoryFilter) => {
    const next = categoryFilter.includes(value)
      ? categoryFilter.filter((v) => v !== value)
      : [...categoryFilter, value];
    if (categoryChangeTimerRef.current) window.clearTimeout(categoryChangeTimerRef.current);

    setSelectedColorColumns((current) => current.some((id) => id.startsWith("container:")) ? (BASE_COLORABLE_COLUMNS[0] ? [BASE_COLORABLE_COLUMNS[0].id] : []) : current);
    setIsCategoryLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    if (next.length) params.set("product", next.join(",")); else params.delete("product");
    router.replace(`?${params.toString()}`, { scroll: false });
    categoryChangeTimerRef.current = window.setTimeout(() => {
      startCategoryTransition(() => {
        setCategoryFilter(next);
      });
      categoryChangeTimerRef.current = null;
    }, 60);
  }, [categoryFilter, router, searchParams]);

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

  useEffect(() => {
    if (!openSkuFilterKey) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && skuFiltersRef.current?.contains(target)) return;
      setOpenSkuFilterKey(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openSkuFilterKey]);

  useEffect(() => {
    if (!isCategoryDropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && categoryFilterRef.current?.contains(target)) return;
      setIsCategoryDropdownOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCategoryDropdownOpen]);

  // ── Column visibility state (lifted from grid) ──────────────────────────────
  const [hiddenContainers, setHiddenContainers] = useState<Set<string>>(new Set());
  const [hiddenBases, setHiddenBases] = useState<Set<string>>(new Set());
  const [hiddenContainerColumns, setHiddenContainerColumns] = useState<Set<string>>(new Set());
  const [openContainerStatusGroups, setOpenContainerStatusGroups] = useState<Record<string, boolean>>({
    packing_received: true,
    shipped: true,
    draft: true,
  });
  const [groupVis, setGroupVis] = useState<Record<ColumnGroupKey, boolean>>(DEFAULT_GROUP_VIS);
  const [columnVis, setColumnVis] = useState<ColumnVisibility>(() => getColumnVisibilityForPreset("all"));
  const [compactMode, setCompactMode] = useState(false);
  const [showMistake, setShowMistake] = useState(true);
  const [showZeroSales, setShowZeroSales] = useState(false);
  const [freezeUntil, setFreezeUntil] = useState(DEFAULT_FREEZE);
  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState(false);
  const columnSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const [columnSettingsDraft, setColumnSettingsDraft] = useState<ColumnSettingsDraft | null>(null);
  const [columnSettingsLoaded, setColumnSettingsLoaded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrder>([]);
  const [openColumnVisibilityGroups, setOpenColumnVisibilityGroups] = useState<Record<ColumnGroupKey, boolean>>(DEFAULT_COLUMN_VISIBILITY_GROUPS_OPEN);
  const [columnColors, setColumnColors] = useState<ColumnColorSettings>({});
  const [cellColors, setCellColors] = useState<CellColorSettings>({});
  const [columnTextFormats, setColumnTextFormats] = useState<ColumnTextFormatSettings>({});
  const [cellTextFormats, setCellTextFormats] = useState<CellTextFormatSettings>({});
  const [isColorSettingsOpen, setIsColorSettingsOpen] = useState(true);
  const [selectedAgCell, setSelectedAgCell] = useState<{ rowId: string; columnId: string; label: string } | null>(null);
  const [selectedAgCells, setSelectedAgCells] = useState<{ rowId: string; columnId: string; label: string }[]>([]);
  const [seasonalFactors, setSeasonalFactors] = useState<SeasonalFactors>(DEFAULT_SEASONAL_FACTORS);
  const [gradient, setGradient] = useState<GradientTier[]>(DEFAULT_GRADIENT);
  const [gradientSC, setGradientSC] = useState<GradientTier[]>(DEFAULT_GRADIENT_SC);
  const [skuCellNotes, setSkuCellNotes] = useState<Record<string, string>>({});
  const [skuWorkNotes, setSkuWorkNotes] = useState<Record<string, string>>({});
  const [skuWorkNotes2, setSkuWorkNotes2] = useState<Record<string, string>>({});
  const [skuWorkNotes3, setSkuWorkNotes3] = useState<Record<string, string>>({});
  const skuWorkNotesRef = useRef<Array<Record<string, string>>>([{}, {}, {}]);
  const confirmedSkuWorkNotesRef = useRef<Array<Record<string, string>>>([{}, {}, {}]);
  const skuWorkNoteSaveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const skuWorkNoteRenderScheduledRef = useRef([false, false, false]);
  const [dbPrefsLoaded, setDbPrefsLoaded] = useState(false);
  const columnWidthsRef = useRef<ColumnWidths>({});
  const prefSaveTimerRef = useRef<number | null>(null);
  const skuFiltersRef = useRef<HTMLDivElement>(null);
  const categoryFilterRef = useRef<HTMLDivElement>(null);
  const categoryChangeTimerRef = useRef<number | null>(null);
  const agGridExportRef = useRef<(() => Promise<void>) | null>(null);
  const columnOrderChangedRef = useRef(false);

  // Debounced save of all preferences to DB (1.5s delay to batch rapid changes).
  // The mount-time GET below overwrites localStorage with whatever the DB has,
  // unconditionally — so a change made and then immediately refreshed away
  // (well inside the 1.5s window) would otherwise never reach the DB, and the
  // next load's GET would stomp the correct local value right back to the old
  // one. `latestPrefsRef` plus the pagehide/beforeunload flush below exist
  // specifically to close that window.
  const latestPrefsRef = useRef<Record<string, unknown> | null>(null);
  const putPrefs = useCallback((prefs: Record<string, unknown>, keepalive: boolean) => {
    fetch(apiPath("/api/user/preferences"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: prefs }),
      keepalive,
    }).catch(() => {});
  }, []);
  const savePrefsToDb = useCallback((prefs: Record<string, unknown>) => {
    latestPrefsRef.current = prefs;
    if (prefSaveTimerRef.current !== null) window.clearTimeout(prefSaveTimerRef.current);
    prefSaveTimerRef.current = window.setTimeout(() => {
      prefSaveTimerRef.current = null;
      latestPrefsRef.current = null;
      putPrefs(prefs, false);
    }, 1500);
  }, [putPrefs]);

  useEffect(() => {
    const flush = () => {
      if (prefSaveTimerRef.current === null || latestPrefsRef.current === null) return;
      window.clearTimeout(prefSaveTimerRef.current);
      prefSaveTimerRef.current = null;
      // `keepalive` lets this fetch survive the page actually unloading —
      // a plain fetch gets aborted along with everything else at that point.
      putPrefs(latestPrefsRef.current, true);
      latestPrefsRef.current = null;
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [putPrefs]);

  useEffect(() => {
    const saved = loadSavedColumnWidths();
    columnWidthsRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnWidths(saved);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnOrder(loadSavedColumnOrder());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnColors(loadSavedColumnColors());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setCellColors(loadSavedCellColors());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnTextFormats(loadSavedColumnTextFormats());
    setCellTextFormats(loadSavedCellTextFormats());
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLUMN_HEADER_NAMES_STORAGE_KEY) ?? "{}") as unknown;
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
        setColumnHeaderNames(Object.fromEntries(
          Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ));
      }
    } catch {
      window.localStorage.removeItem(COLUMN_HEADER_NAMES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setSeasonalFactors(loadSavedSeasonalFactors());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setSalesWindowWeights(loadSavedSalesWindowWeights());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setOosLostDemandWeights(loadSavedOosLostDemandWeights());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setGradient(loadSavedGradient());
    setGradientSC(loadSavedGradientSC());
  }, []);

  useEffect(() => {
    fetch(apiPath("/api/planning/sku-notes"), { cache: "no-store" })
      .then((response) => response.json() as Promise<{ success: boolean; data?: Record<string, string> }>)
      .then((json) => {
        if (json.success && json.data) setSkuCellNotes(json.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadSlot = (slot: 1 | 2 | 3, setter: (notes: Record<string, string>) => void) => {
      fetch(apiPath(`/api/planning/sku-work-notes?slot=${slot}`), { cache: "no-store" })
        .then((response) => response.json() as Promise<{ success: boolean; data?: Record<string, string> }>)
        .then((json) => {
          if (json.success && json.data) {
            const notes = { ...json.data };
            skuWorkNotesRef.current[slot - 1] = notes;
            confirmedSkuWorkNotesRef.current[slot - 1] = { ...notes };
            setter(notes);
          }
        })
        .catch(() => {});
    };
    loadSlot(1, setSkuWorkNotes);
    loadSlot(2, setSkuWorkNotes2);
    loadSlot(3, setSkuWorkNotes3);
  }, []);

  useEffect(() => {
    const saved = loadSavedColumnSettings();
    queueMicrotask(() => {
      if (saved.columnVis) {
        setColumnVis(saved.columnVis);
        setGroupVis(getGroupVisibilityFromColumns(saved.columnVis));
      } else if (saved.groupVis) {
        setGroupVis(saved.groupVis);
      }
      if (saved.compactMode !== undefined) setCompactMode(saved.compactMode);
      if (saved.showMistake !== undefined) setShowMistake(saved.showMistake);
      if (saved.showZeroSales !== undefined) setShowZeroSales(saved.showZeroSales);
      if (saved.freezeUntil) setFreezeUntil(saved.freezeUntil);
      setColumnSettingsLoaded(true);
    });
  }, []);

  // Load all preferences from DB on mount — overrides localStorage if DB has newer values
  useEffect(() => {
    fetch(apiPath("/api/user/preferences"))
      .then((r) => r.json() as Promise<{ success: boolean; data?: Record<string, unknown> }>)
      .then((json) => {
        if (!json.success || !json.data) return;
        const d = json.data;

        // Column settings
        const cs = d[COLUMN_SETTINGS_STORAGE_KEY];
        if (cs && typeof cs === "object" && !Array.isArray(cs)) {
          window.localStorage.setItem(COLUMN_SETTINGS_STORAGE_KEY, JSON.stringify(cs));
          const saved = cs as Record<string, unknown>;
          const colVis = normalizeColumnVisibility(saved.columnVis);
          if (colVis) { setColumnVis(colVis); setGroupVis(getGroupVisibilityFromColumns(colVis)); }
          if (typeof saved.compactMode === "boolean") setCompactMode(saved.compactMode);
          if (typeof saved.showMistake === "boolean") setShowMistake(saved.showMistake);
          if (typeof saved.showZeroSales === "boolean") setShowZeroSales(saved.showZeroSales);
          if (typeof saved.freezeUntil === "string") setFreezeUntil(saved.freezeUntil);
        }

        // Column widths
        const cw = d[COLUMN_WIDTHS_STORAGE_KEY];
        if (cw && typeof cw === "object" && !Array.isArray(cw)) {
          window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(cw));
          const widths = cw as ColumnWidths;
          columnWidthsRef.current = widths;
          setColumnWidths(widths);
        }

        const savedOrder = d[COLUMN_ORDER_STORAGE_KEY];
        if (!columnOrderChangedRef.current && Array.isArray(savedOrder)) {
          const normalizedOrder = ensureAdditionalNotesInColumnOrder(Array.from(new Set(
            savedOrder.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 300),
          )).slice(0, 5000));
          window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(normalizedOrder));
          setColumnOrder(normalizedOrder);
        } else if (!columnOrderChangedRef.current) {
          window.localStorage.removeItem(COLUMN_ORDER_STORAGE_KEY);
          setColumnOrder([]);
        }

        // Column colors
        const cc = d[COLUMN_COLORS_STORAGE_KEY];
        if (cc && typeof cc === "object" && !Array.isArray(cc)) {
          window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(cc));
          setColumnColors(cc as ColumnColorSettings);
        }

        const columnFormats = d[COLUMN_TEXT_FORMATS_STORAGE_KEY];
        if (columnFormats && typeof columnFormats === "object" && !Array.isArray(columnFormats)) {
          window.localStorage.setItem(COLUMN_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(columnFormats));
          setColumnTextFormats(columnFormats as ColumnTextFormatSettings);
        } else {
          window.localStorage.removeItem(COLUMN_TEXT_FORMATS_STORAGE_KEY);
          setColumnTextFormats({});
        }

        const cellFormats = d[CELL_TEXT_FORMATS_STORAGE_KEY];
        if (cellFormats && typeof cellFormats === "object" && !Array.isArray(cellFormats)) {
          window.localStorage.setItem(CELL_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(cellFormats));
          setCellTextFormats(cellFormats as CellTextFormatSettings);
        } else {
          window.localStorage.removeItem(CELL_TEXT_FORMATS_STORAGE_KEY);
          setCellTextFormats({});
        }

        // Per-user custom column header names
        const headerNames = d[COLUMN_HEADER_NAMES_STORAGE_KEY];
        if (headerNames && typeof headerNames === "object" && !Array.isArray(headerNames)) {
          const normalized = Object.fromEntries(
            Object.entries(headerNames).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          );
          window.localStorage.setItem(COLUMN_HEADER_NAMES_STORAGE_KEY, JSON.stringify(normalized));
          setColumnHeaderNames(normalized);
        } else {
          // localStorage is shared by accounts using the same browser. A successful
          // server response with no saved names must therefore restore defaults,
          // rather than briefly loaded names from a different signed-in user.
          window.localStorage.removeItem(COLUMN_HEADER_NAMES_STORAGE_KEY);
          setColumnHeaderNames({});
        }

        // Cell colors
        const cellC = d[CELL_COLORS_STORAGE_KEY];
        if (cellC && typeof cellC === "object" && !Array.isArray(cellC)) {
          window.localStorage.setItem(CELL_COLORS_STORAGE_KEY, JSON.stringify(cellC));
          setCellColors(cellC as CellColorSettings);
        }

        // Container visibility
        const containerVisibility = d[CONTAINER_VISIBILITY_STORAGE_KEY];
        if (containerVisibility && typeof containerVisibility === "object" && !Array.isArray(containerVisibility)) {
          const saved = containerVisibility as Record<string, unknown>;
          if (Array.isArray(saved.hiddenContainers)) {
            setHiddenContainers(new Set(saved.hiddenContainers.filter((name): name is string => typeof name === "string")));
          }
          if (Array.isArray(saved.hiddenBases)) {
            setHiddenBases(new Set(saved.hiddenBases.filter((name): name is string => typeof name === "string")));
          }
          if (Array.isArray(saved.hiddenContainerColumns)) {
            setHiddenContainerColumns(new Set(saved.hiddenContainerColumns.filter((id): id is string => typeof id === "string")));
          } else {
            setHiddenContainerColumns(new Set());
          }
        } else {
          setHiddenContainerColumns(new Set());
        }

        // Seasonal factors
        const sf = d[SEASONAL_FACTORS_STORAGE_KEY];
        if (sf && typeof sf === "object" && !Array.isArray(sf)) {
          window.localStorage.setItem(SEASONAL_FACTORS_STORAGE_KEY, JSON.stringify(sf));
          setSeasonalFactors(sf as SeasonalFactors);
        }

        // Sales window weights
        const sw = d[SALES_WINDOW_WEIGHTS_STORAGE_KEY];
        if (sw && typeof sw === "object" && !Array.isArray(sw)) {
          const normalized = normalizeSalesWindowWeights(sw);
          window.localStorage.setItem(SALES_WINDOW_WEIGHTS_STORAGE_KEY, JSON.stringify(normalized));
          setSalesWindowWeights(normalized);
        }

        // OOS lost-demand marketplace weights
        const ldw = d[OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY];
        if (ldw && typeof ldw === "object" && !Array.isArray(ldw)) {
          const normalized = normalizeOosLostDemandWeights(ldw);
          window.localStorage.setItem(OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY, JSON.stringify(normalized));
          setOosLostDemandWeights(normalized);
        }

        // Gradient tiers
        const gd = d[GRADIENT_STORAGE_KEY];
        if (Array.isArray(gd) && gd.length > 0) {
          window.localStorage.setItem(GRADIENT_STORAGE_KEY, JSON.stringify(gd));
          setGradient(gd as GradientTier[]);
        }

        const gdSC = d[GRADIENT_SC_STORAGE_KEY];
        if (Array.isArray(gdSC) && gdSC.length > 0) {
          window.localStorage.setItem(GRADIENT_SC_STORAGE_KEY, JSON.stringify(gdSC));
          setGradientSC(gdSC as GradientTier[]);
        }
      })
      .catch(() => {})
      .finally(() => setDbPrefsLoaded(true));
  }, []);

  useEffect(() => {
    if (!columnSettingsLoaded) return;
    window.localStorage.setItem(
      COLUMN_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        groupVis,
        columnVis,
        compactMode,
        showMistake,
        showZeroSales,
        freezeUntil,
      }),
    );
  }, [columnSettingsLoaded, groupVis, columnVis, compactMode, showMistake, showZeroSales, freezeUntil]);

  // Save all preferences to DB whenever any setting changes (debounced, after initial load)
  useEffect(() => {
    if (!columnSettingsLoaded || !dbPrefsLoaded) return;
    savePrefsToDb({
      [COLUMN_SETTINGS_STORAGE_KEY]: { groupVis, columnVis, compactMode, showMistake, showZeroSales, freezeUntil },
      [COLUMN_WIDTHS_STORAGE_KEY]: columnWidths,
      [COLUMN_ORDER_STORAGE_KEY]: columnOrder,
      [COLUMN_COLORS_STORAGE_KEY]: columnColors,
      [COLUMN_HEADER_NAMES_STORAGE_KEY]: columnHeaderNames,
      [CELL_COLORS_STORAGE_KEY]: cellColors,
      [COLUMN_TEXT_FORMATS_STORAGE_KEY]: columnTextFormats,
      [CELL_TEXT_FORMATS_STORAGE_KEY]: cellTextFormats,
      [CONTAINER_VISIBILITY_STORAGE_KEY]: {
        hiddenContainers: Array.from(hiddenContainers).sort(),
        hiddenBases: Array.from(hiddenBases).sort(),
        hiddenContainerColumns: Array.from(hiddenContainerColumns).sort(),
      },
      [SEASONAL_FACTORS_STORAGE_KEY]: seasonalFactors,
      [SALES_WINDOW_WEIGHTS_STORAGE_KEY]: salesWindowWeights,
      [OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY]: oosLostDemandWeights,
      [GRADIENT_STORAGE_KEY]: gradient,
      [GRADIENT_SC_STORAGE_KEY]: gradientSC,
    });
  }, [columnSettingsLoaded, dbPrefsLoaded, groupVis, columnVis, compactMode, showMistake, showZeroSales, freezeUntil, columnWidths, columnOrder, columnColors, columnHeaderNames, cellColors, columnTextFormats, cellTextFormats, hiddenContainers, hiddenBases, hiddenContainerColumns, seasonalFactors, salesWindowWeights, oosLostDemandWeights, gradient, gradientSC, savePrefsToDb]);

  const handleColumnWidthsChange = useCallback((next: ColumnWidths) => {
    columnWidthsRef.current = next;
    setColumnWidths(next);
  }, []);

  const resetColumnWidths = useCallback(() => {
    columnWidthsRef.current = {};
    setColumnWidths({});
    window.localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
  }, []);

  const handleColumnOrderChange = useCallback((movedOrder: ColumnOrder) => {
    columnOrderChangedRef.current = true;
    setColumnOrder((current) => {
      const moved = new Set(movedOrder);
      const next = [...movedOrder, ...current.filter((id) => !moved.has(id))];
      window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetColumnOrder = useCallback(() => {
    columnOrderChangedRef.current = true;
    setColumnOrder([]);
    window.localStorage.removeItem(COLUMN_ORDER_STORAGE_KEY);
  }, []);

  const handleColumnColorChange = useCallback((columnIds: string[], target: "cell" | "header", color: string) => {
    setColumnColors((current) => {
      const next = { ...current };
      for (const id of columnIds) {
        next[id] = { ...(next[id] ?? {}), [target]: color };
      }
      window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleGridColumnSelect = useCallback((columnId: string, additive: boolean, selection?: string[]) => {
    setActiveColorTarget("headers");
    setSelectedFullColumnIds([]);
    setSelectedColorColumns((current) => {
      if (selection) return selection;
      if (current.includes(columnId)) {
        return current.filter((id) => id !== columnId);
      }
      return additive ? [...current, columnId] : [columnId];
    });
  }, []);

  const handleFullColumnSelect = useCallback((columnId: string, additive: boolean, selection?: string[]) => {
    setActiveColorTarget("columns");
    setSelectedColorColumns([]);
    setSelectedFullColumnIds((current) => {
      if (selection) return selection;
      if (current.includes(columnId)) return current.filter((id) => id !== columnId);
      return additive ? [...current, columnId] : [columnId];
    });
  }, []);

  const handleGridColumnRename = useCallback((columnId: string, name: string) => {
    const normalizedName = name.trim().slice(0, 80);
    setColumnHeaderNames((current) => {
      const next = { ...current };
      if (normalizedName) next[columnId] = normalizedName;
      else delete next[columnId];
      window.localStorage.setItem(COLUMN_HEADER_NAMES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSelectedColumnColor = useCallback(() => {
    setColumnColors((current) => {
      const next = { ...current };
      for (const id of selectedColorColumns) {
        delete next[id];
      }
      if (Object.keys(next).length) {
        window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(COLUMN_COLORS_STORAGE_KEY);
      }
      return next;
    });
  }, [selectedColorColumns]);

  const resetColumnColors = useCallback(() => {
    setColumnColors({});
    window.localStorage.removeItem(COLUMN_COLORS_STORAGE_KEY);
  }, []);

  const resetColumnColorTarget = useCallback((columnIds: string[], target: "cell" | "header") => {
    setColumnColors((current) => {
      const next = { ...current };
      for (const id of columnIds) {
        const setting = { ...(next[id] ?? {}) };
        delete setting[target];
        if (Object.keys(setting).length) next[id] = setting;
        else delete next[id];
      }
      if (Object.keys(next).length) window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(COLUMN_COLORS_STORAGE_KEY);
      return next;
    });
  }, []);

  const handleSelectedCellColorChange = useCallback((color: string) => {
    if (!selectedAgCell) return;
    const targets = selectedAgCells.length ? selectedAgCells : [selectedAgCell];
    setCellColors((current) => {
      const next = { ...current };
      for (const cell of targets) {
        next[`${cell.rowId}::${cell.columnId}`] = color;
      }
      window.localStorage.setItem(CELL_COLORS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [selectedAgCell, selectedAgCells]);

  const resetSelectedCellColor = useCallback(() => {
    if (!selectedAgCell) return;
    const targets = selectedAgCells.length ? selectedAgCells : [selectedAgCell];
    setCellColors((current) => {
      const next = { ...current };
      for (const cell of targets) {
        delete next[`${cell.rowId}::${cell.columnId}`];
      }
      if (Object.keys(next).length) {
        window.localStorage.setItem(CELL_COLORS_STORAGE_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(CELL_COLORS_STORAGE_KEY);
      }
      return next;
    });
  }, [selectedAgCell, selectedAgCells]);

  const resetCellColors = useCallback(() => {
    setCellColors({});
    window.localStorage.removeItem(CELL_COLORS_STORAGE_KEY);
  }, []);

  const handleColumnTextFormatChange = useCallback((columnIds: string[], target: "cell" | "header", patch: TextFormatSettings) => {
    setColumnTextFormats((current) => {
      const next = { ...current };
      for (const id of columnIds) {
        next[id] = {
          ...(next[id] ?? {}),
          [target]: { ...(next[id]?.[target] ?? {}), ...patch },
        };
      }
      window.localStorage.setItem(COLUMN_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSelectedCellTextFormatChange = useCallback((patch: TextFormatSettings) => {
    if (!selectedAgCell) return;
    const targets = selectedAgCells.length ? selectedAgCells : [selectedAgCell];
    setCellTextFormats((current) => {
      const next = { ...current };
      for (const cell of targets) {
        const key = `${cell.rowId}::${cell.columnId}`;
        next[key] = { ...(next[key] ?? {}), ...patch };
      }
      window.localStorage.setItem(CELL_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [selectedAgCell, selectedAgCells]);

  const resetColumnTextFormatTarget = useCallback((columnIds: string[], target: "cell" | "header") => {
    setColumnTextFormats((current) => {
      const next = { ...current };
      for (const id of columnIds) {
        const setting = { ...(next[id] ?? {}) };
        delete setting[target];
        if (Object.keys(setting).length) next[id] = setting;
        else delete next[id];
      }
      if (Object.keys(next).length) window.localStorage.setItem(COLUMN_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(COLUMN_TEXT_FORMATS_STORAGE_KEY);
      return next;
    });
  }, []);

  const resetSelectedCellTextFormat = useCallback(() => {
    if (!selectedAgCell) return;
    const targets = selectedAgCells.length ? selectedAgCells : [selectedAgCell];
    setCellTextFormats((current) => {
      const next = { ...current };
      for (const cell of targets) delete next[`${cell.rowId}::${cell.columnId}`];
      if (Object.keys(next).length) window.localStorage.setItem(CELL_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(CELL_TEXT_FORMATS_STORAGE_KEY);
      return next;
    });
  }, [selectedAgCell, selectedAgCells]);

  const resetSelectedCellTextColor = useCallback(() => {
    if (!selectedAgCell) return;
    const targets = selectedAgCells.length ? selectedAgCells : [selectedAgCell];
    setCellTextFormats((current) => {
      const next = { ...current };
      for (const cell of targets) {
        const key = `${cell.rowId}::${cell.columnId}`;
        const format = { ...(next[key] ?? {}) };
        delete format.color;
        if (Object.keys(format).length) next[key] = format;
        else delete next[key];
      }
      if (Object.keys(next).length) window.localStorage.setItem(CELL_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(CELL_TEXT_FORMATS_STORAGE_KEY);
      return next;
    });
  }, [selectedAgCell, selectedAgCells]);

  const resetAllTextColors = useCallback(() => {
    setColumnTextFormats((current) => {
      const next: ColumnTextFormatSettings = {};
      for (const [key, setting] of Object.entries(current)) {
        const strippedSetting: { cell?: TextFormatSettings; header?: TextFormatSettings } = {};
        for (const target of ["cell", "header"] as const) {
          const format = setting[target];
          if (!format) continue;
          const stripped = { ...format };
          delete stripped.color;
          if (Object.keys(stripped).length) strippedSetting[target] = stripped;
        }
        if (Object.keys(strippedSetting).length) next[key] = strippedSetting;
      }
      if (Object.keys(next).length) window.localStorage.setItem(COLUMN_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(COLUMN_TEXT_FORMATS_STORAGE_KEY);
      return next;
    });
    setCellTextFormats((current) => {
      const next: CellTextFormatSettings = {};
      for (const [key, format] of Object.entries(current)) {
        const stripped = { ...format };
        delete stripped.color;
        if (Object.keys(stripped).length) next[key] = stripped;
      }
      if (Object.keys(next).length) window.localStorage.setItem(CELL_TEXT_FORMATS_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(CELL_TEXT_FORMATS_STORAGE_KEY);
      return next;
    });
  }, []);

  const resetAllTextFormatting = useCallback(() => {
    setColumnTextFormats({});
    setCellTextFormats({});
    window.localStorage.removeItem(COLUMN_TEXT_FORMATS_STORAGE_KEY);
    window.localStorage.removeItem(CELL_TEXT_FORMATS_STORAGE_KEY);
  }, []);

  const resetAllColumnSettings = useCallback(() => {
    resetColumnWidths();
    resetColumnOrder();
    resetColumnColors();
    resetCellColors();
    resetAllTextColors();
    resetAllTextFormatting();
  }, [resetAllTextColors, resetAllTextFormatting, resetCellColors, resetColumnColors, resetColumnOrder, resetColumnWidths]);

  const selectedCellKeys = useMemo(
    () => selectedAgCells.map((cell) => `${cell.rowId}::${cell.columnId}`),
    [selectedAgCells],
  );

  const selectedCellColorInfo = useMemo(() => {
    if (!selectedAgCell) return { color: "#FFFFFF", label: "No cell" };
    const keys = selectedCellKeys.length ? selectedCellKeys : [`${selectedAgCell.rowId}::${selectedAgCell.columnId}`];
    const colors = keys.map((key) => cellColors[key] ?? "#FFFFFF");
    const unique = Array.from(new Set(colors));
    return unique.length === 1
      ? { color: unique[0], label: unique[0] === "#FFFFFF" ? "Default" : unique[0].toUpperCase() }
      : { color: "#FFFFFF", label: "Mixed" };
  }, [cellColors, selectedAgCell, selectedCellKeys]);

  const selectedHeaderColorInfo = useMemo(() => {
    if (!selectedColorColumns.length) return { color: "#FFFFFF", mixed: false };
    const colors = selectedColorColumns.map((id) => columnColors[id]?.header ?? "#2A2825");
    const uniqueColors = Array.from(new Set(colors.map((color) => color.toUpperCase())));
    return { color: uniqueColors[0] ?? "#2A2825", mixed: uniqueColors.length > 1 };
  }, [columnColors, selectedColorColumns]);

  const selectedFullColumnColorInfo = useMemo(() => {
    if (!selectedFullColumnIds.length) return { color: "#FFFFFF", mixed: false };
    const colors = selectedFullColumnIds.map((id) => columnColors[id]?.cell ?? "#FFFFFF");
    const uniqueColors = Array.from(new Set(colors.map((color) => color.toUpperCase())));
    return { color: uniqueColors[0] ?? "#FFFFFF", mixed: uniqueColors.length > 1 };
  }, [columnColors, selectedFullColumnIds]);

  const fillPaletteEnabled = activeColorTarget === "headers"
    ? selectedColorColumns.length > 0
    : activeColorTarget === "columns"
      ? selectedFullColumnIds.length > 0
      : Boolean(selectedAgCell);
  const isContainerHeaderTextTarget = activeColorTarget === "headers"
    && selectedColorColumns.length > 0
    && selectedColorColumns.every((id) => id.startsWith("container:"));
  const fillPaletteColor = activeColorTarget === "headers"
    ? selectedHeaderColorInfo.color
    : activeColorTarget === "columns"
      ? selectedFullColumnColorInfo.color
      : selectedCellColorInfo.color;
  const cellSelectionCount = selectedAgCells.length || (selectedAgCell ? 1 : 0);
  const fillPaletteTargetLabel = activeColorTarget === "headers"
    ? pick(`선택 헤더 ${selectedColorColumns.length}개`, `${selectedColorColumns.length} selected header${selectedColorColumns.length === 1 ? "" : "s"}`)
    : activeColorTarget === "columns"
      ? pick(`전체 컬럼 ${selectedFullColumnIds.length}개`, `${selectedFullColumnIds.length} entire column${selectedFullColumnIds.length === 1 ? "" : "s"}`)
      : pick(`선택 셀 ${cellSelectionCount}개`, `${cellSelectionCount} selected cell${cellSelectionCount === 1 ? "" : "s"}`);

  const handleFillColorApply = useCallback((color: string) => {
    if (activeColorTarget === "headers") {
      if (!selectedColorColumns.length) return;
      handleColumnColorChange(selectedColorColumns, "header", color);
      return;
    }
    if (activeColorTarget === "columns") {
      if (!selectedFullColumnIds.length) return;
      handleColumnColorChange(selectedFullColumnIds, "cell", color);
      return;
    }
    handleSelectedCellColorChange(color);
  }, [activeColorTarget, handleColumnColorChange, handleSelectedCellColorChange, selectedColorColumns, selectedFullColumnIds]);

  const handleFillColorReset = useCallback(() => {
    if (!confirmReset("선택한 채우기 색상", "the selected fill color")) return;
    if (activeColorTarget === "headers") {
      resetColumnColorTarget(selectedColorColumns, "header");
      return;
    }
    if (activeColorTarget === "columns") {
      resetColumnColorTarget(selectedFullColumnIds, "cell");
      return;
    }
    resetSelectedCellColor();
  }, [activeColorTarget, confirmReset, resetColumnColorTarget, resetSelectedCellColor, selectedColorColumns, selectedFullColumnIds]);

  const currentTextFormat = useMemo<Required<TextFormatSettings>>(() => {
    const selectedCellColumnId = activeColorTarget === "columns"
      ? selectedFullColumnIds[0]
      : selectedAgCell?.columnId;
    const defaultFormat = activeColorTarget === "headers"
      ? { fontSize: 10, bold: false, color: "#FFFFFF" }
      : { fontSize: defaultCellTextFontSize(selectedCellColumnId), bold: false, color: "#1A1917" };
    let selectedFormat: TextFormatSettings | undefined;
    if (activeColorTarget === "headers") {
      selectedFormat = columnTextFormats[selectedColorColumns[0] ?? ""]?.header;
    } else if (activeColorTarget === "columns") {
      selectedFormat = columnTextFormats[selectedFullColumnIds[0] ?? ""]?.cell;
    } else if (selectedAgCell) {
      selectedFormat = cellTextFormats[`${selectedAgCell.rowId}::${selectedAgCell.columnId}`];
    }
    return { ...defaultFormat, ...(selectedFormat ?? {}) };
  }, [activeColorTarget, cellTextFormats, columnTextFormats, selectedAgCell, selectedColorColumns, selectedFullColumnIds]);

  const handleTextFormatApply = useCallback((patch: TextFormatSettings) => {
    if (activeColorTarget === "headers") {
      if (selectedColorColumns.length) handleColumnTextFormatChange(selectedColorColumns, "header", patch);
      return;
    }
    if (activeColorTarget === "columns") {
      if (selectedFullColumnIds.length) handleColumnTextFormatChange(selectedFullColumnIds, "cell", patch);
      return;
    }
    handleSelectedCellTextFormatChange(patch);
  }, [activeColorTarget, handleColumnTextFormatChange, handleSelectedCellTextFormatChange, selectedColorColumns, selectedFullColumnIds]);

  const handleTextFormatReset = useCallback(() => {
    if (!confirmReset("선택한 텍스트 서식", "the selected text formatting")) return;
    if (activeColorTarget === "headers") {
      resetColumnTextFormatTarget(selectedColorColumns, "header");
      return;
    }
    if (activeColorTarget === "columns") {
      resetColumnTextFormatTarget(selectedFullColumnIds, "cell");
      return;
    }
    resetSelectedCellTextFormat();
  }, [activeColorTarget, confirmReset, resetColumnTextFormatTarget, resetSelectedCellTextFormat, selectedColorColumns, selectedFullColumnIds]);

  const handleSeasonalFactorsChange = useCallback((next: SeasonalFactors) => {
    setSeasonalFactors(next);
    window.localStorage.setItem(SEASONAL_FACTORS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleSalesWindowWeightsChange = useCallback((next: SalesWindowWeights) => {
    const normalized = normalizeSalesWindowWeights(next);
    setSalesWindowWeights(normalized);
    window.localStorage.setItem(SALES_WINDOW_WEIGHTS_STORAGE_KEY, JSON.stringify(normalized));
  }, []);

  const handleOosLostDemandWeightsChange = useCallback((next: OosLostDemandWeights) => {
    const normalized = normalizeOosLostDemandWeights(next);
    setOosLostDemandWeights(normalized);
    window.localStorage.setItem(OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY, JSON.stringify(normalized));
  }, []);

  const handleGradientChange = useCallback((next: GradientTier[]) => {
    setGradient(next);
    saveGradient(next);
  }, []);

  const handleGradientSCChange = useCallback((next: GradientTier[]) => {
    setGradientSC(next);
    saveGradientSC(next);
  }, []);

  const handleSkuCellNoteChange = useCallback(async (sku: string, note: string) => {
    const normalizedSku = sku.trim();
    const normalizedNote = note.trim();
    if (!normalizedSku) return;

    const response = await fetch(apiPath("/api/planning/sku-notes"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: normalizedSku, note: normalizedNote }),
    });
    if (!response.ok) throw new Error("Failed to save SKU note");

    setSkuCellNotes((current) => {
      const next = { ...current };
      if (normalizedNote) {
        next[normalizedSku] = normalizedNote;
      } else {
        delete next[normalizedSku];
      }
      return next;
    });
  }, []);

  const handleSkuWorkNoteChange = useCallback((sku: string, note: string, slot: 1 | 2 | 3 = 1) => {
    const normalizedSku = sku.trim();
    const normalizedNote = note.trim().replace(/\s*[\r\n]+\s*/g, " ");
    if (!normalizedSku) return;

    const setter = slot === 2 ? setSkuWorkNotes2 : slot === 3 ? setSkuWorkNotes3 : setSkuWorkNotes;
    const slotIndex = slot - 1;
    const applyLocalValue = (value: string) => {
      // Clone only once per microtask. Bulk delete/paste can update hundreds
      // of cells synchronously without cloning the full SKU map per cell.
      if (!skuWorkNoteRenderScheduledRef.current[slotIndex]) {
        skuWorkNotesRef.current[slotIndex] = { ...skuWorkNotesRef.current[slotIndex] };
        skuWorkNoteRenderScheduledRef.current[slotIndex] = true;
        queueMicrotask(() => {
          skuWorkNoteRenderScheduledRef.current[slotIndex] = false;
          const snapshot = skuWorkNotesRef.current[slotIndex];
          // Keep typing responsive while the large grid row model catches up.
          startTransition(() => setter(snapshot));
        });
      }
      const pending = skuWorkNotesRef.current[slotIndex];
      if (value) pending[normalizedSku] = value;
      else delete pending[normalizedSku];
    };

    // Update the grid immediately. Persistence is serialized per SKU/slot so
    // rapid edits cannot arrive at the server out of order.
    applyLocalValue(normalizedNote);
    const queueKey = `${slot}\u0000${normalizedSku}`;
    const previousSave = skuWorkNoteSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const save = previousSave.catch(() => {}).then(async () => {
      const response = await fetch(apiPath("/api/planning/sku-work-notes"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: normalizedSku, note: normalizedNote, slot }),
      });
      if (!response.ok) throw new Error("Failed to save SKU work note");

      const confirmed = confirmedSkuWorkNotesRef.current[slotIndex];
      if (normalizedNote) confirmed[normalizedSku] = normalizedNote;
      else delete confirmed[normalizedSku];
    }).catch(() => {
      // Roll back only if this failed value is still the latest visible edit.
      // A newer queued edit owns the cell and must not be overwritten.
      if ((skuWorkNotesRef.current[slotIndex][normalizedSku] ?? "") !== normalizedNote) return;
      applyLocalValue(confirmedSkuWorkNotesRef.current[slotIndex][normalizedSku] ?? "");
    });
    skuWorkNoteSaveQueuesRef.current.set(queueKey, save);
    void save.finally(() => {
      if (skuWorkNoteSaveQueuesRef.current.get(queueKey) === save) {
        skuWorkNoteSaveQueuesRef.current.delete(queueKey);
      }
    });
  }, []);

  const handleToggleColumnVisibilityGroupOpen = useCallback((group: ColumnGroupKey) => {
    setOpenColumnVisibilityGroups((current) => ({ ...current, [group]: !current[group] }));
  }, []);

  const handleToggleColumn = useCallback(
    (columnId: string) => {
      setCompactMode(false);
      setColumnVis((current) => {
        const next = { ...current, [columnId]: current[columnId] === false };
        setGroupVis(getGroupVisibilityFromColumns(next));

        const nextVisCols = ALL_COLS.filter((column) => next[column.id] !== false);
        const stillVisible = nextVisCols.some((column) => column.id === freezeUntil);
        if (!stillVisible && nextVisCols.length > 0) {
          setFreezeUntil(nextVisCols[nextVisCols.length - 1].id);
        }
        return next;
      });
    },
    [freezeUntil],
  );

  const handleHideColumns = useCallback((columnIds: string[]) => {
    const ids = [...new Set(columnIds)];
    if (!ids.length) return;
    setCompactMode(false);
    setColumnVis((current) => {
      const next = { ...current };
      for (const columnId of ids) next[columnId] = false;
      setGroupVis(getGroupVisibilityFromColumns(next));

      const nextVisCols = ALL_COLS.filter((column) => next[column.id] !== false);
      const stillVisible = nextVisCols.some((column) => column.id === freezeUntil);
      if (!stillVisible && nextVisCols.length > 0) {
        setFreezeUntil(nextVisCols[nextVisCols.length - 1].id);
      }
      return next;
    });
    setSelectedColorColumns([]);
    setSelectedFullColumnIds([]);
    setSelectedAgCell(null);
    setSelectedAgCells([]);
  }, [freezeUntil]);

  const handleHideContainer = useCallback((containerName: string, baseline: boolean) => {
    const update = (current: Set<string>) => {
      const next = new Set(current);
      next.add(containerName);
      return next;
    };
    if (baseline) setHiddenBases(update);
    else setHiddenContainers(update);
  }, []);

  const handleToggleContainerColumns = useCallback((columnIds: string[]) => {
    setHiddenContainerColumns((current) => {
      const next = new Set(current);
      for (const columnId of columnIds) {
        if (next.has(columnId)) next.delete(columnId);
        else next.add(columnId);
      }
      return next;
    });
    setSelectedColorColumns([]);
    setSelectedFullColumnIds([]);
    setSelectedAgCell(null);
    setSelectedAgCells([]);
  }, []);

  const hiddenColumnCount = COLUMN_VISIBILITY_ITEMS.filter((item) => columnVis[item.id] === false).length;

  // ─────────────────────────────────────────────────────────────────────────────

  // SKU sub-filters (Fabric/Seat/Size/Color/etc.) are shaped per base category. When multiple
  // base categories are checked, key off the first one in a fixed priority; hide the panel
  // entirely when only SWC is checked (it has no sub-filter shape).
  const primaryBaseCategory = useMemo(
    () => BASE_CATEGORY_ORDER.find((c) => categoryFilter.includes(c)),
    [categoryFilter],
  );
  const activeSkuFilterKeys = useMemo(
    () => primaryBaseCategory ? skuFilterKeysForProduct(primaryBaseCategory) : [],
    [primaryBaseCategory],
  );
  const activeSkuPartFilters = useMemo(() => {
    const next = { ...EMPTY_SKU_PART_FILTERS };
    activeSkuFilterKeys.forEach((key) => {
      next[key] = skuPartFilters[key];
    });
    return next;
  }, [activeSkuFilterKeys, skuPartFilters]);

  const skuFilterOptions = useMemo(() => {
    const activeKeys = activeSkuFilterKeys;
    const options = Object.fromEntries(
      activeKeys.map((key) => [key, new Set<string>()]),
    ) as Record<SkuPartFilterKey, Set<string>>;
    for (const row of data.rows) {
      if (!primaryBaseCategory || categoryCodeForRow(row) !== primaryBaseCategory.toUpperCase()) continue;
      const parts = skuPartsForRow(row);
      activeKeys.forEach((key) => {
        if (parts[key]) options[key].add(parts[key]);
      });
    }
    return Object.fromEntries(
      activeKeys.map((key) => [key, sortSkuFilterValues(options[key])]),
    ) as Record<SkuPartFilterKey, string[]>;
  }, [activeSkuFilterKeys, primaryBaseCategory, data.rows]);

  const handleColumnSettingsOpenChange = useCallback((open: boolean) => {
    setIsColumnSettingsOpen(open);
    setOpenSkuFilterKey(null);
    if (open) {
      setColumnSettingsDraft({
        columnVis: { ...columnVis },
        compactMode,
        showZeroSales,
        freezeUntil,
        skuPartFilters: cloneSkuPartFilters(skuPartFilters),
        hiddenContainers: new Set(hiddenContainers),
        hiddenBases: new Set(hiddenBases),
        hiddenContainerColumns: new Set(hiddenContainerColumns),
      });
    } else {
      setColumnSettingsDraft(null);
    }
  }, [columnVis, compactMode, freezeUntil, hiddenBases, hiddenContainers, hiddenContainerColumns, showZeroSales, skuPartFilters]);

  const applyColumnSettingsDraft = useCallback(() => {
    if (!columnSettingsDraft) return;
    setColumnVis({ ...columnSettingsDraft.columnVis });
    setGroupVis(getGroupVisibilityFromColumns(columnSettingsDraft.columnVis));
    setCompactMode(columnSettingsDraft.compactMode);
    setShowZeroSales(columnSettingsDraft.showZeroSales);
    setFreezeUntil(columnSettingsDraft.freezeUntil);
    setSkuPartFilters(cloneSkuPartFilters(columnSettingsDraft.skuPartFilters));
    setHiddenContainers(new Set(columnSettingsDraft.hiddenContainers));
    setHiddenBases(new Set(columnSettingsDraft.hiddenBases));
    setHiddenContainerColumns(new Set(columnSettingsDraft.hiddenContainerColumns));
    setIsColumnSettingsOpen(false);
    setColumnSettingsDraft(null);
    setOpenSkuFilterKey(null);
  }, [columnSettingsDraft]);

  const handleDraftPreset = useCallback((preset: "all" | "core" | "compact") => {
    setColumnSettingsDraft((current) => {
      if (!current) return current;
      const nextColumnVis = getColumnVisibilityForPreset(preset);
      return {
        ...current,
        columnVis: nextColumnVis,
        compactMode: preset === "compact",
        freezeUntil: preset === "compact" ? "sod" : freezeColumnForVisibility(nextColumnVis, current.freezeUntil),
      };
    });
  }, []);

  const handleDraftToggleContainerColumns = useCallback(() => {
    setColumnSettingsDraft((current) => {
      if (!current) return current;
      const containerItems = COLUMN_VISIBILITY_ITEMS.filter((item) => item.group === "con");
      const allVisible = containerItems.every((item) => current.columnVis[item.id] !== false);
      const nextColumnVis = { ...current.columnVis };
      containerItems.forEach((item) => { nextColumnVis[item.id] = !allVisible; });
      return { ...current, columnVis: nextColumnVis, compactMode: false };
    });
  }, []);

  const handleDraftToggleColumnGroup = useCallback((group: ColumnGroupKey) => {
    setColumnSettingsDraft((current) => {
      if (!current) return current;
      const items = COLUMN_VISIBILITY_ITEMS.filter((item) => item.group === group);
      const allVisible = items.every((item) => current.columnVis[item.id] !== false);
      const nextColumnVis = { ...current.columnVis };
      items.forEach((item) => { nextColumnVis[item.id] = !allVisible; });
      return {
        ...current,
        columnVis: nextColumnVis,
        compactMode: false,
        freezeUntil: freezeColumnForVisibility(nextColumnVis, current.freezeUntil),
      };
    });
  }, []);

  const handleDraftToggleColumn = useCallback((columnId: string) => {
    setColumnSettingsDraft((current) => {
      if (!current) return current;
      const nextColumnVis = { ...current.columnVis, [columnId]: current.columnVis[columnId] === false };
      return {
        ...current,
        columnVis: nextColumnVis,
        compactMode: false,
        freezeUntil: freezeColumnForVisibility(nextColumnVis, current.freezeUntil),
      };
    });
  }, []);

  const handleDraftSkuPartFilterToggle = useCallback((key: SkuPartFilterKey, value: string) => {
    setColumnSettingsDraft((current) => {
      if (!current) return current;
      const selected = new Set(current.skuPartFilters[key]);
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      return {
        ...current,
        skuPartFilters: { ...current.skuPartFilters, [key]: sortSkuFilterValues(selected) },
      };
    });
  }, []);

  const draftColumnVis = columnSettingsDraft?.columnVis ?? columnVis;
  const draftCompactMode = columnSettingsDraft?.compactMode ?? compactMode;
  const draftShowZeroSales = columnSettingsDraft?.showZeroSales ?? showZeroSales;
  const draftFreezeUntil = columnSettingsDraft?.freezeUntil ?? freezeUntil;
  const draftSkuPartFilters = columnSettingsDraft?.skuPartFilters ?? skuPartFilters;
  const draftHiddenContainers = columnSettingsDraft?.hiddenContainers ?? hiddenContainers;
  const draftHiddenBases = columnSettingsDraft?.hiddenBases ?? hiddenBases;
  const draftHiddenContainerColumns = columnSettingsDraft?.hiddenContainerColumns ?? hiddenContainerColumns;
  const orderedColumnVisibilityItems = useMemo(() => {
    const orderIndex = new Map(columnOrder.map((columnId, index) => [columnId, index]));
    const fallbackOffset = columnOrder.length + 10_000;
    const rank = (item: ColumnVisibilityItem, fallbackIndex: number) => {
      if (item.kind === "base") return orderIndex.get(item.id) ?? fallbackOffset + fallbackIndex;
      // Every container can have a different leaf-column order in the grid.
      // The settings popup therefore keeps the shared container visibility
      // list in its canonical order instead of implying one container's order
      // is the global order for all containers.
      return fallbackOffset + fallbackIndex;
    };

    return COLUMN_VISIBILITY_ITEMS
      .map((item, fallbackIndex) => ({
        ...item,
        label: columnHeaderNames[item.id] ?? item.label,
        orderRank: rank(item, fallbackIndex),
        fallbackIndex,
      }))
      .sort((a, b) => a.orderRank - b.orderRank || a.fallbackIndex - b.fallbackIndex);
  }, [columnHeaderNames, columnOrder]);
  const orderedColumnVisibilityGroupKeys = useMemo(() => {
    const movableGroups = COLUMN_VISIBILITY_GROUP_KEYS.filter((group) => group !== "con");
    const fallbackGroupIndex = new Map(movableGroups.map((group, index) => [group, index]));
    const orderedMovableGroups = [...movableGroups].sort((a, b) => {
      const firstA = orderedColumnVisibilityItems.findIndex((item) => item.group === a);
      const firstB = orderedColumnVisibilityItems.findIndex((item) => item.group === b);
      const rankA = firstA < 0 ? Number.POSITIVE_INFINITY : firstA;
      const rankB = firstB < 0 ? Number.POSITIVE_INFINITY : firstB;
      return rankA - rankB || (fallbackGroupIndex.get(a) ?? 0) - (fallbackGroupIndex.get(b) ?? 0);
    });
    return [...orderedMovableGroups, "con" as ColumnGroupKey];
  }, [orderedColumnVisibilityItems]);
  const draftActiveSkuPartFilters = useMemo(() => {
    const next = { ...EMPTY_SKU_PART_FILTERS };
    activeSkuFilterKeys.forEach((key) => { next[key] = draftSkuPartFilters[key]; });
    return next;
  }, [activeSkuFilterKeys, draftSkuPartFilters]);
  const draftHasSkuPartFilters = activeSkuFilterKeys.some((key) => draftActiveSkuPartFilters[key].length > 0);
  const draftAllPresetActive = columnVisibilityEquals(draftColumnVis, getColumnVisibilityForPreset("all"));
  const draftCorePresetActive = columnVisibilityEquals(draftColumnVis, getColumnVisibilityForPreset("core"));
  const draftCompactPresetActive = draftCompactMode && columnVisibilityEquals(draftColumnVis, getColumnVisibilityForPreset("compact"));
  const draftAllContainerColumnsVisible = orderedColumnVisibilityItems
    .filter((item) => item.group === "con")
    .every((item) => draftColumnVis[item.id] !== false);
  const draftVisColsForFreeze = useMemo(
    () => orderedColumnVisibilityItems.filter(
      (column) => column.kind === "base" && draftColumnVis[column.id] !== false,
    ),
    [draftColumnVis, orderedColumnVisibilityItems],
  );
  const columnSettingsChangeCount = useMemo(() => {
    if (!columnSettingsDraft) return 0;
    let count = 0;
    for (const item of orderedColumnVisibilityItems) {
      if ((columnSettingsDraft.columnVis[item.id] !== false) !== (columnVis[item.id] !== false)) count += 1;
    }
    if (columnSettingsDraft.compactMode !== compactMode) count += 1;
    if (columnSettingsDraft.showZeroSales !== showZeroSales) count += 1;
    if (columnSettingsDraft.freezeUntil !== freezeUntil) count += 1;
    for (const key of Object.keys(EMPTY_SKU_PART_FILTERS) as SkuPartFilterKey[]) {
      if (columnSettingsDraft.skuPartFilters[key].join("\u0000") !== skuPartFilters[key].join("\u0000")) count += 1;
    }
    const draftContainers = Array.from(columnSettingsDraft.hiddenContainers).sort().join("\u0000");
    const appliedContainers = Array.from(hiddenContainers).sort().join("\u0000");
    if (draftContainers !== appliedContainers) count += 1;
    const draftBases = Array.from(columnSettingsDraft.hiddenBases).sort().join("\u0000");
    const appliedBases = Array.from(hiddenBases).sort().join("\u0000");
    if (draftBases !== appliedBases) count += 1;
    const draftContainerColumns = Array.from(columnSettingsDraft.hiddenContainerColumns).sort().join("\u0000");
    const appliedContainerColumns = Array.from(hiddenContainerColumns).sort().join("\u0000");
    if (draftContainerColumns !== appliedContainerColumns) count += 1;
    return count;
  }, [columnSettingsDraft, columnVis, compactMode, freezeUntil, hiddenBases, hiddenContainers, hiddenContainerColumns, orderedColumnVisibilityItems, showZeroSales, skuPartFilters]);

  const handleAgGridExportReady = useCallback((exporter: (() => Promise<void>) | null) => {
    agGridExportRef.current = exporter;
  }, []);

  const handleExport = useCallback(() => {
    if (gridMode === "ag-grid" && agGridExportRef.current) {
      void agGridExportRef.current();
      return;
    }

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
  }, [filteredRows, gridMode]);

  const hasData = data.rows.length > 0;

  return (
    <div
      style={{
        position: "fixed",
        top: "var(--app-header-height, 56px)",
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
          overflowY: "hidden",
        }}
      >
<div ref={categoryFilterRef} style={{ position: "relative", flexShrink: 0 }}>
          <details open={isCategoryDropdownOpen} style={{ position: "relative" }}>
            <summary
              aria-label="Product category"
              onClick={(event) => {
                event.preventDefault();
                setIsCategoryDropdownOpen((open) => {
                  const next = !open;
                  if (next) {
                    const rect = categoryFilterRef.current?.getBoundingClientRect();
                    if (rect) setCategoryDropdownPos({ top: rect.bottom + 4, left: rect.left });
                  }
                  return next;
                });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 112,
                height: 26,
                boxSizing: "border-box",
                padding: "2px 7px",
                borderRadius: 4,
                border: "1px solid #C2BFB5",
                background: "#E3F5EC",
                color: "#0A6A45",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                listStyle: "none",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {categoryFilterSummary(categoryFilter)}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 9 }}>▼</span>
            </summary>
            <div
              style={{
                // Fixed (not absolute) so this escapes the toolbar's overflowX:auto ancestor,
                // which otherwise clips anything extending past its 42px height.
                position: "fixed",
                top: categoryDropdownPos?.top ?? 0,
                left: categoryDropdownPos?.left ?? 0,
                zIndex: 50,
                minWidth: 140,
                borderRadius: 5,
                border: "1px solid #CBD5E1",
                background: "#fff",
                boxShadow: "0 8px 20px rgba(15, 23, 42, .16)",
                padding: 5,
              }}
            >
              {CATEGORY_FILTER_OPTIONS.map((option) => {
                const checked = categoryFilter.includes(option.value);
                return (
                  <label
                    key={option.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 5px",
                      borderRadius: 4,
                      cursor: "pointer",
                      background: checked ? "rgba(10,106,69,.08)" : "transparent",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleCategoryFilter(option.value)}
                      style={{ width: 13, height: 13, cursor: "pointer", accentColor: "#0A6A45" }}
                    />
                    <span style={{ fontSize: 12, color: checked ? "#0A6A45" : "#334155", fontWeight: checked ? 700 : 500 }}>
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>

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
            borderColor: urgencyFilter === "crit" ? "#f0aaaa" : urgencyFilter === "warn" ? "#f0d0aa" : urgencyFilter === "bo" ? "#aac0f0" : urgencyFilter === "over" ? "#a0b4f0" : "#C2BFB5",
            background: urgencyFilter === "crit" ? "#FFEDED" : urgencyFilter === "warn" ? "#FEF3D8" : urgencyFilter === "bo" ? "#E5EEFF" : urgencyFilter === "over" ? "#EEF3FF" : "#fff",
            color: urgencyFilter === "crit" ? "#C42020" : urgencyFilter === "warn" ? "#9A5200" : urgencyFilter === "bo" ? "#1A4FC0" : urgencyFilter === "over" ? "#1940B0" : "#1A1917",
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
          <>
          <Popover open={isColumnSettingsOpen} onOpenChange={handleColumnSettingsOpenChange}>
            <PopoverTrigger asChild>
              <button
                ref={columnSettingsButtonRef}
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
                ⊞ {pick("컬럼", "Columns")}
                {compactMode ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#E5EEFF", color: "#1A4FC0" }}>
                    {pick("간단히", "Compact")}
                  </span>
                ) : hiddenColumnCount > 0 ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#FFEDED", color: "#C42020" }}>
                    {hiddenColumnCount} {pick("숨김", "hidden")}
                  </span>
                ) : null}
                {" ▾"}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="dashboard-columns-popover"
              style={{
                width: "min(1100px, calc(100vw - 24px))",
                maxHeight: "min(920px, calc(100vh - 60px))",
                padding: 0,
                overflow: "auto",
                display: "grid",
                gridTemplateColumns: "minmax(280px, 0.95fr) minmax(360px, 1fr) minmax(200px, 0.65fr)",
                alignItems: "start",
              }}
            >
              {/* Header with close button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid #E2E8F0", gridColumn: "1 / -1", position: "sticky", top: 0, zIndex: 1, background: "#fff" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1E293B" }}>
                  {pick("컬럼 설정", "Columns")}
                  {columnSettingsChangeCount > 0 ? (
                    <span style={{ marginLeft: 7, color: "#2563EB", fontSize: 10 }}>
                      {pick(`${columnSettingsChangeCount}개 변경 대기`, `${columnSettingsChangeCount} pending`)}
                    </span>
                  ) : null}
                </span>
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
              <div style={{ gridColumn: 1, gridRow: "2 / 5", minWidth: 0, maxHeight: "min(700px, calc(100vh - 200px))", overflowY: "auto" }}>
              {/* Quick Presets */}
              <div style={{ padding: "8px 14px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, marginBottom: 6 }}>
                  {pick("빠른 컬럼 표시 설정", "Quick Column Visibility Settings")}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {([
                    { label: pick("전체", "All"), action: () => handleDraftPreset("all"), active: draftAllPresetActive },
                    { label: pick("핵심", "Core"), action: () => handleDraftPreset("core"), active: draftCorePresetActive },
                    { label: pick("간단히", "Compact"), action: () => handleDraftPreset("compact"), active: draftCompactPresetActive },
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
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <span
                    aria-hidden="true"
                    style={{
                      alignSelf: "center",
                      width: 1,
                      height: 22,
                      flexShrink: 0,
                      margin: "0 1px",
                      background: "#CBD5E1",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleDraftToggleContainerColumns}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: 5,
                      border: draftAllContainerColumnsVisible ? "1px solid #3B82F6" : "1px solid #CBD5E1",
                      cursor: "pointer",
                      background: draftAllContainerColumnsVisible ? "#EFF6FF" : "#F8FAFC",
                      color: draftAllContainerColumnsVisible ? "#1D4ED8" : "#475569",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pick("컨테이너 컬럼", "Container Columns")}
                  </button>
                </div>
              </div>

              {/* Options — placed before Column Visibility in DOM so stacked layout keeps it below Quick Preset */}
              {/* Options */}
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, flexShrink: 0 }}>
                    {pick("옵션", "Options")}
                  </div>
                  <label style={{ display: "flex", flex: 1, minWidth: 0, alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, cursor: "pointer", background: draftShowZeroSales ? "rgba(59,130,246,.06)" : "transparent", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={draftShowZeroSales} onChange={() => setColumnSettingsDraft((current) => current ? { ...current, showZeroSales: !current.showZeroSales } : current)} style={{ width: 14, height: 14, flexShrink: 0, cursor: "pointer", accentColor: "#3B82F6" }} />
                    <span style={{ minWidth: 0, fontSize: 12, fontWeight: 500, color: draftShowZeroSales ? "#1E3A5F" : "#94A3B8" }}>{pick("판매 0인 SKU 표시", "Show Zero-Sales SKUs")}</span>
                  </label>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <div ref={skuFiltersRef} style={{ marginTop: 8, padding: "8px 6px 2px", borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <button
                        type="button"
                        aria-expanded={isSkuFiltersOpen}
                        onClick={() => {
                          setIsSkuFiltersOpen((open) => !open);
                          setOpenSkuFilterKey(null);
                        }}
                        style={{ ...SETTINGS_SECTION_TITLE_STYLE, flex: 1, padding: 0, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                      >
                        {pick("SKU 필터", "SKU Filters")}
                      </button>
                      <button
                        type="button"
                        disabled={!draftHasSkuPartFilters}
                        onClick={() => {
                          setColumnSettingsDraft((current) => current ? { ...current, skuPartFilters: cloneSkuPartFilters(EMPTY_SKU_PART_FILTERS) } : current);
                        }}
                        style={{
                          fontSize: 10,
                          padding: "2px 7px",
                          borderRadius: 4,
                          border: "1px solid #CBD5E1",
                          cursor: draftHasSkuPartFilters ? "pointer" : "default",
                          background: "#F8FAFC",
                          color: draftHasSkuPartFilters ? "#475569" : "#A8B0BA",
                        }}
                      >
                        {pick("초기화", "Reset")}
                      </button>
                      <button
                        type="button"
                        aria-label={isSkuFiltersOpen ? "Collapse SKU filters" : "Expand SKU filters"}
                        aria-expanded={isSkuFiltersOpen}
                        onClick={() => {
                          setIsSkuFiltersOpen((open) => !open);
                          setOpenSkuFilterKey(null);
                        }}
                        style={{ width: 18, height: 18, flexShrink: 0, padding: 0, border: "none", background: "transparent", color: "#64748B", cursor: "pointer", fontSize: 10, lineHeight: "18px" }}
                      >
                        {isSkuFiltersOpen ? "▼" : "▶"}
                      </button>
                    </div>
                    {isSkuFiltersOpen ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {activeSkuFilterKeys.map((key) => {
                        const selectedValues = draftActiveSkuPartFilters[key];
                        const optionValues = skuFilterOptions[key] ?? [];
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>{skuFilterLabel(key, primaryBaseCategory)}</span>
                            <details open={openSkuFilterKey === key} style={{ position: "relative" }}>
                              <summary
                                title={selectedValues.length ? selectedValues.join(", ") : "All"}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setOpenSkuFilterKey((current) => current === key ? null : key);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 6,
                                  width: "100%",
                                  minHeight: 28,
                                  boxSizing: "border-box",
                                  padding: "4px 7px",
                                  borderRadius: 5,
                                  border: "1px solid #CBD5E1",
                                  background: selectedValues.length ? "#EFF6FF" : "#F8FAFC",
                                  color: selectedValues.length ? "#1D4ED8" : "#1E293B",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  listStyle: "none",
                                  overflow: "hidden",
                                }}
                              >
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {skuFilterSummary(selectedValues)}
                                </span>
                                <span style={{ flexShrink: 0, color: "#64748B", fontSize: 10 }}>▼</span>
                              </summary>
                              <div
                                style={{
                                  position: "absolute",
                                  top: "calc(100% + 4px)",
                                  left: 0,
                                  right: 0,
                                  zIndex: 4,
                                  maxHeight: 180,
                                  overflow: "auto",
                                  borderRadius: 5,
                                  border: "1px solid #CBD5E1",
                                  background: "#fff",
                                  boxShadow: "0 8px 20px rgba(15, 23, 42, .16)",
                                  padding: 5,
                                }}
                              >
                                <button
                                  type="button"
                                  disabled={!selectedValues.length}
                                  onClick={() => setColumnSettingsDraft((current) => current ? { ...current, skuPartFilters: { ...current.skuPartFilters, [key]: [] } } : current)}
                                  style={{
                                    width: "100%",
                                    marginBottom: 4,
                                    padding: "4px 6px",
                                    borderRadius: 4,
                                    border: "1px solid #E2E8F0",
                                    background: "#F8FAFC",
                                    color: selectedValues.length ? "#475569" : "#A8B0BA",
                                    cursor: selectedValues.length ? "pointer" : "default",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textAlign: "left",
                                  }}
                                >
                                  All
                                </button>
                                {optionValues.map((value) => {
                                  const checked = selectedValues.includes(value);
                                  return (
                                    <label
                                      key={value}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        padding: "3px 5px",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                        background: checked ? "rgba(59,130,246,.08)" : "transparent",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => handleDraftSkuPartFilterToggle(key, value)}
                                        style={{ width: 13, height: 13, cursor: "pointer", accentColor: "#3B82F6" }}
                                      />
                                      <span style={{ fontSize: 12, color: checked ? "#1D4ED8" : "#334155", fontWeight: checked ? 700 : 500 }}>
                                        {value}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </details>
                          </div>
                        );
                      })}
                    </div>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 6px 2px", borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, marginBottom: 6 }}>
                      {pick("컬럼 고정", "Freeze Column")}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select
                        value={draftFreezeUntil}
                        onChange={(e) => setColumnSettingsDraft((current) => current ? { ...current, freezeUntil: e.target.value } : current)}
                        style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", color: "#1E293B", cursor: "pointer" }}
                      >
                        {draftVisColsForFreeze.map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.label.replace("\n", " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          setColumnSettingsDraft((current) => current ? { ...current, freezeUntil: DEFAULT_FREEZE } : current);
                        }}
                        style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F1F5F9", color: "#64748B", whiteSpace: "nowrap" }}
                      >
                        {pick("초기화", "Reset")}
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, padding: "8px 6px", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
                    <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, marginBottom: 6 }}>
                      {pick("컬럼 레이아웃", "Column Layout")}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmReset("컬럼 너비", "all column widths")) resetColumnWidths();
                        }}
                        style={{ fontSize: 11, padding: "6px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569", textAlign: "center" }}
                      >
                        {pick("컬럼 너비 초기화", "Reset Column Widths")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmReset("컬럼 순서", "the column order")) resetColumnOrder();
                        }}
                        style={{ fontSize: 11, padding: "6px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569", textAlign: "center" }}
                      >
                        {pick("컬럼 순서 초기화", "Reset Column Order")}
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, padding: "0 6px 2px" }}>
                  <button
                    type="button"
                    aria-expanded={isColorSettingsOpen}
                    onClick={() => setIsColorSettingsOpen((open) => !open)}
                    style={{
                      ...SETTINGS_SECTION_TITLE_STYLE,
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "2px 0 7px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span>{pick("색상 및 서식", "Colors & Formatting")}</span>
                    <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>
                      {isColorSettingsOpen ? "▼" : "▶"}
                    </span>
                  </button>
                  {isColorSettingsOpen ? (
                    <>
                  <div style={{ paddingTop: 2, display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", whiteSpace: "nowrap" }}>{pick("헤더 색상", "Header Color")}</span>
                    <button
                      type="button"
                      disabled={!selectedColorColumns.length}
                      onClick={() => {
                        if (confirmReset("선택한 컬럼 색상", "the selected column colors")) resetSelectedColumnColor();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: selectedColorColumns.length ? "pointer" : "default", background: "#F1F5F9", color: "#64748B", opacity: selectedColorColumns.length ? 1 : 0.5 }}
                    >
                      {pick("선택 초기화", "Reset Selected")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmReset("모든 컬럼 색상", "all column colors")) resetColumnColors();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569" }}
                    >
                      {pick("전체 초기화", "Reset All")}
                    </button>

                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", whiteSpace: "nowrap" }}>{pick("셀 색상", "Cell Color")}</span>
                    <button
                      type="button"
                      disabled={!selectedAgCell}
                      onClick={() => {
                        if (confirmReset("선택한 셀 색상", "the selected cell colors")) resetSelectedCellColor();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: selectedAgCell ? "pointer" : "default", background: "#F1F5F9", color: selectedAgCell ? "#64748B" : "#A8B0BA" }}
                    >
                      {pick("선택 초기화", "Reset Selected")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmReset("모든 셀 색상", "all cell colors")) resetCellColors();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569" }}
                    >
                      {pick("모든 셀 초기화", "Reset All Cells")}
                    </button>

                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", whiteSpace: "nowrap" }}>{pick("텍스트 색상", "Text Color")}</span>
                    <button
                      type="button"
                      disabled={!selectedAgCell}
                      onClick={() => {
                        if (confirmReset("선택한 셀의 텍스트 색상", "the selected cell text colors")) resetSelectedCellTextColor();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: selectedAgCell ? "pointer" : "default", background: "#F1F5F9", color: selectedAgCell ? "#64748B" : "#A8B0BA" }}
                    >
                      {pick("선택 초기화", "Reset Selected")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmReset("모든 텍스트 색상", "all text colors")) resetAllTextColors();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569" }}
                    >
                      {pick("전체 초기화", "Reset All")}
                    </button>
                  </div>

                  {/* Text Formatting */}
                  <div style={{ marginTop: 10 }}>
                    <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, fontSize: 10, marginBottom: 6 }}>
                      {pick("텍스트 서식", "Text Formatting")}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmReset("모든 텍스트 서식", "all text formatting")) resetAllTextFormatting();
                      }}
                      style={{ width: "100%", fontSize: 11, fontWeight: 600, padding: "5px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#334155" }}
                    >
                      {pick("모든 텍스트 서식 초기화", "Reset All Text Formatting")}
                    </button>
                  </div>
                    </>
                  ) : null}
                  </div>
                  <div style={{ marginTop: 12, padding: "10px 6px 2px", borderTop: "1px solid #E2E8F0" }}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          style={{ width: "100%", fontSize: 12, fontWeight: 700, padding: "8px 10px", borderRadius: 5, border: "1px solid #FCA5A5", cursor: "pointer", background: "#FEF2F2", color: "#B91C1C" }}
                        >
                          {pick("모든 컬럼 설정 초기화", "Reset All Column Settings")}
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {pick("모든 컬럼 설정을 초기화할까요?", "Reset all column settings?")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {pick("컬럼 너비, 순서, 색상, 셀 색상 및", "Column widths, order, colors, cell colors,")}
                            <br />
                            {pick("텍스트 서식이 기본값으로 돌아갑니다.", "and text formatting will return to their defaults.")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{pick("취소", "Cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                              resetAllColumnSettings();
                              setIsColumnSettingsOpen(false);
                              setColumnSettingsDraft(null);
                              setOpenSkuFilterKey(null);
                            }}
                          >
                            {pick("초기화", "Reset")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
               </div>
              </div>
              </div>

              {/* Columns */}
              <div style={{ gridColumn: 2, gridRow: "2 / 4", padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0", maxHeight: "min(700px, calc(100vh - 200px))", overflowY: "auto" }}>
                <div style={{ ...SETTINGS_SECTION_TITLE_STYLE, marginBottom: 6 }}>
                  {pick("컬럼 표시", "Column Visibility")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 4 }}>
                  {orderedColumnVisibilityGroupKeys.map((group) => {
                    const groupItems = orderedColumnVisibilityItems.filter((item) => item.group === group);
                    const groupLabel = columnHeaderNames[`group:${group}`]
                      ?? GROUP_LABELS[group]
                      ?? GROUP_BTN_LABELS[group]
                      ?? group;
                    const checkedCount = groupItems.filter((item) => draftColumnVis[item.id] !== false).length;
                    const allChecked = checkedCount === groupItems.length;
                    const someChecked = checkedCount > 0 && checkedCount < groupItems.length;
                    const isOpen = openColumnVisibilityGroups[group];
                    return (
                      <div key={group} style={{ borderRadius: 5, background: checkedCount ? "rgba(59,130,246,.04)" : "transparent" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "4px 5px" }}>
                          <button
                            type="button"
                            aria-label={isOpen ? "Collapse group" : "Expand group"}
                            onClick={() => handleToggleColumnVisibilityGroupOpen(group)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", cursor: "pointer", color: "#64748B", fontSize: 10, padding: 0, lineHeight: "18px" }}
                          >
                            {isOpen ? "▼" : "▶"}
                          </button>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(node) => {
                              if (node) node.indeterminate = someChecked;
                            }}
                            onChange={() => handleDraftToggleColumnGroup(group)}
                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleColumnVisibilityGroupOpen(group)}
                            title={groupLabel}
                            style={{ minWidth: 0, flex: 1, border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, color: checkedCount ? "#1E3A5F" : "#94A3B8" }}
                          >
                            {groupLabel}
                            <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: "#64748B" }}>
                              {checkedCount}/{groupItems.length}
                            </span>
                          </button>
                        </div>
                        {isOpen ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, padding: "0 0 4px 28px" }}>
                            {groupItems.map((item) => {
                              const checked = draftColumnVis[item.id] !== false;
                              return (
                                <label
                                  key={item.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    minWidth: 0,
                                    padding: "3px 5px",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    background: checked ? "rgba(59,130,246,.06)" : "transparent",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleDraftToggleColumn(item.id)}
                                    style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                                  />
                                  <span
                                    title={`${groupLabel} / ${labelWithSalesWindowWeight(item.id, item.label, salesWindowWeights)}`}
                                    style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, color: checked ? "#1E3A5F" : "#94A3B8" }}
                                  >
                                    {labelWithSalesWindowWeight(item.id, item.label, salesWindowWeights)}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Column Colors + Selected Cell Color / Container Visibility */}
             {gridMode === "ag-grid" ? (
               <div style={{ display: "contents" }}>

                 {/* Container Visibility */}
                  {(() => {
                    const containerOrderIndex = new Map<string, number>();
                    columnOrder.forEach((columnId, index) => {
                      const separator = columnId.lastIndexOf("::");
                      if (separator <= 0) return;
                      const containerName = columnId.slice(0, separator);
                      if (!containerOrderIndex.has(containerName)) containerOrderIndex.set(containerName, index);
                    });
                    const allContainers = data.containers
                      .filter((c) => c.status !== "baseline" && containerMatchesCategory(c, categoryFilter))
                      .map((container, fallbackIndex) => ({ container, fallbackIndex }))
                      .sort((a, b) => {
                        const rankA = containerOrderIndex.get(a.container.name) ?? columnOrder.length + a.fallbackIndex;
                        const rankB = containerOrderIndex.get(b.container.name) ?? columnOrder.length + b.fallbackIndex;
                        return rankA - rankB || a.fallbackIndex - b.fallbackIndex;
                      })
                      .map(({ container }) => container);
                    if (!allContainers.length) return null;

                    const STATUS_GROUPS: { status: string; label: string; color: string; accentColor: string }[] = [
                      { status: "shipped",          label: pick("선적", "Shipped"), color: "#3B82F6", accentColor: "#3B82F6" },
                      { status: "packing_received", label: pick("최종", "Final"), color: "#F59E0B", accentColor: "#F59E0B" },
                      { status: "draft",            label: pick("초안", "Draft"),   color: "#EF4444", accentColor: "#EF4444" },
                    ];
                    const statusMetadata = new Map(STATUS_GROUPS.map((group) => [group.status, group]));
                    const orderedContainerStatusRuns = allContainers.reduce<Array<{
                      key: string;
                      status: string;
                      containers: typeof allContainers;
                    }>>((runs, container) => {
                      const status = container.status;
                      if (!status || !statusMetadata.has(status)) return runs;
                      const previousRun = runs.at(-1);
                      if (previousRun && previousRun.status === status) {
                        previousRun.containers.push(container);
                      } else {
                        runs.push({
                          key: `${status}:${runs.length}`,
                          status,
                          containers: [container],
                        });
                      }
                      return runs;
                    }, []);

                    return (
                      <div style={{ gridColumn: 3, gridRow: "2 / 5", padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0", maxHeight: "min(700px, calc(100vh - 200px))", overflowY: "auto" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={SETTINGS_SECTION_TITLE_STYLE}>
                            {pick("컨테이너 표시", "Container Visibility")}
                          </div>
                          {(draftHiddenContainers.size > 0 || draftHiddenContainerColumns.size > 0) && (
                            <button
                              type="button"
                              title={pick("숨긴 컨테이너와 컨테이너 컬럼 모두 표시", "Show all hidden containers and container columns")}
                              onClick={() => setColumnSettingsDraft((current) => current ? {
                                ...current,
                                hiddenContainers: new Set(),
                                hiddenContainerColumns: new Set(),
                              } : current)}
                              style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F1F5F9", color: "#64748B" }}
                            >
                              {pick("모두 표시", "Show All")}
                            </button>
                          )}
                        </div>
                        {/* Base container toggles */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
                          {[
                            { name: "Base",          label: pick("기준 (현재고)", "Base (on-hand)"), color: "#94A3B8" },
                          ].map(({ name, label, color }) => {
                            const visible = !draftHiddenBases.has(name);
                            return (
                              <label key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 5px", borderRadius: 4, cursor: "pointer", background: visible ? "rgba(59,130,246,.06)" : "transparent" }}>
                                <input
                                  type="checkbox"
                                  checked={visible}
                                  onChange={() => setColumnSettingsDraft((current) => {
                                    if (!current) return current;
                                    const next = new Set(current.hiddenBases);
                                    if (next.has(name)) next.delete(name); else next.add(name);
                                    return { ...current, hiddenBases: next };
                                  })}
                                  style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                                />
                                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: visible ? "#1E3A5F" : "#94A3B8" }}>{label}</span>
                                <span style={{ fontSize: 10, fontWeight: 600, color, whiteSpace: "nowrap" }}>Base</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ borderTop: "1px solid #E2E8F0", marginBottom: 8 }} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 }}>
                          {orderedContainerStatusRuns.map(({ key, status, containers: group }) => {
                            const { label, color, accentColor } = statusMetadata.get(status)!;
                            const allVisible  = group.every((c) => !draftHiddenContainers.has(c.name));
                            const someVisible = group.some((c)  => !draftHiddenContainers.has(c.name));
                            const isOpen = openContainerStatusGroups[status] !== false;
                            const toggleGroup = () => setColumnSettingsDraft((current) => {
                              if (!current) return current;
                              const next = new Set(current.hiddenContainers);
                              if (allVisible) group.forEach((c) => next.add(c.name));
                              else            group.forEach((c) => next.delete(c.name));
                              return { ...current, hiddenContainers: next };
                            });
                            return (
                              <div key={key}>
                                {/* Group header */}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 5px", borderRadius: 4, marginBottom: 2 }}>
                                  <button
                                    type="button"
                                    aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
                                    aria-expanded={isOpen}
                                    onClick={() => setOpenContainerStatusGroups((previous) => ({
                                      ...previous,
                                      [status]: !isOpen,
                                    }))}
                                    style={{ width: 18, height: 18, border: "none", background: "transparent", cursor: "pointer", color: "#64748B", fontSize: 10, padding: 0, lineHeight: "18px", flexShrink: 0 }}
                                  >
                                    {isOpen ? "▼" : "▶"}
                                  </button>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", minWidth: 0 }}>
                                    <input
                                      type="checkbox"
                                      checked={allVisible}
                                      ref={(el) => { if (el) el.indeterminate = !allVisible && someVisible; }}
                                      onChange={toggleGroup}
                                      style={{ width: 14, height: 14, cursor: "pointer", accentColor }}
                                    />
                                    <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                      {label} ({group.length})
                                    </span>
                                  </label>
                                </div>
                                {/* Individual containers */}
                                {isOpen ? group.map((c) => {
                                  const visible = !draftHiddenContainers.has(c.name);
                                  return (
                                    <label
                                      key={c.name}
                                      style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        padding: "3px 5px 3px 29px", borderRadius: 4, cursor: "pointer",
                                        background: visible ? "rgba(59,130,246,.06)" : "transparent",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={visible}
                                        onChange={() => setColumnSettingsDraft((current) => {
                                          if (!current) return current;
                                          const next = new Set(current.hiddenContainers);
                                          if (next.has(c.name)) next.delete(c.name); else next.add(c.name);
                                          return { ...current, hiddenContainers: next };
                                        })}
                                        style={{ width: 13, height: 13, cursor: "pointer", accentColor: "#3B82F6" }}
                                      />
                                      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: visible ? "#1E3A5F" : "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {columnHeaderNames[`container:${c.name}`] ?? c.name}
                                      </span>
                                      {c.eta && (
                                        <span style={{ fontSize: 10, fontWeight: 400, color: "#94A3B8", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
                                          {c.eta.slice(5)}
                                        </span>
                                      )}
                                    </label>
                                  );
                                }) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              ) : null}
              <div style={{ gridColumn: "1 / -1", position: "sticky", bottom: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderTop: "1px solid #CBD5E1", background: "rgba(255,255,255,.98)", boxShadow: "0 -4px 12px rgba(15,23,42,.06)" }}>
                <span style={{ fontSize: 11, color: columnSettingsChangeCount > 0 ? "#1D4ED8" : "#64748B", fontWeight: columnSettingsChangeCount > 0 ? 700 : 500 }}>
                  {columnSettingsChangeCount > 0
                    ? pick(`${columnSettingsChangeCount}개 변경사항이 선택되었습니다. Apply를 눌러 적용하세요.`, `${columnSettingsChangeCount} change${columnSettingsChangeCount === 1 ? "" : "s"} selected. Click Apply to confirm.`)
                    : pick("변경사항이 없습니다.", "No pending changes.")}
                </span>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleColumnSettingsOpenChange(false)}
                    style={{ minWidth: 78, padding: "6px 14px", borderRadius: 5, border: "1px solid #CBD5E1", background: "#fff", color: "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                  >
                    {pick("취소", "Cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={columnSettingsChangeCount === 0}
                    onClick={applyColumnSettingsDraft}
                    style={{ minWidth: 86, padding: "6px 14px", borderRadius: 5, border: "1px solid", borderColor: columnSettingsChangeCount > 0 ? "#1D4ED8" : "#CBD5E1", background: columnSettingsChangeCount > 0 ? "#2563EB" : "#F1F5F9", color: columnSettingsChangeCount > 0 ? "#fff" : "#94A3B8", cursor: columnSettingsChangeCount > 0 ? "pointer" : "default", fontSize: 12, fontWeight: 700 }}
                  >
                    {pick("적용", "Apply")}
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <TextFormatPopover
            enabled={fillPaletteEnabled}
            format={currentTextFormat}
            targetLabel={fillPaletteTargetLabel}
            onChange={handleTextFormatApply}
            onReset={handleTextFormatReset}
            fontSizeDisabled={isContainerHeaderTextTarget}
          />
          <FillColorPopover
            enabled={fillPaletteEnabled}
            currentColor={fillPaletteColor}
            targetLabel={fillPaletteTargetLabel}
            onApply={handleFillColorApply}
            onReset={handleFillColorReset}
          />
          </>
        )}

        <StatusBar
          rows={filteredRows}
          inline
          settingsAnchorRef={columnSettingsButtonRef}
          seasonalFactors={seasonalFactors}
          onSeasonalFactorsChange={handleSeasonalFactorsChange}
          salesWindowWeights={salesWindowWeights}
          onSalesWindowWeightsChange={handleSalesWindowWeightsChange}
          oosLostDemandWeights={oosLostDemandWeights}
          onOosLostDemandWeightsChange={handleOosLostDemandWeightsChange}
          onApplyAndSync={reload}
          gradient={gradient}
          gradientSC={gradientSC}
          onGradientChange={handleGradientChange}
          onGradientSCChange={handleGradientSCChange}
        />

        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {loadError && (
            <span style={{ color: "#C42020", fontSize: 11 }}>Error: {loadError}</span>
          )}
          <span suppressHydrationWarning style={{ color: "#7A766F", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 11 }}>
            {data.last_sync ? `Synced ${data.last_sync.slice(0, 16).replace("T", " ")}` : "—"}
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
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
                onClick={() => {
                  if (confirmReset("기준 날짜", "the date to today")) setAsOfDate(todayStr);
                }}
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
            onClick={handleExport}
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
            {gridMode === "ag-grid" ? "Excel" : "CSV"}
          </button>
          <div style={{ display: "flex", borderRadius: 4, border: "1px solid #C2BFB5", overflow: "hidden" }}>
            {(["custom", "link"] as VelocityMode[]).map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setVelocityMode(m)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "5px 10px",
                  border: "none",
                  borderRight: i === 0 ? "1px solid #C2BFB5" : undefined,
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
            onClick={() => reload()}
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
              onClick={() => reload()}
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
        {permissionsReady && !canEditDemandPlanning ? (
          <div className="flex shrink-0 items-center justify-center border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
            {pick(
              "읽기 전용: 수요 계획 수정 권한이 없어 CBM, ETA, 컨테이너 수량, 메모 및 자동 발주 저장이 비활성화되었습니다.",
              "Read only: Demand Planning edit permission is required to update CBM, ETA, container quantities, notes, or automatic orders.",
            )}
          </div>
        ) : null}
        {gridMode === "ag-grid" ? <AgDemandPlanningGrid
          data={data}
          loading={loading}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          skuPartFilters={activeSkuPartFilters}
          onFilteredRowsChange={setFilteredRows}
          onLoadContainerDetails={loadContainerDetails}
          containerDetailsLoading={containerDetailsLoading}
          containerDetailsLoaded={containerDetailsLoaded}
          groupVis={groupVis}
          columnVis={columnVis}
          compactMode={compactMode}
          showMistake={showMistake}
          showZeroSales={showZeroSales}
          freezeUntil={freezeUntil}
          columnWidths={columnWidths}
          columnWidthsRef={columnWidthsRef}
          onColumnWidthsChange={handleColumnWidthsChange}
          columnOrder={columnOrder}
          onColumnOrderChange={handleColumnOrderChange}
          seasonalFactors={seasonalFactors}
          gradient={gradient}
          gradientSC={gradientSC}
          columnColors={columnColors}
          cellColors={cellColors}
          columnTextFormats={columnTextFormats}
          cellTextFormats={cellTextFormats}
          skuCellNotes={skuCellNotes}
          onSkuCellNoteChange={canEditSkuNotes ? handleSkuCellNoteChange : undefined}
          skuWorkNotes={skuWorkNotes}
          skuWorkNotes2={skuWorkNotes2}
          skuWorkNotes3={skuWorkNotes3}
          onSkuWorkNoteChange={canEditSkuNotes ? handleSkuWorkNoteChange : undefined}
          canEditSkuNotes={canEditSkuNotes}
          canEditPlanning={canEditDemandPlanning}
          selectedCellKeys={selectedCellKeys}
          selectedColumnIds={selectedColorColumns}
          onColumnHeaderSelect={handleGridColumnSelect}
          selectedFullColumnIds={selectedFullColumnIds}
          onFullColumnSelect={handleFullColumnSelect}
          columnHeaderNames={columnHeaderNames}
          onColumnHeaderRename={handleGridColumnRename}
          onAgCellSelected={(selection) => {
            setActiveColorTarget("cells");
            setSelectedColorColumns([]);
            setSelectedFullColumnIds([]);
            setSelectedAgCell({ rowId: selection.rowId, columnId: selection.columnId, label: selection.label });
          }}
          onCellSelectionChange={(keys) => {
            setActiveColorTarget("cells");
            const cells = keys.map((key) => {
              const sep = key.indexOf("::");
              const rowId = key.substring(0, sep);
              const columnId = key.substring(sep + 2);
              return { rowId, columnId, label: `${rowId} / ${columnId}` };
            });
            setSelectedAgCells(cells);
          }}
          onExportReady={handleAgGridExportReady}
          hiddenContainers={hiddenContainers}
          hiddenBases={hiddenBases}
          hiddenContainerColumns={hiddenContainerColumns}
          salesWindowWeights={salesWindowWeights}
          onHideColumn={handleToggleColumn}
          onHideColumns={handleHideColumns}
          onHideContainer={handleHideContainer}
          onToggleContainerColumns={handleToggleContainerColumns}
        /> : <DemandPlanningGrid
          data={data}
          loading={loading}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          skuPartFilters={activeSkuPartFilters}
          onFilteredRowsChange={setFilteredRows}
          onLoadContainerDetails={loadContainerDetails}
          containerDetailsLoading={containerDetailsLoading}
          containerDetailsLoaded={containerDetailsLoaded}
          groupVis={groupVis}
          columnVis={columnVis}
          compactMode={compactMode}
          showMistake={showMistake}
          showZeroSales={showZeroSales}
          freezeUntil={freezeUntil}
          columnWidths={columnWidths}
          columnWidthsRef={columnWidthsRef}
          onColumnWidthsChange={handleColumnWidthsChange}
          seasonalFactors={seasonalFactors}
          columnColors={columnColors}
          cellColors={cellColors}
          columnTextFormats={columnTextFormats}
          cellTextFormats={cellTextFormats}
          skuCellNotes={skuCellNotes}
          onSkuCellNoteChange={canEditSkuNotes ? handleSkuCellNoteChange : undefined}
          canEditSkuNotes={canEditSkuNotes}
          selectedCellKeys={selectedCellKeys}
        />}
      </div>
    </div>
  );
}
