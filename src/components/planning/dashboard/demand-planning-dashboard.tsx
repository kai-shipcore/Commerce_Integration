"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { DemandPlanningGrid } from "./demand-planning-grid";
import { StatusBar } from "./status-bar";
import {
  ALL_COLS,
  ALL_GROUP_KEYS,
  COMPACT_COLUMN_IDS,
  CON_SUBCOLS,
  CELL_COLORS_STORAGE_KEY,
  COLUMN_COLORS_STORAGE_KEY,
  GROUP_BTN_LABELS,
  GROUP_LABELS,
  DEFAULT_FREEZE,
  COLUMN_WIDTHS_STORAGE_KEY,
  TODAY,
  EMPTY_SKU_PART_FILTERS,
  loadSavedColumnColors,
  loadSavedCellColors,
  loadSavedColumnWidths,
  skuPartsForRow,
} from "./columns";
import type { CellColorSettings, ColumnColorSettings, ColumnVisibility, ColumnWidths, SkuPartFilterKey, SkuPartFilters } from "./columns";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import type { CategoryFilter, ColumnGroupKey, ContainerMeta, DemandRow, ProductFilter, UrgencyFilter } from "@/types/demand-planning";
import { apiPath } from "@/lib/api-path";

const AgDemandPlanningGrid = dynamic(
  () => import("./ag-demand-planning-grid").then((module) => module.AgDemandPlanningGrid),
  { ssr: false },
);

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
  columnVis: ColumnVisibility;
  compactMode: boolean;
  showMistake: boolean;
  showZeroSales: boolean;
  freezeUntil: string;
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

const COLUMN_VISIBILITY_ITEMS: ColumnVisibilityItem[] = [
  ...ALL_COLS.map((column) => ({
    id: column.id,
    label: column.label.replace("\n", " "),
    group: column.grp,
    compact: COMPACT_COLUMN_IDS.has(column.id),
    kind: "base" as const,
  })),
  ...CON_SUBCOLS.map((column) => ({
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
  seat: "Seat",
  no: "No.",
  color: "Color",
  tone: "Tone",
};

function sortSkuFilterValues(values: Iterable<string>) {
  return Array.from(values)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function skuFilterSummary(values: string[]) {
  if (!values.length) return "All";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" | "AC" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "SC";
  return "AC";
}

function containerMatchesCategory(container: ContainerMeta, categoryFilter: CategoryFilter) {
  if (container.status === "baseline") return true;
  if (!container.categories?.length) {
    if (container.name.endsWith("-FLOOR")) return categoryFilter === "fm";
    if (container.name.endsWith("-SEAT")) return categoryFilter === "sc";
    return categoryFilter === "cc";
  }
  return container.categories.includes(categoryFilter.toUpperCase());
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
  const router = useRouter();
  const [velocityMode, setVelocityMode] = useState<VelocityMode>("link");
  const [todayStr, setTodayStr] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const isHistoricalDate = Boolean(todayStr && asOfDate && asOfDate !== todayStr);
  const searchParams = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(() => {
    const productParam = searchParams.get("product");
    return productParam === "fm" || productParam === "cc" || productParam === "sc" || productParam === "ac"
      ? productParam
      : "fm";
  });
  const {
    data,
    loading,
    containerDetailsLoading,
    containerDetailsLoaded,
    error: loadError,
    reload,
    loadContainerDetails,
  } = useDemandPlanningData(velocityMode, isHistoricalDate ? asOfDate : undefined, false, categoryFilter);
  const [isCategoryPending, startCategoryTransition] = useTransition();
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter | null>(null);
  const [search, setSearch] = useState("");
  const [skuPartFilters, setSkuPartFilters] = useState<SkuPartFilters>(EMPTY_SKU_PART_FILTERS);
  const [openSkuFilterKey, setOpenSkuFilterKey] = useState<SkuPartFilterKey | null>(null);
  const [filteredRows, setFilteredRows] = useState<DemandRow[]>([]);
  const [selectedColorColumn, setSelectedColorColumn] = useState(BASE_COLORABLE_COLUMNS[0]?.id ?? "");

  useEffect(() => {
    const today = planningLocalDateString();
    // Hydration-safe: browser-local date is only available after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayStr(today);
    setAsOfDate((current) => current || today);

    const productParam = searchParams.get("product");
    if (productParam === "fm" || productParam === "cc" || productParam === "sc" || productParam === "ac") {
      setCategoryFilter(productParam);
    }
    const statusParam = searchParams.get("status");
    if (statusParam === "crit" || statusParam === "warn" || statusParam === "bo") {
      setUrgencyFilter(statusParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProductFilter = useCallback((filter: ProductFilter) => {
    setProductFilter(filter);
    setUrgencyFilter(null);
  }, []);

  const handleCategoryFilter = useCallback((filter: CategoryFilter) => {
    if (filter === categoryFilter) return;
    if (categoryChangeTimerRef.current) window.clearTimeout(categoryChangeTimerRef.current);

    setSelectedColorColumn((current) => current.startsWith("container:") ? (BASE_COLORABLE_COLUMNS[0]?.id ?? "") : current);
    setIsCategoryLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("product", filter);
    router.replace(`?${params.toString()}`, { scroll: false });
    categoryChangeTimerRef.current = window.setTimeout(() => {
      startCategoryTransition(() => {
        setCategoryFilter(filter);
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

  // ── Column visibility state (lifted from grid) ──────────────────────────────
  const [groupVis, setGroupVis] = useState<Record<ColumnGroupKey, boolean>>(DEFAULT_GROUP_VIS);
  const [columnVis, setColumnVis] = useState<ColumnVisibility>(() => getColumnVisibilityForPreset("all"));
  const [compactMode, setCompactMode] = useState(false);
  const [showMistake, setShowMistake] = useState(true);
  const [showZeroSales, setShowZeroSales] = useState(false);
  const [freezeUntil, setFreezeUntil] = useState(DEFAULT_FREEZE);
  const [columnSettingsLoaded, setColumnSettingsLoaded] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});
  const [openColumnVisibilityGroups, setOpenColumnVisibilityGroups] = useState<Record<ColumnGroupKey, boolean>>(DEFAULT_COLUMN_VISIBILITY_GROUPS_OPEN);
  const [columnColors, setColumnColors] = useState<ColumnColorSettings>({});
  const [cellColors, setCellColors] = useState<CellColorSettings>({});
  const [selectedAgCell, setSelectedAgCell] = useState<{ rowId: string; columnId: string; label: string } | null>(null);
  const [selectedAgCells, setSelectedAgCells] = useState<{ rowId: string; columnId: string; label: string }[]>([]);
  const [seasonalFactors, setSeasonalFactors] = useState<SeasonalFactors>(DEFAULT_SEASONAL_FACTORS);
  const [gradient, setGradient] = useState<GradientTier[]>(DEFAULT_GRADIENT);
  const [gradientSC, setGradientSC] = useState<GradientTier[]>(DEFAULT_GRADIENT_SC);
  const [dbPrefsLoaded, setDbPrefsLoaded] = useState(false);
  const columnWidthsRef = useRef<ColumnWidths>({});
  const prefSaveTimerRef = useRef<number | null>(null);
  const skuFiltersRef = useRef<HTMLDivElement>(null);
  const categoryChangeTimerRef = useRef<number | null>(null);
  const agGridExportRef = useRef<(() => Promise<void>) | null>(null);

  // Debounced save of all preferences to DB (1.5s delay to batch rapid changes)
  const savePrefsToDb = useCallback((prefs: Record<string, unknown>) => {
    if (prefSaveTimerRef.current !== null) window.clearTimeout(prefSaveTimerRef.current);
    prefSaveTimerRef.current = window.setTimeout(() => {
      prefSaveTimerRef.current = null;
      fetch(apiPath("/api/user/preferences"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      }).catch(() => {});
    }, 1500);
  }, []);

  useEffect(() => {
    const saved = loadSavedColumnWidths();
    columnWidthsRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setColumnWidths(saved);
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
    setSeasonalFactors(loadSavedSeasonalFactors());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stored browser preference is available only after hydration.
    setGradient(loadSavedGradient());
    setGradientSC(loadSavedGradientSC());
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

        // Column colors
        const cc = d[COLUMN_COLORS_STORAGE_KEY];
        if (cc && typeof cc === "object" && !Array.isArray(cc)) {
          window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(cc));
          setColumnColors(cc as ColumnColorSettings);
        }

        // Cell colors
        const cellC = d[CELL_COLORS_STORAGE_KEY];
        if (cellC && typeof cellC === "object" && !Array.isArray(cellC)) {
          window.localStorage.setItem(CELL_COLORS_STORAGE_KEY, JSON.stringify(cellC));
          setCellColors(cellC as CellColorSettings);
        }

        // Seasonal factors
        const sf = d[SEASONAL_FACTORS_STORAGE_KEY];
        if (sf && typeof sf === "object" && !Array.isArray(sf)) {
          window.localStorage.setItem(SEASONAL_FACTORS_STORAGE_KEY, JSON.stringify(sf));
          setSeasonalFactors(sf as SeasonalFactors);
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
      [COLUMN_COLORS_STORAGE_KEY]: columnColors,
      [CELL_COLORS_STORAGE_KEY]: cellColors,
      [SEASONAL_FACTORS_STORAGE_KEY]: seasonalFactors,
      [GRADIENT_STORAGE_KEY]: gradient,
      [GRADIENT_SC_STORAGE_KEY]: gradientSC,
    });
  }, [columnSettingsLoaded, dbPrefsLoaded, groupVis, columnVis, compactMode, showMistake, showZeroSales, freezeUntil, columnWidths, columnColors, cellColors, seasonalFactors, gradient, gradientSC, savePrefsToDb]);

  const handleColumnWidthsChange = useCallback((next: ColumnWidths) => {
    columnWidthsRef.current = next;
    setColumnWidths(next);
  }, []);

  const resetColumnWidths = useCallback(() => {
    columnWidthsRef.current = {};
    setColumnWidths({});
    window.localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
  }, []);

  const handleColumnColorChange = useCallback((columnId: string, target: "cell" | "header", color: string) => {
    setColumnColors((current) => {
      const nextEntry = { ...(current[columnId] ?? {}), [target]: color };
      const next = { ...current, [columnId]: nextEntry };
      window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSelectedColumnColor = useCallback(() => {
    setColumnColors((current) => {
      const next = { ...current };
      delete next[selectedColorColumn];
      if (Object.keys(next).length) {
        window.localStorage.setItem(COLUMN_COLORS_STORAGE_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(COLUMN_COLORS_STORAGE_KEY);
      }
      return next;
    });
  }, [selectedColorColumn]);

  const resetColumnColors = useCallback(() => {
    setColumnColors({});
    window.localStorage.removeItem(COLUMN_COLORS_STORAGE_KEY);
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

  const handleSeasonalFactorsChange = useCallback((next: SeasonalFactors) => {
    setSeasonalFactors(next);
    window.localStorage.setItem(SEASONAL_FACTORS_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleGradientChange = useCallback((next: GradientTier[]) => {
    setGradient(next);
    saveGradient(next);
  }, []);

  const handleGradientSCChange = useCallback((next: GradientTier[]) => {
    setGradientSC(next);
    saveGradientSC(next);
  }, []);

  const handleAllOn = useCallback(() => {
    const nextColumnVis = getColumnVisibilityForPreset("all");
    setCompactMode(false);
    setColumnVis(nextColumnVis);
    setGroupVis(getGroupVisibilityFromColumns(nextColumnVis));
  }, []);

  const handleCoreOnly = useCallback(() => {
    const nextColumnVis = getColumnVisibilityForPreset("core");
    setCompactMode(false);
    setColumnVis(nextColumnVis);
    setGroupVis(getGroupVisibilityFromColumns(nextColumnVis));
  }, []);

  const handleCompact = useCallback(() => {
    const nextColumnVis = getColumnVisibilityForPreset("compact");
    setCompactMode(true);
    setColumnVis(nextColumnVis);
    setGroupVis(getGroupVisibilityFromColumns(nextColumnVis));
    setFreezeUntil("sod");
  }, []);

  const handleToggleContainerColumns = useCallback(() => {
    setColumnVis((current) => {
      const containerItems = COLUMN_VISIBILITY_ITEMS.filter((item) => item.group === "con");
      const allContainerColumnsVisible = containerItems.every((item) => current[item.id] !== false);
      const next = { ...current };
      containerItems.forEach((item) => {
        next[item.id] = !allContainerColumnsVisible;
      });
      setGroupVis(getGroupVisibilityFromColumns(next));
      return next;
    });
  }, []);

  const handleToggleColumnVisibilityGroup = useCallback((group: ColumnGroupKey) => {
    setCompactMode(false);
    setColumnVis((current) => {
      const groupItems = COLUMN_VISIBILITY_ITEMS.filter((item) => item.group === group);
      const allGroupColumnsVisible = groupItems.every((item) => current[item.id] !== false);
      const next = { ...current };
      groupItems.forEach((item) => {
        next[item.id] = !allGroupColumnsVisible;
      });
      setGroupVis(getGroupVisibilityFromColumns(next));

      const nextVisCols = ALL_COLS.filter((column) => next[column.id] !== false);
      const stillVisible = nextVisCols.some((column) => column.id === freezeUntil);
      if (!stillVisible && nextVisCols.length > 0) {
        setFreezeUntil(nextVisCols[nextVisCols.length - 1].id);
      }
      return next;
    });
  }, [freezeUntil]);

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

  const hiddenColumnCount = COLUMN_VISIBILITY_ITEMS.filter((item) => columnVis[item.id] === false).length;
  const allPresetActive = columnVisibilityEquals(columnVis, getColumnVisibilityForPreset("all"));
  const corePresetActive = columnVisibilityEquals(columnVis, getColumnVisibilityForPreset("core"));
  const compactPresetActive = compactMode && columnVisibilityEquals(columnVis, getColumnVisibilityForPreset("compact"));
  const allContainerColumnsVisible = COLUMN_VISIBILITY_ITEMS
    .filter((item) => item.group === "con")
    .every((item) => columnVis[item.id] !== false);

  const visColsForFreeze = useMemo(
    () => ALL_COLS
      .filter((c) => columnVis[c.id] !== false),
    [columnVis],
  );

  const colorableColumns = useMemo(
    () => [
      ...BASE_COLORABLE_COLUMNS,
      ...data.containers
        .filter((container) => containerMatchesCategory(container, categoryFilter))
        .map((container) => ({
          id: `container:${container.name}`,
          label: `Container Header: ${container.name}`,
        })),
    ],
    [categoryFilter, data.containers],
  );
  const selectedColorColumnIsContainerHeader = selectedColorColumn.startsWith("container:");

  // ─────────────────────────────────────────────────────────────────────────────

  const skuFilterOptions = useMemo(() => {
    const options: Record<SkuPartFilterKey, Set<string>> = {
      seat: new Set(),
      no: new Set(),
      color: new Set(),
      tone: new Set(),
    };
    for (const row of data.rows) {
      if (categoryCodeForRow(row) !== categoryFilter.toUpperCase()) continue;
      const parts = skuPartsForRow(row);
      (Object.keys(options) as SkuPartFilterKey[]).forEach((key) => {
        if (parts[key]) options[key].add(parts[key]);
      });
    }
    return {
      seat: sortSkuFilterValues(options.seat),
      no: sortSkuFilterValues(options.no),
      color: sortSkuFilterValues(options.color),
      tone: sortSkuFilterValues(options.tone),
    };
  }, [categoryFilter, data.rows]);

  const hasSkuPartFilters = (Object.keys(skuPartFilters) as SkuPartFilterKey[]).some((key) => skuPartFilters[key].length > 0);

  const handleSkuPartFilterToggle = useCallback((key: SkuPartFilterKey, value: string) => {
    setSkuPartFilters((current) => {
      const selected = new Set(current[key]);
      if (selected.has(value)) {
        selected.delete(value);
      } else {
        selected.add(value);
      }
      return { ...current, [key]: sortSkuFilterValues(selected) };
    });
  }, []);

  const clearSkuPartFilter = useCallback((key: SkuPartFilterKey) => {
    setSkuPartFilters((current) => ({ ...current, [key]: [] }));
  }, []);

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
            <option value="ac">Accessories</option>
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
                ) : hiddenColumnCount > 0 ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#FFEDED", color: "#C42020" }}>
                    {hiddenColumnCount} hidden
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
                maxHeight: "min(760px, calc(100vh - 80px))",
                padding: 0,
                overflow: "auto",
                display: "grid",
                gridTemplateColumns: "minmax(280px, 0.95fr) minmax(360px, 1fr) minmax(200px, 0.65fr)",
                alignItems: "start",
              }}
            >
              {/* Header with close button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid #E2E8F0", gridColumn: "1 / -1", position: "sticky", top: 0, zIndex: 1, background: "#fff" }}>
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
              <div style={{ gridColumn: 1, gridRow: 2, padding: "8px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Quick Preset
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {([
                    { label: "All", action: handleAllOn, active: allPresetActive },
                    { label: "Core", action: handleCoreOnly, active: corePresetActive },
                    { label: "Compact", action: handleCompact, active: compactPresetActive },
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
                <button
                  type="button"
                  onClick={handleToggleContainerColumns}
                  style={{
                    marginTop: 7,
                    width: "100%",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "5px 10px",
                    borderRadius: 5,
                    border: allContainerColumnsVisible ? "1px solid #3B82F6" : "1px solid #CBD5E1",
                    cursor: "pointer",
                    background: allContainerColumnsVisible ? "#EFF6FF" : "#F8FAFC",
                    color: allContainerColumnsVisible ? "#1D4ED8" : "#475569",
                    textAlign: "left",
                  }}
                >
                  Container Columns
                </button>
              </div>

              {/* Options — placed before Column Visibility in DOM so stacked layout keeps it below Quick Preset */}
              {/* Options */}
              <div style={{ gridColumn: 1, gridRow: 3, padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Options
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, cursor: "pointer", background: showZeroSales ? "rgba(59,130,246,.06)" : "transparent" }}>
                    <input type="checkbox" checked={showZeroSales} onChange={() => setShowZeroSales((v) => !v)} style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: showZeroSales ? "#1E3A5F" : "#94A3B8" }}>Show Zero-Sales SKUs</span>
                  </label>
                  <div ref={skuFiltersRef} style={{ marginTop: 8, padding: "8px 6px 2px", borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        SKU Filters
                      </span>
                      <button
                        type="button"
                        disabled={!hasSkuPartFilters}
                        onClick={() => setSkuPartFilters(EMPTY_SKU_PART_FILTERS)}
                        style={{
                          fontSize: 10,
                          padding: "2px 7px",
                          borderRadius: 4,
                          border: "1px solid #CBD5E1",
                          cursor: hasSkuPartFilters ? "pointer" : "default",
                          background: "#F8FAFC",
                          color: hasSkuPartFilters ? "#475569" : "#A8B0BA",
                        }}
                      >
                        Reset
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {(["seat", "no", "color", "tone"] as SkuPartFilterKey[]).map((key) => {
                        const selectedValues = skuPartFilters[key];
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>{SKU_FILTER_LABELS[key]}</span>
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
                                  onClick={() => clearSkuPartFilter(key)}
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
                                {skuFilterOptions[key].map((value) => {
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
                                        onChange={() => handleSkuPartFilterToggle(key, value)}
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
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 6px 2px", borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Freeze Column
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select
                        value={freezeUntil}
                        onChange={(e) => setFreezeUntil(e.target.value)}
                        style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", color: "#1E293B", cursor: "pointer" }}
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
                </div>
              </div>

              {/* Columns */}
              <div style={{ gridColumn: 2, gridRow: "2 / 4", padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Column Visibility
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "min(560px, calc(100vh - 260px))", overflow: "auto", paddingRight: 4 }}>
                  {COLUMN_VISIBILITY_GROUP_KEYS.map((group) => {
                    const groupItems = COLUMN_VISIBILITY_ITEMS.filter((item) => item.group === group);
                    const checkedCount = groupItems.filter((item) => columnVis[item.id] !== false).length;
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
                            onChange={() => handleToggleColumnVisibilityGroup(group)}
                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleColumnVisibilityGroupOpen(group)}
                            title={GROUP_LABELS[group] || GROUP_BTN_LABELS[group] || group}
                            style={{ minWidth: 0, flex: 1, border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, color: checkedCount ? "#1E3A5F" : "#94A3B8" }}
                          >
                            {GROUP_LABELS[group] || GROUP_BTN_LABELS[group] || group}
                            <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: "#64748B" }}>
                              {checkedCount}/{groupItems.length}
                            </span>
                          </button>
                        </div>
                        {isOpen ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, padding: "0 0 4px 28px" }}>
                            {groupItems.map((item) => {
                              const checked = columnVis[item.id] !== false;
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
                                    onChange={() => handleToggleColumn(item.id)}
                                    style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                                  />
                                  <span
                                    title={`${GROUP_LABELS[item.group] || GROUP_BTN_LABELS[item.group]} / ${item.label}`}
                                    style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, color: checked ? "#1E3A5F" : "#94A3B8" }}
                                  >
                                    {item.label}
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

              {/* Column Colors + Selected Cell Color */}
              {gridMode === "ag-grid" ? (
                <div style={{ gridColumn: 3, gridRow: "2 / 4", padding: "10px 14px 8px", borderBottom: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Column Colors
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <select
                      value={selectedColorColumn}
                      onChange={(event) => setSelectedColorColumn(event.target.value)}
                      style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", color: "#1E293B", cursor: "pointer" }}
                    >
                      {colorableColumns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.label}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {(["cell", "header"] as const).map((target) => {
                        const current = columnColors[selectedColorColumn]?.[target] ?? (target === "cell" ? "#FFFFFF" : "#2A2825");
                        return (
                          <label key={target} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                            {target === "cell" ? "Cell" : "Header"}
                            <input
                              type="color"
                              disabled={target === "cell" && selectedColorColumnIsContainerHeader}
                              value={current}
                              onChange={(event) => handleColumnColorChange(selectedColorColumn, target, event.target.value)}
                              style={{ width: 34, height: 24, padding: 1, border: "1px solid #CBD5E1", borderRadius: 4, background: "#fff", cursor: target === "cell" && selectedColorColumnIsContainerHeader ? "default" : "pointer", opacity: target === "cell" && selectedColorColumnIsContainerHeader ? 0.45 : 1 }}
                            />
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        type="button"
                        onClick={resetSelectedColumnColor}
                        style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F1F5F9", color: "#64748B" }}
                      >
                        Reset Selected
                      </button>
                      <button
                        type="button"
                        onClick={resetColumnColors}
                        style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569" }}
                      >
                        Reset All
                      </button>
                    </div>
                  </div>

                  {/* Selected Cell Color — merged into same column 3 container */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Selected Cell Color
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <div
                        title={selectedAgCells.length > 1 ? `${selectedAgCells.length} cells selected` : selectedAgCell?.label}
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          borderRadius: 5,
                          border: "1px solid #CBD5E1",
                          background: selectedAgCell ? "#F8FAFC" : "#F1F5F9",
                          color: selectedAgCell ? "#1E293B" : "#94A3B8",
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "5px 8px",
                        }}
                      >
                        {selectedAgCells.length > 1 ? `${selectedAgCells.length} cells selected` : selectedAgCell ? selectedAgCell.label : "Click a grid cell first"}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 3,
                              border: "1px solid #CBD5E1",
                              background: selectedCellColorInfo.label === "Mixed"
                                ? "linear-gradient(135deg, #F87171 0 33%, #FACC15 33% 66%, #60A5FA 66% 100%)"
                                : selectedCellColorInfo.color,
                            }}
                          />
                          {selectedCellColorInfo.label}
                        </span>
                        <input
                          type="color"
                          disabled={!selectedAgCell}
                          value={selectedAgCell ? selectedCellColorInfo.color : "#FFFFFF"}
                          onChange={(event) => handleSelectedCellColorChange(event.target.value)}
                          style={{ width: 34, height: 24, padding: 1, border: "1px solid #CBD5E1", borderRadius: 4, background: "#fff", cursor: selectedAgCell ? "pointer" : "default" }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <button
                          type="button"
                          disabled={!selectedAgCell}
                          onClick={resetSelectedCellColor}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: selectedAgCell ? "pointer" : "default", background: "#F1F5F9", color: selectedAgCell ? "#64748B" : "#A8B0BA" }}
                        >
                          Reset Selected
                        </button>
                        <button
                          type="button"
                          onClick={resetCellColors}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569" }}
                        >
                          Reset All Cells
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #E2E8F0" }}>
                    <button
                      type="button"
                      onClick={resetColumnWidths}
                      style={{ width: "100%", fontSize: 11, padding: "6px 10px", borderRadius: 5, border: "1px solid #CBD5E1", cursor: "pointer", background: "#F8FAFC", color: "#475569", textAlign: "center" }}
                    >
                      Reset Column Widths
                    </button>
                  </div>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        )}

        <StatusBar
          rows={filteredRows}
          inline
          seasonalFactors={seasonalFactors}
          onSeasonalFactorsChange={handleSeasonalFactorsChange}
          gradient={gradient}
          gradientSC={gradientSC}
          onGradientChange={handleGradientChange}
          onGradientSCChange={handleGradientSCChange}
        />

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
        {gridMode === "ag-grid" ? <AgDemandPlanningGrid
          data={data}
          loading={loading}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          skuPartFilters={skuPartFilters}
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
          gradient={gradient}
          gradientSC={gradientSC}
          columnColors={columnColors}
          cellColors={cellColors}
          selectedCellKeys={selectedCellKeys}
          onAgCellSelected={(selection) => {
            setSelectedAgCell({ rowId: selection.rowId, columnId: selection.columnId, label: selection.label });
          }}
          onCellSelectionChange={(keys) => {
            const cells = keys.map((key) => {
              const sep = key.indexOf("::");
              const rowId = key.substring(0, sep);
              const columnId = key.substring(sep + 2);
              return { rowId, columnId, label: `${rowId} / ${columnId}` };
            });
            setSelectedAgCells(cells);
          }}
          onExportReady={handleAgGridExportReady}
        /> : <DemandPlanningGrid
          data={data}
          loading={loading}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          skuPartFilters={skuPartFilters}
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
          selectedCellKeys={selectedCellKeys}
        />}
      </div>
    </div>
  );
}
