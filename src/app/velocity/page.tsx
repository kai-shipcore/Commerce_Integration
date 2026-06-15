"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { DataTable } from "@/components/ui/data-table/data-table";
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
import {
  createSalesSalesColumns,
  createTtmColumns,
  createPreOrderColumns,
  createCarCoverColumns,
  createFloorMatColumns,
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { Gauge, Check, X, Plus, RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportCurrentVelocity, exportAllVelocity } from "@/lib/velocity-export";
import { apiPath } from "@/lib/api-path";

const ITEMS = ["Car Cover", "Seat Cover", "Floor Mat"] as const;
const CHANNELS = [
  "Shopify Coverland B2B",
  "Shopify Coverland B2C",
  "Shopify Icarcover",
  "Amazon FBA",
  "Amazon FBM",
  "Ebay Auto_Armor",
  "Ebay Advance_Parts",
  "Walmart",
] as const;

const CHANNEL_DB_KEY: Record<string, string> = {
  "Shopify Coverland B2B": "Coverland B2B",
  "Shopify Coverland B2C": "Coverland B2C",
  "Shopify Icarcover":     "Icarcover",
  "Amazon FBA":            "Amazon FBA",
  "Amazon FBM":            "Amazon FBM",
  "Ebay Auto_Armor":       "Auto_Armor",
  "Ebay Advance_Parts":    "Advance_Parts",
  "Walmart":               "Walmart",
};

const DEFAULT_PERIODS = [90, 60, 30, 15, 7];

interface PeriodRange { from: string; to: string }

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeDays(r: PeriodRange): number {
  return Math.round((new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400000) + 1;
}

function defaultRanges(): PeriodRange[] {
  const to = new Date();
  to.setDate(to.getDate() - 2);
  const toStr = toLocalDateStr(to);
  return DEFAULT_PERIODS.map((n) => {
    const from = new Date(to);
    from.setDate(from.getDate() - (n - 1));
    return { from: toLocalDateStr(from), to: toStr };
  });
}

function periodsToRanges(periods: number[]): PeriodRange[] {
  const to = new Date();
  to.setDate(to.getDate() - 2);
  const toStr = toLocalDateStr(to);
  return periods.map((n) => {
    const from = new Date(to);
    from.setDate(from.getDate() - (n - 1));
    return { from: toLocalDateStr(from), to: toStr };
  });
}

// Period Chip Editor

interface PeriodEditorProps {
  periods: number[];
  onChange: (periods: number[]) => void;
}

function PeriodEditor({ periods, onChange }: PeriodEditorProps) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const commitAdd = useCallback(() => {
    const n = parseInt(pending, 10);
    if (n > 0 && !periods.includes(n) && periods.length < 5) {
      onChange([...periods, n].sort((a, b) => b - a));
    }
    setPending("");
    setAdding(false);
  }, [pending, periods, onChange]);

  const commitEdit = useCallback((idx: number) => {
    const n = parseInt(editingVal, 10);
    const otherPeriods = periods.filter((_, i) => i !== idx);
    if (n > 0 && !otherPeriods.includes(n)) {
      const next = [...periods];
      next[idx] = n;
      onChange(next.sort((a, b) => b - a));
    }
    setEditingIdx(null);
    setEditingVal("");
  }, [editingVal, periods, onChange]);

  const removePeriod = useCallback((idx: number) => {
    if (periods.length <= 1) return;
    onChange(periods.filter((_, i) => i !== idx));
  }, [periods, onChange]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium shrink-0">Periods:</span>

      {periods.map((p, i) => (
        <span
          key={`${p}-${i}`}
          className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5 text-sm text-foreground dark:border-slate-700 dark:bg-slate-800"
        >
          {editingIdx === i ? (
            <>
              <input
                type="number"
                value={editingVal}
                onChange={(e) => setEditingVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(i);
                  if (e.key === "Escape") { setEditingIdx(null); setEditingVal(""); }
                }}
                onBlur={() => commitEdit(i)}
                className="w-10 bg-transparent text-sm outline-none tabular-nums"
                autoFocus
              />
              <span className="text-muted-foreground">D</span>
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(i); }}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                className="tabular-nums hover:text-foreground"
                onClick={() => { setEditingIdx(i); setEditingVal(String(p)); }}
              >
                {p}D
              </button>
              <button
                onClick={() => removePeriod(i)}
                disabled={periods.length <= 1}
                className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </span>
      ))}

      {adding ? (
        <span className="flex items-center gap-1 rounded-full border border-primary bg-muted px-3 py-1.5 text-sm text-foreground dark:bg-slate-800">
          <input
            ref={addInputRef}
            type="number"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") { setAdding(false); setPending(""); }
            }}
            onBlur={commitAdd}
            placeholder="___"
            className="w-8 bg-transparent text-sm outline-none tabular-nums placeholder:text-muted-foreground"
            autoFocus
          />
          <span className="text-muted-foreground">D</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); commitAdd(); }}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : periods.length < 5 ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground dark:border-slate-700 dark:hover:border-slate-300 dark:hover:text-slate-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      ) : null}
    </div>
  );
}

// Toggle Button

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-background text-foreground hover:bg-muted dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
      )}
    >
      {children}
    </button>
  );
}

// Shared helpers

type ApiData = {
  link: { masterSku: string; qtys: number[] }[];
  custom: { masterSku: string; qtys: number[] }[];
  ttm?: { masterSku: string; qtys: number[] }[];
};

function responseToRows(data: ApiData, count: number): VelocityRow[] {
  const link = data.link ?? [];
  const custom = data.custom ?? [];
  const ttm = data.ttm;
  const maxLen = Math.max(link.length, custom.length, ttm?.length ?? 0);
  if (maxLen === 0) return [];

  const nullQtys = () => Array(count).fill(null) as (number | null)[];

  const dataRows: VelocityRow[] = Array.from({ length: maxLen }, (_, i) => ({
    masterSku: link[i]?.masterSku ?? "",
    qtys: link[i]?.qtys ?? nullQtys(),
    customMasterSku: custom[i]?.masterSku ?? null,
    customQtys: custom[i]?.qtys ?? nullQtys(),
    ttmMasterSku: ttm?.[i]?.masterSku ?? null,
    ttmQtys: ttm?.[i]?.qtys ?? nullQtys(),
  }));

  const totalRow: VelocityRow = {
    masterSku: "Total",
    qtys: Array.from({ length: count }, (_, i) => link.reduce((s, r) => s + (r.qtys[i] ?? 0), 0)),
    customMasterSku: custom.length > 0 ? "Total" : null,
    customQtys: Array.from({ length: count }, (_, i) => custom.reduce((s, r) => s + (r.qtys[i] ?? 0), 0)),
    ttmMasterSku: ttm && ttm.length > 0 ? "Total" : null,
    ttmQtys: ttm && ttm.length > 0
      ? Array.from({ length: count }, (_, i) => ttm.reduce((s, r) => s + (r.qtys[i] ?? 0), 0))
      : null,
    isTotal: true,
  };

  return [totalRow, ...dataRows];
}

async function fetchModeRows(
  mode: "sales" | "ttm" | "preorder",
  item: string,
  channels: string[],
  ranges: PeriodRange[],
  tz: "utc" | "la" = "utc",
  combined?: boolean
): Promise<VelocityRow[]> {
  const dbChannels = [...new Set(channels.map((ch) => CHANNEL_DB_KEY[ch] ?? ch))];
  const params = new URLSearchParams({
    items: item,
    channels: dbChannels.join(","),
    mode,
    ranges: ranges.map((r) => `${r.from}:${r.to}`).join(","),
    tz,
    ...(combined ? { combined: "1" } : {}),
  });
  const res = await fetch(apiPath(`/api/velocity/data?${params}`));
  const data = await res.json();
  if (!data.success) return [];
  return responseToRows(data as ApiData, ranges.length);
}

// Custom Range Editor

interface CustomRangeEditorProps {
  ranges: PeriodRange[];
  onChange: (ranges: PeriodRange[]) => void;
}

function CustomRangeEditor({ ranges, onChange }: CustomRangeEditorProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [adding, setAdding] = useState(false);
  const [addFrom, setAddFrom] = useState("");
  const [addTo, setAddTo] = useState("");

  const commitEdit = useCallback((idx: number) => {
    if (editFrom && editTo && editFrom <= editTo) {
      const next = [...ranges];
      next[idx] = { from: editFrom, to: editTo };
      onChange(next);
    }
    setEditingIdx(null);
  }, [editFrom, editTo, ranges, onChange]);

  const commitAdd = useCallback(() => {
    if (addFrom && addTo && addFrom <= addTo && ranges.length < 5) {
      onChange([...ranges, { from: addFrom, to: addTo }]);
    }
    setAddFrom(""); setAddTo(""); setAdding(false);
  }, [addFrom, addTo, ranges, onChange]);

  const remove = useCallback((idx: number) => {
    if (ranges.length <= 1) return;
    onChange(ranges.filter((_, i) => i !== idx));
  }, [ranges, onChange]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium shrink-0">Periods:</span>
      {ranges.map((r, i) => (
        <span key={i} className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5 text-sm text-foreground dark:border-slate-700 dark:bg-slate-800">
          {editingIdx === i ? (
            <>
              <input type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)}
                className="bg-transparent text-sm outline-none" />
              <span className="text-muted-foreground">~</span>
              <input type="date" value={editTo} onChange={(e) => setEditTo(e.target.value)}
                className="bg-transparent text-sm outline-none" />
              {editFrom && editTo && editFrom <= editTo && (
                <span className="text-muted-foreground text-xs ml-1">
                  ({rangeDays({ from: editFrom, to: editTo })}d)
                </span>
              )}
              <button onMouseDown={(e) => { e.preventDefault(); commitEdit(i); }}
                className="ml-1 text-muted-foreground hover:text-foreground">
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button className="tabular-nums hover:text-foreground text-sm"
                onClick={() => { setEditingIdx(i); setEditFrom(r.from); setEditTo(r.to); }}>
                {rangeDays(r)}D
                <span className="ml-1 text-muted-foreground text-xs">{r.from.slice(5)}~{r.to.slice(5)}</span>
              </button>
              <button onClick={() => remove(i)} disabled={ranges.length <= 1}
                className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </span>
      ))}
      {adding ? (
        <span className="flex items-center gap-1 rounded-full border border-primary bg-muted px-3 py-1.5 text-sm text-foreground dark:bg-slate-800">
          <input type="date" value={addFrom} onChange={(e) => setAddFrom(e.target.value)}
            className="bg-transparent text-sm outline-none" />
          <span className="text-muted-foreground">~</span>
          <input type="date" value={addTo} onChange={(e) => setAddTo(e.target.value)}
            className="bg-transparent text-sm outline-none" />
          {addFrom && addTo && addFrom <= addTo && (
            <span className="text-muted-foreground text-xs ml-1">
              ({rangeDays({ from: addFrom, to: addTo })}d)
            </span>
          )}
          <button onMouseDown={(e) => { e.preventDefault(); commitAdd(); }}
            className="ml-1 text-muted-foreground hover:text-foreground">
            <Check className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : ranges.length < 5 ? (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">
          <Plus className="h-3.5 w-3.5" />Add
        </button>
      ) : null}
    </div>
  );
}

// Velocity Pane

interface PaneProps {
  mode: "sales" | "ttm" | "preorder";
  ranges: PeriodRange[];
  selectedItem: string;
  selectedChannels: string[];
  timezone: "utc" | "la";
  exportSlot: HTMLDivElement | null;
}

function VelocityPane({ mode, ranges, selectedItem, selectedChannels, timezone, exportSlot }: PaneProps) {
  const [allRows, setAllRows] = useState<VelocityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100 });
  const [sorting, setSorting] = useState<{ sortBy: string; sortOrder: "asc" | "desc" } | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const labels = useMemo(() => ranges.map((r) => `${rangeDays(r)}D`), [ranges]);

  const columns = useMemo(() => {
    if (selectedItem === "Car Cover") return createCarCoverColumns(labels);
    if (selectedItem === "Floor Mat") return createFloorMatColumns(labels);
    if (mode === "preorder") return createPreOrderColumns(labels);
    if (mode === "ttm") return createTtmColumns(labels);
    return createSalesSalesColumns(labels);
  }, [mode, labels, selectedItem]);

  const rangesKey = ranges.map((r) => `${r.from}:${r.to}`).join(",");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset pagination after velocity filter changes.
    setPagination((p) => ({ ...p, page: 1 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, selectedChannels.join(","), mode, rangesKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start table loading after velocity query changes.
    setLoading(true);
    const combined = selectedItem === "Car Cover" && mode === "preorder";
    fetchModeRows(mode, selectedItem, selectedChannels, ranges, timezone, combined)
      .then((rows) => setAllRows(rows))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, selectedChannels.join(","), mode, rangesKey, timezone]);

  const filtered = useMemo(() => {
    const hasAnyQty = (r: VelocityRow) =>
      r.isTotal ||
      r.qtys.some((v) => (v ?? 0) > 0) ||
      (r.customQtys ?? []).some((v) => (v ?? 0) > 0) ||
      (r.ttmQtys ?? []).some((v) => (v ?? 0) > 0);

    const base = allRows.filter(hasAnyQty);
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter((r) => {
      if (r.isTotal) return true;
      if (r.masterSku.toLowerCase().includes(q)) return true;
      if (selectedItem === "Car Cover") {
        return r.masterSku.replace("BKGR", "BKLG").toLowerCase().includes(q);
      }
      if (selectedItem === "Floor Mat") return false;
      // Seat Cover
      if (r.customMasterSku?.toLowerCase().includes(q)) return true;
      if (mode === "preorder" && (r.ttmMasterSku?.toLowerCase().includes(q) ?? false)) return true;
      return false;
    });
  }, [allRows, search, mode, selectedItem]);

  const sorted = useMemo(() => {
    if (!sorting) return filtered;
    const { sortBy, sortOrder } = sorting;
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (a.isTotal) return -1;
      if (b.isTotal) return 1;
      if (sortBy === "masterSku") {
        return dir * a.masterSku.localeCompare(b.masterSku);
      }
      const m = sortBy.match(/^qty_(\d+)$/);
      if (m) {
        const i = Number(m[1]);
        return dir * ((a.qtys[i] ?? 0) - (b.qtys[i] ?? 0));
      }
      return 0;
    });
  }, [filtered, sorting]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pagination.pageSize));
  const pageData = sorted.slice(
    (pagination.page - 1) * pagination.pageSize,
    pagination.page * pagination.pageSize
  );

  const label = [selectedItem, ...selectedChannels].join("_").replace(/\s+/g, "");

  const handleExportCurrent = useCallback(() => {
    exportCurrentVelocity(allRows, mode, labels, label, selectedItem);
  }, [allRows, mode, labels, label, selectedItem]);

  const handleExportAll = useCallback(async () => {
    setExportingAll(true);
    try {
      const [salesRows, ttmRows, preorderRows] = await Promise.all([
        fetchModeRows("sales",    selectedItem, selectedChannels, ranges, timezone),
        fetchModeRows("ttm",      selectedItem, selectedChannels, ranges, timezone),
        fetchModeRows("preorder", selectedItem, selectedChannels, ranges, timezone),
      ]);
      exportAllVelocity(salesRows, ttmRows, preorderRows, labels, label, selectedItem);
    } catch {
      // silent
    } finally {
      setExportingAll(false);
    }
  }, [selectedItem, selectedChannels, ranges, labels, label, timezone]);

  const exportButtons = (
    <div className="flex items-center gap-2">
        <button
          onClick={handleExportCurrent}
          disabled={loading || allRows.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <button
          onClick={handleExportAll}
          disabled={exportingAll || selectedItem === "" || selectedChannels.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
          {exportingAll ? "Exporting..." : "Export All"}
        </button>
    </div>
  );

  return (
    <div className="min-w-[1320px]">
      {exportSlot ? createPortal(exportButtons, exportSlot) : null}
      <DataTable
        columns={columns}
        data={pageData}
        totalRows={sorted.length}
        pageCount={pageCount}
        pagination={pagination}
        onPaginationChange={(page, pageSize) => setPagination({ page, pageSize })}
        onSortingChange={(sortBy, sortOrder) => {
          setSorting({ sortBy, sortOrder });
          setPagination((p) => ({ ...p, page: 1 }));
        }}
        onSearchChange={(q) => { setSearch(q); setPagination((p) => ({ ...p, page: 1 })); }}
        searchPlaceholder="Search Master SKU..."
        isLoading={loading}
      />
    </div>
  );
}

// Main Page

export default function VelocityPage() {
  const [selectedItem, setSelectedItem] = useState<string>("Car Cover");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([...CHANNELS]);
  const [mode, setMode] = useState<"sales" | "ttm" | "preorder">("sales");
  const [periodMode, setPeriodMode] = useState<"period" | "custom">("period");
  const [periods, setPeriods] = useState<number[]>(DEFAULT_PERIODS);
  const [customRanges, setCustomRanges] = useState<PeriodRange[]>(() => defaultRanges());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exportSlot, setExportSlot] = useState<HTMLDivElement | null>(null);
  const [timezone, setTimezone] = useState<"utc" | "la">(() =>
    typeof window !== "undefined"
      ? ((localStorage.getItem("velocity_tz") as "utc" | "la") ?? "utc")
      : "utc"
  );

  useEffect(() => {
    localStorage.setItem("velocity_tz", timezone);
  }, [timezone]);

  const activeRanges = periodMode === "period" ? periodsToRanges(periods) : customRanges;

  useEffect(() => {
    fetch(apiPath("/api/velocity/sync"))
      .then((r) => r.json())
      .then((data) => { if (data.success) setLastSyncedAt(data.lastSyncedAt); })
      .catch(() => {});
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(apiPath("/api/velocity/sync"), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const refresh = await fetch(apiPath("/api/velocity/sync"));
        const refreshData = await refresh.json();
        if (refreshData.success) setLastSyncedAt(refreshData.lastSyncedAt);
      }
    } catch {
      // silent
    } finally {
      setSyncing(false);
    }
  }, []);

  const selectItem = useCallback((item: string) => {
    setSelectedItem(item);
  }, []);

  const toggleChannel = useCallback((ch: string) => {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }, []);

  const formattedSyncTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : null;

  return (
    <AppLayout>
      <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <Gauge className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">Velocity</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Compare sales velocity by product, channel, mode, and period.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div ref={setExportSlot} className="flex items-center gap-2" />
            {formattedSyncTime && (
              <span className="text-xs text-muted-foreground">
                Last synced: {formattedSyncTime}
              </span>
            )}
            <div className="flex items-center rounded-md border border-border bg-muted p-0.5 text-xs dark:border-slate-700 dark:bg-slate-800">
              {(["utc", "la"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimezone(t)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    timezone === t
                      ? "bg-background shadow-sm text-foreground dark:bg-slate-950 dark:text-slate-50"
                      : "text-muted-foreground hover:text-foreground dark:text-slate-300 dark:hover:text-slate-50"
                  )}
                >
                  {t === "utc" ? "UTC" : "LA Time"}
                </button>
              ))}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={syncing}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing..." : "Sync"}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sync Velocity Data</AlertDialogTitle>
                  <AlertDialogDescription>
                    Sync the latest velocity data from Supabase. Continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSync}>Sync</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>

        <div className="border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Item</span>
                <div className="flex flex-wrap items-center gap-2">
                  {ITEMS.map((item) => (
                    <ToggleBtn
                      key={item}
                      active={selectedItem === item}
                      onClick={() => selectItem(item)}
                    >
                      {item}
                    </ToggleBtn>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Channel</span>
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleBtn
                    active={selectedChannels.length === CHANNELS.length}
                    onClick={() =>
                      setSelectedChannels(selectedChannels.length === CHANNELS.length ? [] : [...CHANNELS])
                    }
                  >
                    All
                  </ToggleBtn>
                  {CHANNELS.map((ch) => (
                    <ToggleBtn
                      key={ch}
                      active={selectedChannels.includes(ch)}
                      onClick={() => toggleChannel(ch)}
                    >
                      {ch}
                    </ToggleBtn>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Mode</span>
                <div className="flex items-center gap-2">
                  <ToggleBtn active={mode === "sales"} onClick={() => setMode("sales")}>Sales</ToggleBtn>
                  <ToggleBtn active={mode === "ttm"} onClick={() => setMode("ttm")}>TTM</ToggleBtn>
                  <ToggleBtn active={mode === "preorder"} onClick={() => setMode("preorder")}>Pre Order</ToggleBtn>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <div className="flex items-center rounded-md border border-border bg-muted p-0.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => setPeriodMode("period")}
                      className={cn("rounded px-2.5 py-1 font-medium transition-colors",
                        periodMode === "period" ? "bg-background shadow-sm text-foreground dark:bg-slate-950 dark:text-slate-50" : "text-muted-foreground hover:text-foreground dark:text-slate-300 dark:hover:text-slate-50"
                      )}
                    >
                      Period
                    </button>
                    <button
                      onClick={() => setPeriodMode("custom")}
                      className={cn("rounded px-2.5 py-1 font-medium transition-colors",
                        periodMode === "custom" ? "bg-background shadow-sm text-foreground dark:bg-slate-950 dark:text-slate-50" : "text-muted-foreground hover:text-foreground dark:text-slate-300 dark:hover:text-slate-50"
                      )}
                    >
                      Custom
                    </button>
                  </div>
                  {periodMode === "period" ? (
                    <PeriodEditor periods={periods} onChange={setPeriods} />
                  ) : (
                    <CustomRangeEditor ranges={customRanges} onChange={setCustomRanges} />
                  )}
                </div>
              </div>
            </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-white p-5 dark:bg-slate-950">
          {selectedItem === "" ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
              Select an item
            </div>
          ) : selectedChannels.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
              Select at least one channel
            </div>
          ) : (
            <VelocityPane
              mode={mode}
              ranges={activeRanges}
              selectedItem={selectedItem}
              selectedChannels={selectedChannels}
              timezone={timezone}
              exportSlot={exportSlot}
            />
          )}
        </div>
      </section>
    </AppLayout>
  );
}
