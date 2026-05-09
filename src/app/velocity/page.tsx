"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
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
  type VelocityRow,
} from "@/components/velocity/velocity-table-columns";
import { TrendingUp, Check, X, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = ["Car Cover", "Car Seat", "Floor Mat"] as const;
const CHANNELS = ["Coverland", "Icarcover", "Amazon", "Auto_Armor", "Advance_Parts", "Walmart"] as const;
const DEFAULT_PERIODS = [90, 60, 30, 15, 7];

// ─── Period Chip Editor ───────────────────────────────────────────────────────

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
          className="flex items-center gap-0.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
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
                className="w-10 bg-transparent text-xs outline-none tabular-nums"
                autoFocus
              />
              <span className="text-muted-foreground">D</span>
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(i); }}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <Check className="h-2.5 w-2.5" />
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
                <X className="h-2.5 w-2.5" />
              </button>
            </>
          )}
        </span>
      ))}

      {adding ? (
        <span className="flex items-center gap-0.5 rounded-full border border-primary bg-muted px-2 py-0.5 text-xs">
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
            className="w-8 bg-transparent text-xs outline-none tabular-nums placeholder:text-muted-foreground"
            autoFocus
          />
          <span className="text-muted-foreground">D</span>
          <button
            onMouseDown={(e) => { e.preventDefault(); commitAdd(); }}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-2.5 w-2.5" />
          </button>
        </span>
      ) : periods.length < 5 ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-2.5 w-2.5" />
          Add
        </button>
      ) : null}
    </div>
  );
}

// ─── Toggle Button ────────────────────────────────────────────────────────────

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
          : "border border-border bg-background text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

// ─── Velocity Pane (UI only — no data loading) ────────────────────────────────

interface PaneProps {
  mode: "sales" | "ttm" | "preorder";
  periods: number[];
}

function VelocityPane({ mode, periods }: PaneProps) {
  const columns = useMemo(() => {
    if (mode === "preorder") return createPreOrderColumns(periods);
    if (mode === "ttm") return createTtmColumns(periods);
    return createSalesSalesColumns(periods);
  }, [mode, periods]);

  return (
    <Card>
      <CardContent className="p-0">
        <DataTable
          columns={columns}
          data={[] as VelocityRow[]}
          totalRows={0}
          pageCount={0}
          pagination={{ page: 1, pageSize: 100 }}
          onPaginationChange={() => {}}
          onSortingChange={() => {}}
          onSearchChange={() => {}}
          searchPlaceholder="Search Master SKU..."
          isLoading={false}
        />
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VelocityPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [mode, setMode] = useState<"sales" | "ttm" | "preorder">("sales");
  const [periods, setPeriods] = useState<number[]>(DEFAULT_PERIODS);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/velocity/sync")
      .then((r) => r.json())
      .then((data) => { if (data.success) setLastSyncedAt(data.lastSyncedAt); })
      .catch(() => {});
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/velocity/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const refresh = await fetch("/api/velocity/sync");
        const refreshData = await refresh.json();
        if (refreshData.success) setLastSyncedAt(refreshData.lastSyncedAt);
      }
    } catch {
      // silent
    } finally {
      setSyncing(false);
    }
  }, []);

  const toggleItem = useCallback((item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
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
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Velocity</h1>
          <div className="ml-auto flex items-center gap-3">
            {formattedSyncTime && (
              <span className="text-xs text-muted-foreground">
                Last synced: {formattedSyncTime}
              </span>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={syncing}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing..." : "Sync"}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sync Velocity Data</AlertDialogTitle>
                  <AlertDialogDescription>
                    Supabase에서 최신 데이터를 동기화합니다. 계속하시겠습니까?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSync}>Sync</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Filter panel */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          {/* Row 1: Item */}
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Item</span>
            <div className="flex items-center gap-2 flex-wrap">
              {ITEMS.map((item) => (
                <ToggleBtn
                  key={item}
                  active={selectedItems.includes(item)}
                  onClick={() => toggleItem(item)}
                >
                  {item}
                </ToggleBtn>
              ))}
            </div>
          </div>

          {/* Row 2: Channel */}
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Channel</span>
            <div className="flex items-center gap-2 flex-wrap">
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

          {/* Row 3: Mode + Periods */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Mode</span>
            <div className="flex items-center gap-2">
              <ToggleBtn active={mode === "sales"} onClick={() => setMode("sales")}>Sales</ToggleBtn>
              <ToggleBtn active={mode === "ttm"} onClick={() => setMode("ttm")}>TTM</ToggleBtn>
              <ToggleBtn active={mode === "preorder"} onClick={() => setMode("preorder")}>Pre Order</ToggleBtn>
            </div>
            <div className="ml-auto">
              <PeriodEditor periods={periods} onChange={setPeriods} />
            </div>
          </div>
        </div>

        {/* Grid */}
        {selectedItems.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              아이템을 하나 이상 선택하세요
            </CardContent>
          </Card>
        ) : selectedChannels.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              채널을 하나 이상 선택하세요
            </CardContent>
          </Card>
        ) : (
          <VelocityPane mode={mode} periods={periods} />
        )}
      </div>
    </AppLayout>
  );
}
