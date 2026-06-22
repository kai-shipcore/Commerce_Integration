"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarRange, ChevronDown, ExternalLink, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath, withBasePath } from "@/lib/api-path";
import type { DemandPlanningData, DemandRow } from "@/types/demand-planning";
import { getUrgency, recommendedContainerQty } from "@/components/planning/sku-forecasts/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type ContainerStatus = "draft" | "final-list-sent" | "packing-list-received" | "complete";
type Period = "3M" | "6M" | "all";
type TimelineProductKey = "sc" | "cc" | "fm";
type TimelineProductFilter = "all" | TimelineProductKey;

interface ContainerItem {
  id: string;
  sku: string;
  qty: number;
  cbm: number;
}

type SkuImpactLevel = "critical" | "warning" | "ok" | "unknown";
type SkuImpactSortKey = "sku" | "level" | "stock" | "sales" | "sod" | "stockout" | "etaImpact" | "quantity" | "totalInbound" | "postSod" | "cbm";
type SortDirection = "asc" | "desc";

interface SkuImpact {
  item: ContainerItem;
  currentStock: number | null;
  averageDailySales: number | null;
  estimatedSod: string | null;
  stockoutBeforeEta: boolean | null;
  requiredQty: number | null;
  projectedStockAtEta: number | null;
  backorderAtEta: number | null;
  totalInboundQty: number | null;
  postInboundSod: string | null;
  level: SkuImpactLevel;
}

interface Container {
  id: string;
  containerNumber: string;
  etaDate: string | null;
  actualArrivalDate: string | null;
  status: ContainerStatus;
  cbmCapacity: number;
  factoryName: string | null;
  origin: string | null;
  destWarehouse: string | null;
  note: string | null;
  itemCount: number;
  totalQty: number;
  totalCbm: number;
  items: ContainerItem[];
}

interface ContainerApiItem {
  id?: unknown;
  sku?: unknown;
  qty?: unknown;
  cbm?: unknown;
}

interface ContainerApiRow {
  id?: unknown;
  containerNumber?: unknown;
  etaDate?: unknown;
  actualArrivalDate?: unknown;
  status?: unknown;
  cbmCapacity?: unknown;
  factoryName?: unknown;
  origin?: unknown;
  destWarehouse?: unknown;
  note?: unknown;
  itemCount?: unknown;
  totalQty?: unknown;
  totalCbm?: unknown;
  items?: ContainerApiItem[];
}

interface MonthSegment {
  label: string;
  widthPct: number;
  isCurrent: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_ORDER: ContainerStatus[] = [
  "packing-list-received",
  "final-list-sent",
  "draft",
  "complete",
];

const STATUS_LABEL: Record<ContainerStatus, string> = {
  "packing-list-received": "Packing",
  "final-list-sent": "Final",
  draft: "Draft",
  complete: "Complete",
};

const STATUS_LABEL_FULL: Record<ContainerStatus, string> = {
  "packing-list-received": "Packing List Rcvd",
  "final-list-sent": "Final List Sent",
  draft: "Draft",
  complete: "Complete",
};

const STATUS_COLOR: Record<ContainerStatus, string> = {
  "packing-list-received": "#378add",
  "final-list-sent": "#ef9f27",
  draft: "#d4537e",
  complete: "#22a666",
};

const STATUS_PILL: Record<ContainerStatus, string> = {
  "packing-list-received": "bg-[#ebf0fd] text-[#1a4db0]",
  "final-list-sent": "bg-[#fef3e2] text-[#8a5300]",
  draft: "bg-[#fce4ec] text-[#880e4f]",
  complete: "bg-[#e6f7ee] text-[#166534]",
};

const PERIOD_OPTIONS: { value: Period; label: string; days: number | null }[] = [
  { value: "3M", label: "3개월", days: 90 },
  { value: "6M", label: "6개월", days: 180 },
  { value: "all", label: "전체", days: null },
];

const PRODUCT_OPTIONS: { value: TimelineProductFilter; label: string; shortLabel: string }[] = [
  { value: "all", label: "전체", shortLabel: "ALL" },
  { value: "sc", label: "Seat Cover", shortLabel: "SC" },
  { value: "cc", label: "Car Cover", shortLabel: "CC" },
  { value: "fm", label: "Floor Mat", shortLabel: "FM" },
];

const PRODUCT_BADGE: Record<TimelineProductKey, string> = {
  sc: "bg-blue-100 text-blue-700",
  cc: "bg-violet-100 text-violet-700",
  fm: "bg-emerald-100 text-emerald-700",
};

// ── Date helpers ──────────────────────────────────────────────────────────────

const MS = 86_400_000;
const toDate = (s: string) => new Date(s + "T00:00:00");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS);
const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / MS);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtMonthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
function buildSkuImpact(item: ContainerItem, containerName: string, etaDate: string | null, row?: DemandRow): SkuImpact {
  if (!row) {
    return {
      item,
      currentStock: null,
      averageDailySales: null,
      estimatedSod: null,
      stockoutBeforeEta: null,
      requiredQty: null,
      projectedStockAtEta: null,
      backorderAtEta: null,
      totalInboundQty: null,
      postInboundSod: null,
      level: "unknown",
    };
  }

  const estimatedSod = row.sod;
  const stockoutBeforeEta = etaDate && estimatedSod ? estimatedSod < etaDate : null;
  const requiredQty = recommendedContainerQty(row);
  const containerImpact = row.containers[containerName];
  const projectedStockAtEta = containerImpact?.carryover ?? null;
  const backorderAtEta = containerImpact?.backorder ?? null;
  const postInboundSod = containerImpact?.est_sod ?? null;
  const urgency = getUrgency(row);
  const level: SkuImpactLevel = stockoutBeforeEta || (backorderAtEta ?? 0) > 0
    ? "critical"
    : urgency !== "healthy" || requiredQty > 0
      ? "warning"
      : "ok";

  return {
    item,
    currentStock: row.total_stock,
    averageDailySales: row.total_avg_curr,
    estimatedSod,
    stockoutBeforeEta,
    requiredQty,
    projectedStockAtEta,
    backorderAtEta,
    totalInboundQty: row.total_inbound_qty,
    postInboundSod,
    level,
  };
}

function normalizeStatus(raw: string): ContainerStatus {
  if (raw === "shipped") return "final-list-sent";
  if (raw === "packing_received") return "packing-list-received";
  if (raw === "complete") return "complete";
  return "draft";
}

function productKeyForTimelineSku(sku: string, row?: DemandRow): TimelineProductKey | null {
  if (row?.category_code === "SC" || row?.category_code === "CC" || row?.category_code === "FM") {
    return row.category_code.toLowerCase() as TimelineProductKey;
  }
  const normalized = sku.toUpperCase();
  if (normalized.startsWith("CC-")) return "cc";
  if (normalized.startsWith("CA-FM-") || normalized.split("-").includes("FM")) return "fm";
  if (normalized.startsWith("CA-SC-") || normalized.startsWith("CL-SC-")) return "sc";
  return null;
}

function buildMonths(rangeStart: Date, totalDays: number): MonthSegment[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeEnd = addDays(rangeStart, totalDays - 1);
  const segments: MonthSegment[] = [];
  let ms = startOfMonth(rangeStart);

  while (ms <= rangeEnd) {
    const me = endOfMonth(ms);
    const visStart = ms < rangeStart ? rangeStart : ms;
    const visEnd = me > rangeEnd ? rangeEnd : me;
    const days = diffDays(visEnd, visStart) + 1;
    segments.push({
      label: fmtMonthYear(ms),
      widthPct: (days / totalDays) * 100,
      isCurrent: today >= ms && today <= me,
    });
    ms = addDays(me, 1);
  }

  return segments;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContainerTimelinePage() {
  const { pick } = useI18n();
  const [containers, setContainers] = useState<Container[]>([]);
  const [planningRowsBySku, setPlanningRowsBySku] = useState<Record<string, DemandRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Container | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [productFilter, setProductFilter] = useState<TimelineProductFilter>("all");

  // ── Filter state ──
  const [activeStatuses, setActiveStatuses] = useState<Set<ContainerStatus>>(
    () => new Set<ContainerStatus>(["packing-list-received", "final-list-sent", "draft"])
  );
  const [period, setPeriod] = useState<Period>("3M");

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(apiPath("/api/containers?includeDetails=true")).then((response) => response.json() as Promise<{
        success: boolean;
        data?: ContainerApiRow[];
        error?: string;
      }>),
      fetch(apiPath("/api/planning/dashboard?mode=link&includeDrafts=1&includeContainers=1")).then((response) => response.json() as Promise<{
        success: boolean;
        data?: DemandPlanningData;
        error?: string;
      }>),
    ])
      .then(([containerJson, planningJson]) => {
        if (cancelled) return;
        if (!containerJson.success) throw new Error(containerJson.error ?? "Failed to load containers");
        if (!planningJson.success || !planningJson.data) throw new Error(planningJson.error ?? "Failed to load planning data");
        setContainers(
          (containerJson.data ?? []).map((row) => ({
            id: String(row.id ?? ""),
            containerNumber: String(row.containerNumber ?? ""),
            etaDate: row.etaDate ? String(row.etaDate) : null,
            actualArrivalDate: row.actualArrivalDate ? String(row.actualArrivalDate) : null,
            status: normalizeStatus(String(row.status ?? "")),
            cbmCapacity: Number(row.cbmCapacity ?? 0),
            factoryName: row.factoryName ? String(row.factoryName) : null,
            origin: row.origin ? String(row.origin) : null,
            destWarehouse: row.destWarehouse ? String(row.destWarehouse) : null,
            note: row.note ? String(row.note) : null,
            itemCount: Number(row.itemCount ?? 0),
            totalQty: Number(row.totalQty ?? 0),
            totalCbm: Number(row.totalCbm ?? 0),
            items: (row.items ?? []).map((item) => ({
              id: String(item.id ?? ""),
              sku: String(item.sku ?? ""),
              qty: Number(item.qty ?? 0),
              cbm: Number(item.cbm ?? 0),
            })),
          }))
        );
        setPlanningRowsBySku(Object.fromEntries(planningJson.data.rows.map((row) => [row.sku, row])));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Timeline range (driven by period) ────────────────────────────────────
  const { rangeStart, rangeEnd, totalDays, months, todayPct } = useMemo(() => {
    let s: Date, e: Date;

    if (period === "3M") {
      s = startOfMonth(today);
      e = endOfMonth(addDays(today, 90));
    } else if (period === "6M") {
      s = startOfMonth(today);
      e = endOfMonth(addDays(today, 180));
    } else {
      // "all" — auto-fit to data
      const etaDates = containers.filter((c) => c.etaDate).map((c) => toDate(c.etaDate!));
      if (etaDates.length === 0) {
        s = startOfMonth(today);
        e = endOfMonth(addDays(today, 90));
      } else {
        const minEta = new Date(Math.min(...etaDates.map((d) => d.getTime())));
        const maxEta = new Date(Math.max(...etaDates.map((d) => d.getTime())));
        s = startOfMonth(addDays(minEta, -40));
        e = endOfMonth(addDays(maxEta, 30));
      }
    }

    const total = diffDays(e, s) + 1;
    return {
      rangeStart: s,
      rangeEnd: e,
      totalDays: total,
      months: buildMonths(s, total),
      todayPct: (diffDays(today, s) / total) * 100,
    };
  }, [containers, today, period]);

  const productKeysByContainer = useMemo(() => {
    const result = new Map<string, TimelineProductKey[]>();
    for (const container of containers) {
      const keys = new Set<TimelineProductKey>();
      for (const item of container.items) {
        const key = productKeyForTimelineSku(item.sku, planningRowsBySku[item.sku]);
        if (key) keys.add(key);
      }
      result.set(container.id, Array.from(keys));
    }
    return result;
  }, [containers, planningRowsBySku]);

  const productMatchedContainers = useMemo(() => {
    if (productFilter === "all") return containers;
    return containers.filter((container) => productKeysByContainer.get(container.id)?.includes(productFilter));
  }, [containers, productFilter, productKeysByContainer]);

  const searchMatchedContainers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return productMatchedContainers;
    return productMatchedContainers.filter((container) =>
      container.containerNumber.toLowerCase().includes(query) ||
      container.items.some((item) => item.sku.toLowerCase().includes(query))
    );
  }, [productMatchedContainers, searchQuery]);

  // ── Filtered + grouped containers ────────────────────────────────────────
  const grouped = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status,
      items: searchMatchedContainers.filter((c) => {
        if (!activeStatuses.has(c.status) || c.status !== status) return false;
        // For fixed periods, hide containers whose ETA is outside the range
        // (but keep containers with no ETA — they appear as "날짜 미정")
        if (period !== "all" && c.etaDate) {
          const eta = toDate(c.etaDate);
          if (eta < rangeStart || eta > rangeEnd) return false;
        }
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [searchMatchedContainers, activeStatuses, period, rangeStart, rangeEnd]);

  // ── Summary counts for filter pills ──────────────────────────────────────
  const countsByStatus = useMemo(() => {
    const counts: Partial<Record<ContainerStatus, number>> = {};
    for (const c of searchMatchedContainers) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [searchMatchedContainers]);

  function toggleStatus(status: ContainerStatus) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        // Keep at least one active
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  function barProps(c: Container): { left: number; width: number } | null {
    const etaStr =
      c.status === "complete" && c.actualArrivalDate ? c.actualArrivalDate : c.etaDate;
    if (!etaStr) return null;
    const etaDay = diffDays(toDate(etaStr), rangeStart);
    const transitDays = 30;
    const startDay = Math.max(0, etaDay - transitDays);
    return {
      left: (startDay / totalDays) * 100,
      width: ((etaDay - startDay) / totalDays) * 100,
    };
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        {pick("로딩 중...", "Loading...")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
    );
  }

  const todayVisible = todayPct >= 0 && todayPct <= 100;
  const totalVisible = grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className={`flex flex-col gap-4 transition-[margin] duration-200 ${selected ? "2xl:mr-[1120px]" : ""}`}>
        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <CalendarRange className="mt-1 h-5 w-5 shrink-0" />
            <div>
            <h1 className="text-lg font-bold text-[#1a1917]">{pick("컨테이너 일정", "Container Timeline")}</h1>
            <p className="text-sm text-muted-foreground">{pick("입고 예정 컨테이너 · ETA 기준 Gantt 뷰", "Inbound containers · Gantt view by ETA")}</p>
            </div>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-[280px] shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={pick("컨테이너 이름 또는 SKU 검색", "Search container or SKU")}
              aria-label={pick("컨테이너 이름 또는 SKU 검색", "Search container or SKU")}
              className="h-8 w-full rounded-lg border border-[#d8d6ce] bg-white pl-8 pr-8 text-[12px] outline-none transition-colors placeholder:text-stone-400 focus:border-[#1a5cdb] focus:ring-2 focus:ring-[#1a5cdb]/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label={pick("검색어 지우기", "Clear search")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <span className="w-px h-4 bg-[#d8d6ce]" />

          <span className="text-[11px] font-semibold text-muted-foreground">{pick("상품", "Product")}</span>
          <div className="flex rounded-lg border border-[#d8d6ce] bg-[#f0eee9] p-0.5">
            {PRODUCT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setProductFilter(option.value)}
                title={option.label}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  productFilter === option.value
                    ? "bg-white text-[#1a5cdb] shadow-sm ring-1 ring-inset ring-[#d8d6ce]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.value === "all" ? pick("전체", "All") : option.shortLabel}
              </button>
            ))}
          </div>

          <span className="w-px h-4 bg-[#d8d6ce]" />

          {/* Status pills */}
          <span className="text-[11px] font-semibold text-muted-foreground">{pick("상태", "Status")}</span>
          {STATUS_ORDER.map((status) => {
            const active = activeStatuses.has(status);
            const count = countsByStatus[status] ?? 0;
            return (
              <button
                key={status}
                onClick={() => toggleStatus(status)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  active
                    ? "border-transparent text-white shadow-sm"
                    : "bg-white border-[#d8d6ce] text-muted-foreground hover:border-stone-400"
                }`}
                style={active ? { background: STATUS_COLOR[status] } : undefined}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white/70" : ""}`}
                  style={!active ? { background: STATUS_COLOR[status] } : undefined}
                />
                {STATUS_LABEL[status]}
                <span
                  className={`text-[10px] font-bold rounded-full px-1 ${
                    active ? "bg-white/25 text-white" : "bg-stone-100 text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {/* Separator */}
          <span className="w-px h-4 bg-[#d8d6ce]" />

          {/* Period toggle */}
          <span className="text-[11px] font-semibold text-muted-foreground">{pick("기간", "Period")}</span>
          <div className="flex bg-[#f0eee9] border border-[#d8d6ce] rounded-lg p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  period === opt.value
                    ? "bg-white text-[#1a1917] shadow-sm ring-1 ring-inset ring-[#d8d6ce]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.value === "3M" ? pick("3개월", "3M") : opt.value === "6M" ? pick("6개월", "6M") : pick("전체", "All")}
              </button>
            ))}
          </div>

          {/* Result count */}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {pick(`${totalVisible}개 표시 중`, `${totalVisible} shown`)}
          </span>
        </div>

        {/* ── Gantt table ──────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e2dfd8] rounded-xl overflow-hidden shadow-sm">
          {/* Month header */}
          <div className="flex border-b border-[#e2dfd8] bg-[#f5f4f0]">
            <div className="w-[280px] shrink-0 border-r border-[#e2dfd8] px-4 py-2.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Container
              </span>
              <span className="text-[10px] text-stone-300">{pick("ETA 기준 ↑", "By ETA ↑")}</span>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <div className="flex">
                {months.map((m, i) => (
                  <div
                    key={i}
                    style={{ width: `${m.widthPct}%` }}
                    className={`shrink-0 py-2.5 text-center text-[11px] font-semibold border-r border-[#e8e6e1] last:border-r-0 ${
                      m.isCurrent ? "text-[#1a5cdb]" : "text-stone-500"
                    }`}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {todayVisible && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${todayPct}%` }}
                >
                  <div className="w-px h-full bg-red-400 opacity-50" />
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          {grouped.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground text-sm">
              <div>{pick("표시할 컨테이너가 없습니다", "No containers to display")}</div>
              <div className="text-[11px] mt-1 text-stone-300">
                {pick("필터를 변경하거나 기간을 늘려보세요", "Try changing the filters or extending the period")}
              </div>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.status}>
                {/* Group label */}
                <div className="flex border-b border-[#f0ede8] bg-[#fafaf7]">
                  <div className="w-[280px] shrink-0 border-r border-[#e2dfd8] px-4 py-1.5 flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: STATUS_COLOR[group.status] }}
                    />
                    <span className="text-[11px] font-semibold text-stone-500">
                      {STATUS_LABEL_FULL[group.status]}
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-stone-400 bg-stone-200 rounded-full px-2 py-px">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="flex-1" />
                </div>

                {/* Container rows */}
                {group.items.map((c) => {
                  const bar = barProps(c);
                  const isSelected = selected?.id === c.id;
                  const containerProductKeys = productKeysByContainer.get(c.id) ?? [];
                  const isDraft = c.status === "draft";
                  const cbmPct =
                    c.cbmCapacity > 0
                      ? Math.round((c.totalCbm / c.cbmCapacity) * 100)
                      : 0;
                  const displayDate =
                    c.status === "complete" && c.actualArrivalDate
                      ? c.actualArrivalDate
                      : c.etaDate;

                  return (
                    <div
                      key={c.id}
                      className={`flex border-b border-[#f0ede8] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f0eee9] ${
                        isSelected ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]/40" : ""
                      }`}
                      onClick={() => setSelected(isSelected ? null : c)}
                    >
                      {/* Sidebar */}
                      <div
                        className={`border-r border-[#e2dfd8] px-4 py-2.5 flex flex-col gap-0.5 justify-center ${
                          isSelected ? "w-[276px] shrink-0" : "w-[280px] shrink-0"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                            style={{
                              backgroundColor: STATUS_COLOR[c.status],
                              boxShadow: `0 0 0 3px ${STATUS_COLOR[c.status]}30`,
                            }}
                          />
                          <span className="font-mono text-[12px] font-bold text-[#1a1917] truncate">
                            {c.containerNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap pl-4">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-px rounded-md ${STATUS_PILL[c.status]}`}
                          >
                            {STATUS_LABEL_FULL[c.status]}
                          </span>
                          {containerProductKeys.map((key) => (
                            <span
                              key={key}
                              className={`rounded px-1.5 py-px text-[9px] font-bold ${PRODUCT_BADGE[key]}`}
                            >
                              {key.toUpperCase()}
                            </span>
                          ))}
                          {c.destWarehouse && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                              {c.destWarehouse}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground pl-4">
                          ETA {displayDate ?? "—"} · {c.itemCount} SKUs · {c.totalQty.toLocaleString()} units
                        </div>
                      </div>

                      {/* Timeline */}
                      <div className="flex-1 relative py-3 min-h-[62px]">
                        {/* Month grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {months.map((m, i) => (
                            <div
                              key={i}
                              style={{ width: `${m.widthPct}%` }}
                              className={`shrink-0 border-r border-[#f0ede8] last:border-r-0 ${
                                m.isCurrent ? "bg-blue-50/20" : ""
                              }`}
                            />
                          ))}
                        </div>

                        {/* Today line */}
                        {todayVisible && (
                          <div
                            className="absolute top-0 bottom-0 pointer-events-none"
                            style={{ left: `${todayPct}%` }}
                          >
                            <div className="w-px h-full bg-red-400 opacity-30" />
                          </div>
                        )}

                        {/* Gantt bar */}
                        {bar ? (
                          <div
                            className="absolute top-3 bottom-3 rounded-md flex items-center overflow-hidden shadow-sm"
                            style={{
                              left: `${bar.left}%`,
                              width: `${bar.width}%`,
                              minWidth: 56,
                              background: STATUS_COLOR[c.status],
                              opacity: isDraft ? 0.8 : 1,
                              ...(isDraft
                                ? { border: "2px dashed rgba(255,255,255,0.45)" }
                                : {}),
                            }}
                          >
                            <div className="flex items-center gap-1.5 px-2.5 overflow-hidden w-full">
                              <span
                                className="text-[11px] font-bold text-white truncate flex-1"
                                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
                              >
                                {c.containerNumber}
                              </span>
                              {displayDate && (
                                <span className="text-[10px] text-white/80 shrink-0">
                                  {fmtDate(toDate(displayDate))}
                                </span>
                              )}
                              {c.cbmCapacity > 0 && (
                                <span className="text-[10px] font-semibold text-white/90 shrink-0 bg-black/15 rounded px-1 py-px">
                                  {cbmPct}%
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-y-3 left-3 flex items-center">
                            <span className="text-[11px] text-stone-300 italic">{pick("날짜 미정", "No date set")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ background: STATUS_COLOR[s as ContainerStatus], opacity: s === "draft" ? 0.8 : 1 }}
              />
              {STATUS_LABEL_FULL[s as ContainerStatus]}
              {s === "draft" && pick(" (점선)", " (dashed)")}
            </div>
          ))}
          <span className="w-px h-3.5 bg-[#d8d6ce]" />
          <div className="flex items-center gap-1.5">
            <div className="w-px h-4 bg-red-400 opacity-60" />
            {pick("오늘", "Today")}
          </div>
          <span className="ml-auto text-[10px] text-stone-300">
            {pick("※ 바 너비 = 30일 Transit 기간 (발주일 컬럼 추가 시 실제 기간으로 전환 가능)", "※ Bar width = 30-day transit period (can switch to actual period when order date column is added)")}
          </span>
        </div>
      </div>

      {/* ── Right overlay drawer ──────────────────────────────────────────────── */}
      {selected && (
        <ContainerDetailDrawer
          key={selected.id}
          container={selected}
          planningRowsBySku={planningRowsBySku}
          skuSearchQuery={searchQuery}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ContainerDetailDrawer({
  container: c,
  planningRowsBySku,
  skuSearchQuery,
  onClose,
}: {
  container: Container;
  planningRowsBySku: Record<string, DemandRow>;
  skuSearchQuery: string;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const normalizedSkuSearch = skuSearchQuery.trim().toLowerCase();
  const [isSkuListOpen, setIsSkuListOpen] = useState(true);
  const [localSkuFilter, setLocalSkuFilter] = useState("");
  const highlightedSkuRowRef = useRef<HTMLTableRowElement | null>(null);
  const [skuSort, setSkuSort] = useState<{ key: SkuImpactSortKey; direction: SortDirection }>({
    key: "sku",
    direction: "asc",
  });
  const totalCbm = c.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const totalQty = c.items.reduce((sum, item) => sum + item.qty, 0);
  const cbmUsedPct = c.cbmCapacity > 0 ? Math.min(100, (totalCbm / c.cbmCapacity) * 100) : 0;
  const detailProductKeys = Array.from(new Set(
    c.items
      .map((item) => productKeyForTimelineSku(item.sku, planningRowsBySku[item.sku]))
      .filter((key): key is TimelineProductKey => key !== null),
  ));
  const skuImpacts = c.items.map((item) => buildSkuImpact(item, c.containerNumber, c.etaDate, planningRowsBySku[item.sku]));
  const sortedSkuImpacts = [...skuImpacts].sort((left, right) => {
    const riskRank: Record<SkuImpactLevel, number> = { critical: 0, warning: 1, ok: 2, unknown: 3 };
    const values: Record<SkuImpactSortKey, [string | number | null, string | number | null]> = {
      sku: [left.item.sku, right.item.sku],
      level: [riskRank[left.level], riskRank[right.level]],
      stock: [left.currentStock, right.currentStock],
      sales: [left.averageDailySales, right.averageDailySales],
      sod: [left.estimatedSod, right.estimatedSod],
      stockout: [left.stockoutBeforeEta === null ? null : Number(left.stockoutBeforeEta), right.stockoutBeforeEta === null ? null : Number(right.stockoutBeforeEta)],
      etaImpact: [
        left.backorderAtEta === null && left.projectedStockAtEta === null ? null : (left.projectedStockAtEta ?? 0) - (left.backorderAtEta ?? 0),
        right.backorderAtEta === null && right.projectedStockAtEta === null ? null : (right.projectedStockAtEta ?? 0) - (right.backorderAtEta ?? 0),
      ],
      quantity: [left.requiredQty, right.requiredQty],
      totalInbound: [left.totalInboundQty, right.totalInboundQty],
      postSod: [left.postInboundSod, right.postInboundSod],
      cbm: [left.item.qty * left.item.cbm, right.item.qty * right.item.cbm],
    };
    const [leftValue, rightValue] = values[skuSort.key];
    if (leftValue === null) return rightValue === null ? 0 : 1;
    if (rightValue === null) return -1;
    const result = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    return skuSort.direction === "asc" ? result : -result;
  });
  const filteredSkuImpacts = localSkuFilter.trim()
    ? sortedSkuImpacts.filter(({ item }) =>
        item.sku.toLowerCase().includes(localSkuFilter.trim().toLowerCase())
      )
    : sortedSkuImpacts;
  const criticalCount = skuImpacts.filter((impact) => impact.level === "critical").length;
  const warningCount = skuImpacts.filter((impact) => impact.level === "warning").length;
  const firstHighlightedIndex = normalizedSkuSearch
    ? sortedSkuImpacts.findIndex(({ item }) => item.sku.toLowerCase().includes(normalizedSkuSearch))
    : -1;

  useEffect(() => {
    if (!isSkuListOpen || firstHighlightedIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      highlightedSkuRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstHighlightedIndex, isSkuListOpen]);

  function toggleSkuSort(key: SkuImpactSortKey) {
    setSkuSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function sortHeader(label: string, key: SkuImpactSortKey, align: "left" | "center" | "right") {
    const active = skuSort.key === key;
    return (
      <button
        type="button"
        onClick={() => toggleSkuSort(key)}
        className={`flex w-full items-center gap-1 ${
          align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"
        }`}
      >
        <span>{label}</span>
        <span className={active ? "text-[#1a5cdb]" : "text-stone-400"}>
          {active ? (skuSort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    );
  }

  const displayDate =
    c.status === "complete" && c.actualArrivalDate ? c.actualArrivalDate : c.etaDate;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/15 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 w-[min(1120px,calc(100vw-24px))] z-40 bg-white border-l border-[#e2dfd8] shadow-2xl flex flex-col overflow-hidden"
        style={{
          top: "var(--app-header-height, 56px)",
          height: "calc(100% - var(--app-header-height, 56px))",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#e2dfd8] bg-white shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-[#1a1917]">
                {c.containerNumber}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_PILL[c.status]}`}
              >
                {STATUS_LABEL_FULL[c.status]}
              </span>
              {detailProductKeys.map((key) => (
                <span key={key} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRODUCT_BADGE[key]}`}>
                  {key.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            <Link
              href={`/planning/container-planning?containerId=${c.id}`}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1a5cdb]/30 px-3 py-1.5 text-[11px] font-semibold text-[#1a5cdb] transition-colors hover:bg-[#ebf0fd] hover:text-[#1650c4]"
            >
              {pick("Container Planning에서 열기", "Open in Container Planning")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-[#cccac4] bg-white text-muted-foreground transition-colors hover:bg-[#f0eee9] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Meta info */}
          <div className="shrink-0 px-6 py-4 space-y-3 border-b border-[#e2dfd8]">
            <div className="grid grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.4fr)_minmax(100px,0.7fr)] items-center gap-x-6 text-[12px]">
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                <span className="font-semibold text-muted-foreground">
                  {c.status === "complete" ? pick("실제 입고", "Actual Arrival") : "ETA"}:
                </span>
                <span className="font-semibold">{displayDate ?? "—"}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                <span className="font-semibold text-muted-foreground">{pick("공장", "Factory")}:</span>
                <span className="truncate font-semibold">{c.factoryName ?? "—"}</span>
              </div>
              <div className="flex min-w-0 items-center justify-self-end gap-2 whitespace-nowrap text-right">
                <span className="font-semibold text-muted-foreground">{pick("창고", "Warehouse")}:</span>
                <span className="truncate font-semibold">{c.destWarehouse ?? "—"}</span>
              </div>
            </div>

            {(c.actualArrivalDate && c.status !== "complete" || c.origin) && (
              <div className="flex items-center gap-6 text-[11px]">
                {c.actualArrivalDate && c.status !== "complete" && (
                  <span><span className="text-muted-foreground">{pick("실제 입고", "Actual Arrival")}:</span> <strong className="text-[#22a666]">{c.actualArrivalDate}</strong></span>
                )}
                {c.origin && (
                  <span><span className="text-muted-foreground">Origin:</span> <strong>{c.origin}</strong></span>
                )}
              </div>
            )}

            {/* CBM bar */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-muted-foreground">{pick("CBM 적재율", "CBM Load Rate")}</span>
                <span className="font-semibold">
                  {totalCbm.toFixed(1)} / {c.cbmCapacity} m³
                  <span className="ml-1.5 text-muted-foreground">({Math.round(cbmUsedPct)}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#f0eee9] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${cbmUsedPct}%`, background: STATUS_COLOR[c.status] }}
                />
              </div>
            </div>

            {c.note && (
              <div className="text-[11px] text-muted-foreground bg-[#f5f4f0] rounded-lg px-3 py-2.5 leading-relaxed border border-[#e2dfd8]">
                {c.note}
              </div>
            )}
          </div>

          {/* SKU table */}
          <div className="flex min-h-0 flex-1 flex-col border-b border-[#e2dfd8]">
            <button
              type="button"
              onClick={() => setIsSkuListOpen((current) => !current)}
              className="flex shrink-0 cursor-pointer items-center justify-between gap-3 px-6 py-4 text-left hover:bg-[#fafaf7] transition-colors"
            >
              <span className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isSkuListOpen ? "rotate-180" : ""}`}
                />
                {pick("SKU 목록", "SKU List")}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {criticalCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                    Critical {criticalCount}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                    Warning {warningCount}
                  </span>
                )}
                <span>{c.items.length} SKUs · {totalQty.toLocaleString()} units</span>
              </span>
            </button>

            {isSkuListOpen && (
            <div className="min-h-0 flex-1 px-6 pb-4">
              <div className="pb-3">
                <input
                  type="text"
                  value={localSkuFilter}
                  onChange={(e) => setLocalSkuFilter(e.target.value)}
                  placeholder={pick("SKU 검색...", "Search SKU...")}
                  className="w-full rounded-md border border-[#e2dfd8] bg-[#fafaf7] px-3 py-1.5 text-[12px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
                />
              </div>
              {c.items.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-muted-foreground border border-dashed border-[#d8d6ce] rounded-lg">
                  {pick("등록된 SKU가 없습니다", "No SKUs registered")}
                </div>
              ) : (
                <div className="h-full overflow-x-auto overflow-y-scroll rounded-lg border border-[#e2dfd8]">
                  <table className="w-full table-fixed text-[11px]">
                    <colgroup>
                      <col className="w-[18%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[9%]" />
                      <col className="w-[7%]" />
                      <col className="w-[8%]" />
                      <col className="w-[10%]" />
                      <col className="w-[7%]" />
                      <col className="w-[10%]" />
                      <col className="w-[7%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-[#f5f4f0] shadow-[0_1px_0_#e2dfd8]">
                      <tr className="bg-[#f5f4f0] border-b border-[#e2dfd8]">
                        <th className="px-3 py-2 font-semibold text-muted-foreground">{sortHeader("Master SKU", "sku", "left")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("위험도", "Risk"), "level", "center")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("현재 재고", "Current Stock"), "stock", "right")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("평균 판매/일", "Avg Sales/Day"), "sales", "right")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("현재 SOD", "Current SOD"), "sod", "center")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("ETA 전 품절", "Stockout Before ETA"), "stockout", "center")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("ETA 재고 / BO", "ETA Stock / BO"), "etaImpact", "right")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("추가 추천", "Rec. Add"), "quantity", "right")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("해당 / 전체 입고", "This / Total Inbound"), "totalInbound", "right")}</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">{sortHeader(pick("입고 후 SOD", "Post-Inbound SOD"), "postSod", "center")}</th>
                        <th className="px-3 py-2 font-semibold text-muted-foreground">{sortHeader("CBM", "cbm", "right")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkuImpacts.length === 0 && (
                        <tr>
                          <td colSpan={11} className="py-8 text-center text-[12px] text-muted-foreground">
                            {pick("검색 결과가 없습니다", "No results found")}
                          </td>
                        </tr>
                      )}
                      {filteredSkuImpacts.map(({
                        item,
                        level,
                        currentStock,
                        averageDailySales,
                        estimatedSod,
                        stockoutBeforeEta,
                        projectedStockAtEta,
                        backorderAtEta,
                        requiredQty,
                        totalInboundQty,
                        postInboundSod,
                      }, i) => {
                        const isHighlighted = Boolean(
                          normalizedSkuSearch && item.sku.toLowerCase().includes(normalizedSkuSearch),
                        );
                        return (
                        <tr
                          key={item.id || i}
                          ref={i === firstHighlightedIndex ? highlightedSkuRowRef : undefined}
                          onDoubleClick={() => {
                            window.open(
                              withBasePath(`/planning/sku-forecasts?sku=${encodeURIComponent(item.sku)}&tab=inventory&includeDrafts=1&highlightContainerId=${encodeURIComponent(c.id)}&highlightContainer=${encodeURIComponent(c.containerNumber)}`),
                              "_blank",
                              "noopener,noreferrer",
                            );
                          }}
                          title={pick("더블클릭하여 SKU Planning에서 열기", "Double-click to open in SKU Planning")}
                          className={`cursor-pointer border-b border-[#f0ede8] last:border-b-0 transition-colors ${
                            isHighlighted ? "bg-blue-100 outline outline-2 -outline-offset-2 outline-[#1a5cdb] hover:bg-blue-100" :
                            level === "critical" ? "bg-red-50/70 hover:bg-red-50" :
                            level === "warning" ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-[#fafaf7]"
                          }`}
                        >
                          <td className={`px-3 py-2 font-mono font-semibold truncate ${isHighlighted ? "text-[#1238a0]" : "text-[#1a1917]"}`}>{item.sku}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              level === "critical" ? "bg-red-100 text-red-700" :
                              level === "warning" ? "bg-amber-100 text-amber-700" :
                              level === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"
                            }`}>
                              {level === "critical" ? "Critical" : level === "warning" ? "Warning" : level === "ok" ? "OK" : "—"}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{currentStock?.toLocaleString() ?? "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{averageDailySales?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</td>
                          <td className="px-2 py-2 text-center tabular-nums">{estimatedSod ?? "—"}</td>
                          <td className={`px-2 py-2 text-center font-semibold ${stockoutBeforeEta ? "text-red-700" : "text-emerald-700"}`}>
                            {stockoutBeforeEta === null ? "—" : stockoutBeforeEta ? pick("예", "Yes") : pick("아니오", "No")}
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${(backorderAtEta ?? 0) > 0 ? "text-red-700" : ""}`}>
                            {projectedStockAtEta?.toLocaleString() ?? "—"} / {backorderAtEta?.toLocaleString() ?? "—"}
                          </td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${(requiredQty ?? 0) > 0 ? "text-amber-700" : ""}`}>
                            {requiredQty?.toLocaleString() ?? "—"}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">
                            {item.qty.toLocaleString()} / {totalInboundQty?.toLocaleString() ?? "—"}
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums">{postInboundSod ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{(item.qty * item.cbm).toFixed(2)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[#e2dfd8] bg-[#f5f4f0]">
                        <td className="px-3 py-2 font-semibold text-muted-foreground">Total ({c.items.length} SKUs)</td>
                        <td colSpan={7} />
                        <td className="px-2 py-2 text-right tabular-nums font-bold">{pick("입고", "Inbound")} {totalQty.toLocaleString()} units</td>
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums font-bold">{totalCbm.toFixed(2)} m³</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
