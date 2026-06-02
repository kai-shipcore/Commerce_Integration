"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef as AgColDef,
  type ColGroupDef,
  type ICellRendererParams,
  type IHeaderGroupParams,
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
  urgStatus,
} from "./columns";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { seasonalFactorForEta, type SeasonalFactors } from "@/lib/planning/seasonal-factors";
import type { CellContent } from "./columns";
import type { DemandPlanningGridProps } from "./demand-planning-grid";
import type { ContainerMeta, ContainerRowData, DemandRow } from "@/types/demand-planning";

const modules = [AllCommunityModule];
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

function containerColumnWidth(column: { id: string; w: number }) {
  if (column.id === "ccbm") return 48;
  if (column.id === "inb_qty") return 42;
  if (column.id === "remaining") return 42;
  if (column.id === "mistake") return 38;
  if (column.id === "esod" || column.id === "psod") return 70;
  return column.w;
}

function baseColumnWidth(column: { id: string; w: number }) {
  if (column.id === "eavg_p" || column.id === "eavg_r" || column.id === "eavg_c") return 50;
  if (column.id === "tavg_p" || column.id === "tavg_r" || column.id === "tavg_c") return 50;
  return column.w;
}

function categoryCodeForRow(row: DemandRow): "SC" | "CC" | "FM" {
  if (row.category_code) return row.category_code;
  const normalized = row.sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "CC";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "FM";
  return "SC";
}

function computeContainerChain(
  row: DemandRow,
  containers: ContainerMeta[],
  overrides: Map<string, QtyOverride>,
  seasonalFactors: SeasonalFactors,
): Map<string, ChainDerived> {
  const result = new Map<string, ChainDerived>();
  const availableQty = (row.total_stock ?? 0) + (row.back ?? 0);
  const dailyRate = row.total_avg_curr ?? 0;
  let previousCarryover = Math.max(0, availableQty);
  let previousBackorder = availableQty < 0 ? Math.abs(availableQty) : 0;
  let previousSod = row.sod;
  let previousEta = TODAY;
  let cumulativeAvailableQty = availableQty;

  for (const container of containers.slice(1)) {
    const key = `${row.sku}::${container.name}`;
    const raw = row.containers?.[container.name];
    const qty = overrides.get(key)?.inbound_qty ?? raw?.inbound_qty ?? 0;
    cumulativeAvailableQty += qty;
    const eta = container.eta ?? TODAY;
    const openOrders = previousCarryover > 0 ? 0 : (previousBackorder > qty ? -qty : -previousBackorder);
    const available = previousCarryover > 0 ? previousCarryover + qty : qty - previousBackorder;
    const days = Math.max(0, Math.round((new Date(eta).getTime() - new Date(previousEta).getTime()) / 86400000));
    const estimatedSales = Math.round(days * dailyRate * seasonalFactorForEta(eta, seasonalFactors));
    const backorder = Math.max(0, estimatedSales - available);
    const carryover = backorder >= 1 ? 0 : Math.max(0, available - estimatedSales);
    const inventoryLife = dailyRate > 0 ? Math.floor(carryover / dailyRate) : null;
    const sodFromContainer = inventoryLife === null
      ? null
      : new Date(new Date(eta).getTime() + inventoryLife * 86400000).toISOString().slice(0, 10);
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
}: ICellRendererParams<DemandRow, CellContent> & {
  copyValue: string;
  label: string;
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

function ContainerGroupHeader(
  props: IHeaderGroupParams & {
    eta: string;
    baseline: boolean;
    totalColumns: ContainerTotalColumn[];
    onEtaChange: (value: string) => void;
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
  categoryFilter,
  productFilter,
  urgencyFilter,
  search,
  onFilteredRowsChange,
  onLoadContainerDetails,
  containerDetailsLoading,
  containerDetailsLoaded,
  groupVis,
  compactMode,
  showRemaining,
  showMistake,
  showZeroSales,
  freezeUntil,
  columnWidths,
  onColumnWidthsChange,
  seasonalFactors,
}: DemandPlanningGridProps) {
  const gridRef = useRef<AgGridReact<DemandRow>>(null);
  const [etaOverrides, setEtaOverrides] = useState<Map<number, string>>(new Map());
  const [qtyOverrides, setQtyOverrides] = useState<Map<string, QtyOverride>>(new Map());
  const [chainMap, setChainMap] = useState<Map<string, Map<string, ChainDerived>>>(new Map());
  const [cbmOverrides, setCbmOverrides] = useState<Map<string, number>>(new Map());
  const [rowOverrides, setRowOverrides] = useState<Map<string, Partial<DemandRow>>>(new Map());

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
    return data.rows
      .filter((row) => {
        if (categoryCodeForRow(row) !== categoryFilter.toUpperCase()) return false;
        if (!showZeroSales &&
          !row.west_90d && !row.west_60d && !row.west_30d && !row.west_15d && !row.west_7d &&
          !row.east_90d && !row.east_60d && !row.east_30d && !row.east_15d && !row.east_7d) return false;
        if (productFilter === "orig" && row.sales_status !== "Original") return false;
        if (productFilter === "cust" && row.sales_status !== "Custom") return false;
        if (query && !row.sku.toLowerCase().includes(query) && !(row.containers_list ?? "").toLowerCase().includes(query)) return false;
        const urgency = urgStatus(row);
        if (urgencyFilter === "crit") return urgency === "crit";
        if (urgencyFilter === "warn") return urgency === "warn" || urgency === "crit";
        if (urgencyFilter === "bo") return (row.back ?? 0) < 0;
        return true;
      })
      .map((row) => ({
        ...row,
        ...(rowOverrides.get(row.sku) ?? {}),
        ...(cbmOverrides.has(row.sku) ? { cbm_per_unit: cbmOverrides.get(row.sku) } : {}),
      }));
  }, [categoryFilter, cbmOverrides, data.rows, productFilter, rowOverrides, search, showZeroSales, urgencyFilter]);

  useEffect(() => {
    onFilteredRowsChange(visibleRows);
  }, [onFilteredRowsChange, visibleRows]);

  useEffect(() => {
    if (groupVis.con && !containerDetailsLoaded && !containerDetailsLoading) onLoadContainerDetails();
  }, [containerDetailsLoaded, containerDetailsLoading, groupVis.con, onLoadContainerDetails]);

  const subColumns = useMemo(
    () => {
      const visibleColumns = CON_SUBCOLS.filter((column) =>
        (column.id !== "remaining" || showRemaining) && (column.id !== "mistake" || showMistake));
      const cbmColumn = visibleColumns.find((column) => column.id === "ccbm");
      return cbmColumn
        ? [cbmColumn, ...visibleColumns.filter((column) => column.id !== "ccbm")]
        : visibleColumns;
    },
    [showMistake, showRemaining],
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
        containerTotals.ccbm! += override !== undefined ? override.cbm ?? 0 : raw?.cbm ?? 0;
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
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setChainMap(new Map(
        data.rows.map((row) => [row.sku, computeContainerChain(row, containers, qtyOverrides, seasonalFactors)]),
      ));
    });
    return () => { cancelled = true; };
  }, [containers, data.rows, qtyOverrides, seasonalFactors]);

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.refreshCells({ force: true });
    api.refreshHeader();
  }, [cbmOverrides, chainMap, qtyOverrides, rowOverrides]);

  const updateEta = useCallback((container: ContainerMeta, eta: string) => {
    if (!eta || !container.container_id) return;
    setEtaOverrides((current) => new Map(current).set(container.container_id!, eta));
    const nextContainers = containers.map((entry) => entry.container_id === container.container_id ? { ...entry, eta } : entry);
    setChainMap(new Map(data.rows.map((row) => [row.sku, computeContainerChain(row, nextContainers, qtyOverrides, seasonalFactors)])));
    void fetch(`/api/containers?id=${container.container_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eta }),
    });
  }, [containers, data.rows, qtyOverrides, seasonalFactors]);

  const saveCbm = useCallback(async (row: DemandRow, nextCbm: number) => {
    if (!Number.isFinite(nextCbm) || nextCbm < 0) return false;
    if (nextCbm === row.cbm_per_unit) return true;
    const response = await fetch(`/api/planning/products/${encodeURIComponent(row.sku)}`, {
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

    let json: { success: boolean; qty?: number; total_cbm?: number; item_id?: number };
    if (itemId && nextQty === 0) {
      json = await fetch(`/api/planning/containers/items/${itemId}`, { method: "DELETE" }).then((response) => response.json());
    } else if (itemId) {
      json = await fetch(`/api/planning/containers/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: nextQty }),
      }).then((response) => response.json());
    } else {
      json = await fetch("/api/planning/containers/items", {
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
    nextOverrides.set(key, {
      inbound_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
      avail_qty: nextQty === 0 ? null : (json.qty ?? nextQty),
      cbm: nextQty === 0 ? null : (json.total_cbm ?? 0),
      cbm_unit: previous?.cbm_unit ?? raw.cbm_unit,
      item_id: nextQty === 0 ? undefined : (json.item_id ?? itemId),
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
    return true;
  }, [containers, qtyOverrides, seasonalFactors]);

  const columnDefs = useMemo<Array<AgColDef<DemandRow> | ColGroupDef<DemandRow>>>(() => {
    const visibleBaseColumns = ALL_COLS
      .filter((column) => column.grp === "fix" || groupVis[column.grp])
      .filter((column) => !compactMode || COMPACT_COLUMN_IDS.has(column.id));
    const freezeIndex = visibleBaseColumns.findIndex((column) => column.id === freezeUntil);
    const baseGroups = new Map<string, AgColDef<DemandRow>[]>();

  visibleBaseColumns.forEach((column, index) => {
    const columns = baseGroups.get(column.grp) ?? [];
    const isCopyable = column.id === "sku" || column.id === "inb_lst";
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
        width: columnWidths[column.id as keyof typeof columnWidths] ?? baseColumnWidth(column),
        minWidth: Math.min(36, column.w),
        sortable: column.id !== "row_num",
      pinned: freezeIndex >= 0 && index <= freezeIndex ? "left" : undefined,
      valueGetter: (params) => params.data ? column.val(params.data, params.node?.rowIndex ?? 0, urgStatus(params.data)) : "",
      cellRenderer: isCopyable ? CopyableCellRenderer : column.id === "cbm" ? CbmCellRenderer : CellRenderer,
      cellRendererParams: isCopyable
        ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
            copyValue: column.id === "sku"
              ? params.data?.sku ?? ""
              : params.data?.containers_list ?? "",
            label: column.id === "sku" ? "Master SKU" : "Containers List",
          })
        : column.id === "cbm"
          ? (params: ICellRendererParams<DemandRow, CellContent>) => ({
              onSave: (cbm: number) => params.data ? saveCbm(params.data, cbm) : Promise.resolve(false),
            })
        : undefined,
      cellStyle: {
          backgroundColor: TINT_COLORS[column.tint] || "#fff",
          fontWeight: column.bold ? 700 : 400,
          textAlign: column.align === "num" ? "right" : column.align === "ctr" ? "center" : "left",
          ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
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
      for (const container of containers) {
        const baseline = container.status === "baseline";
        groups.push({
          groupId: `container-${container.name}`,
          headerName: container.name,
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
          },
          children: subColumns.map((column) => ({
            colId: `${container.name}::${column.id}`,
            headerName: column.id === "oo"
              ? "Open Ord"
              : column.id === "remaining"
                ? "Rem."
                : column.id === "mistake"
                  ? "Mist"
                  : column.label.replace("\n", " "),
            headerTooltip: column.label.replace("\n", " "),
            width: containerColumnWidth(column),
            valueGetter: (params) => {
              if (!params.data) return "";
              const key = `${params.data.sku}::${container.name}`;
              const raw = params.data.containers?.[container.name] ?? {
                item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
                est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
                inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
              };
              const value = { ...raw, ...(qtyOverrides.get(key) ?? {}), ...(chainMap.get(params.data.sku)?.get(container.name) ?? {}) };
              return column.val(value, container, params.data);
            },
            cellRenderer: column.id === "inb_qty" && !baseline ? QtyCellRenderer : CellRenderer,
            cellRendererParams: column.id === "inb_qty" && !baseline ? (params: ICellRendererParams<DemandRow, CellContent>) => {
              const row = params.data;
              if (!row) return { onSave: async () => false };
              const raw = row.containers?.[container.name] ?? {
                item_id: null, cbm_unit: null, inbound_qty: null, open_orders: 0, avail_qty: null,
                est_sales: 0, backorder: 0, carryover: null, eta: container.eta,
                inv_life: null, est_sod: null, plan_sod: null, cbm: 0,
              };
              return { onSave: (qty: number) => saveQty(row, container, raw, qty) };
            } : undefined,
            cellStyle: {
              backgroundColor: baseline ? "#E8F5E0" : TINT_COLORS[column.tint] || "#fff",
              textAlign: column.align === "num" ? "right" : column.align === "ctr" ? "center" : "left",
              ...(column.align === "num" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
            },
          })),
        });
      }
    }
    return groups;
  }, [chainMap, columnWidths, compactMode, containerColumnTotals, containers, freezeUntil, groupVis, qtyOverrides, saveCbm, saveQty, subColumns, updateEta]);

  return (
    <div className="planning-ag-grid h-full min-h-0 w-full bg-white">
      <style>{`
        .planning-ag-grid .ag-row-selected .ag-cell {
          background-color: transparent !important;
        }
        .planning-ag-grid .ag-row-selected {
          outline: 1px solid #7aa7e8;
          outline-offset: -1px;
        }
        .planning-ag-grid .ag-cell-focus:not(.ag-cell-range-selected):focus-within {
          border-color: transparent;
        }
      `}</style>
      <AgGridProvider modules={modules}>
        <AgGridReact<DemandRow>
          ref={gridRef}
          theme={planningTheme}
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
          onCellClicked={(event) => event.node.setSelected(true, true)}
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
          getRowStyle={(params) => params.data && urgStatus(params.data) === "crit" ? { backgroundColor: "#FFF5F5" } : undefined}
          overlayLoadingTemplate={containerDetailsLoading ? "Loading container details..." : "Loading..."}
        />
      </AgGridProvider>
    </div>
  );
}
