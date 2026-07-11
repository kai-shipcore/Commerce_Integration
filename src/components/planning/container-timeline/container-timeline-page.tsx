"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileDown, History, List, Plus, Search, X } from "lucide-react";
import { ContainerHistoryTab } from "./container-history-tab";
import * as XLSX from "xlsx";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath, withBasePath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import type { DemandPlanningData, DemandRow } from "@/types/demand-planning";
import { getUrgency, recommendedContainerQty } from "@/components/planning/sku-forecasts/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type ContainerStatus = "draft" | "final-list-sent" | "packing-list-received" | "complete";
type Period = "3M" | "6M" | "all" | "monthly" | "schedule";
type TimelineProductKey = "sc" | "cc" | "fm";
type TimelineProductFilter = "all" | TimelineProductKey | "empty";

interface ContainerItem {
  id: string;
  sku: string;
  qty: number;
  cbm: number;
  categoryCode: string | null;
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
  estLoadingDate: string | null;
  etdNgbDate: string | null;
  etaLaxLgbDate: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
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
  categoryCode?: unknown;
}

interface ContainerApiRow {
  id?: unknown;
  containerNumber?: unknown;
  etaDate?: unknown;
  actualArrivalDate?: unknown;
  estLoadingDate?: unknown;
  etdNgbDate?: unknown;
  etaLaxLgbDate?: unknown;
  confirmedDate?: unknown;
  confirmedTime?: unknown;
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

const TIMELINE_CACHE_KEY = "container-timeline:data:v2";
const TIMELINE_CACHE_TTL_MS = 60_000;
const TIMELINE_VIEW_PREFS_KEY = "container-timeline:view-preferences";
let timelineMemoryCache: { containers: Container[]; cachedAt: number } | null = null;
const planningRowsCache = new Map<string, Record<string, DemandRow>>();
const planningRowsRequests = new Map<string, Promise<Record<string, DemandRow>>>();

function mapTimelineContainers(rows: ContainerApiRow[]): Container[] {
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    containerNumber: String(row.containerNumber ?? ""),
    etaDate: row.etaDate ? String(row.etaDate) : null,
    actualArrivalDate: row.actualArrivalDate ? String(row.actualArrivalDate) : null,
    estLoadingDate: row.estLoadingDate ? String(row.estLoadingDate) : null,
    etdNgbDate: row.etdNgbDate ? String(row.etdNgbDate) : null,
    etaLaxLgbDate: row.etaLaxLgbDate ? String(row.etaLaxLgbDate) : null,
    confirmedDate: row.confirmedDate ? String(row.confirmedDate) : null,
    confirmedTime: row.confirmedTime ? String(row.confirmedTime) : null,
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
      categoryCode: item.categoryCode ? String(item.categoryCode).toUpperCase() : null,
    })),
  }));
}

function getCachedTimelineContainers(): Container[] | null {
  if (timelineMemoryCache) return timelineMemoryCache.containers;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TIMELINE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { containers?: Container[]; cachedAt?: number };
    if (!Array.isArray(parsed.containers) || typeof parsed.cachedAt !== "number") return null;
    timelineMemoryCache = { containers: parsed.containers, cachedAt: parsed.cachedAt };
    return parsed.containers;
  } catch {
    return null;
  }
}

function setCachedTimelineContainers(containers: Container[]) {
  timelineMemoryCache = { containers, cachedAt: Date.now() };
  try {
    window.sessionStorage.setItem(TIMELINE_CACHE_KEY, JSON.stringify(timelineMemoryCache));
  } catch {
    // Memory cache still provides fast client-side revisits.
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_ORDER: ContainerStatus[] = [
  "packing-list-received",
  "final-list-sent",
  "draft",
  "complete",
];

const STATUS_LABEL: Record<ContainerStatus, string> = {
  "packing-list-received": "Shipped",
  "final-list-sent": "Final",
  draft: "Draft",
  complete: "Complete",
};

const STATUS_LABEL_FULL: Record<ContainerStatus, string> = {
  "packing-list-received": "Shipped",
  "final-list-sent": "Final List",
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

const PERIOD_OPTIONS: { value: Period; label: string; labelEn: string; days: number | null }[] = [
  { value: "3M",      label: "3개월",    labelEn: "3 Months",    days: 90 },
  { value: "6M",      label: "6개월",    labelEn: "6 Months",    days: 180 },
  { value: "all",     label: "전체",     labelEn: "All",          days: null },
  { value: "monthly", label: "월별 보기", labelEn: "Month View",  days: null },
  { value: "schedule", label: "스케줄 보기", labelEn: "Schedule View", days: null },
];

function isTimelinePeriod(value: unknown): value is Period {
  return value === "3M" || value === "6M" || value === "all" || value === "monthly" || value === "schedule";
}

function isTimelineViewMode(value: unknown): value is "compact" | "detailed" {
  return value === "compact" || value === "detailed";
}

const PRODUCT_OPTIONS: { value: TimelineProductFilter; label: string; shortLabel: string }[] = [
  { value: "all", label: "전체", shortLabel: "ALL" },
  { value: "sc", label: "Seat Cover", shortLabel: "SC" },
  { value: "cc", label: "Car Cover", shortLabel: "CC" },
  { value: "fm", label: "Floor Mat", shortLabel: "FM" },
  { value: "empty", label: "SKU없음", shortLabel: "SKU없음" },
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

function containerScheduleDate(container: Container): string | null {
  if (container.confirmedDate) return container.confirmedDate;
  if (container.etaLaxLgbDate) return container.etaLaxLgbDate;
  return container.etaDate;
}

function formatTime12h(time: string | null): string | null {
  if (!time) return null;
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr ?? "", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return null;
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

function confirmedChipLabel(c: Container, pick: (ko: string, en: string) => string): string {
  if (!c.confirmedDate) return c.containerNumber;
  const timeLabel = formatTime12h(c.confirmedTime);
  const suffix = `(${pick("확정", "Confirmed")}${timeLabel ? ` - ${timeLabel}` : ""})`;
  return c.destWarehouse ? `${c.containerNumber}${suffix} ${c.destWarehouse}` : `${c.containerNumber}${suffix}`;
}

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

function productKeyForTimelineSku(item: ContainerItem, row?: DemandRow): TimelineProductKey | null {
  if (item.categoryCode === "SC" || item.categoryCode === "CC" || item.categoryCode === "FM") {
    return item.categoryCode.toLowerCase() as TimelineProductKey;
  }
  if (row?.category_code === "SC" || row?.category_code === "CC" || row?.category_code === "FM") {
    return row.category_code.toLowerCase() as TimelineProductKey;
  }
  const normalized = item.sku.toUpperCase();
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
  const { can, ready: permissionsReady } = usePermissions();
  const searchParams = useSearchParams();
  const initialContainerName = searchParams.get("container");
  const didAutoSelect = useRef(false);
  const prefSaveTimerRef = useRef<number | null>(null);

  const [containers, setContainers] = useState<Container[]>(() => timelineMemoryCache?.containers ?? []);
  const [planningRowsBySku, setPlanningRowsBySku] = useState<Record<string, DemandRow>>({});
  const [loading, setLoading] = useState(() => !timelineMemoryCache);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Container | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [productFilter, setProductFilter] = useState<TimelineProductFilter>(() => {
    const p = searchParams.get("product");
    if (p === "sc" || p === "cc" || p === "fm" || p === "empty") return p;
    return "all";
  });

  // ── Filter state ──
  const [activeStatuses, setActiveStatuses] = useState<Set<ContainerStatus>>(() => {
    const s = searchParams.get("status");
    if (s) {
      const valid: ContainerStatus[] = ["packing-list-received", "final-list-sent", "draft", "complete"];
      const parsed = s.split(",").filter((v): v is ContainerStatus => valid.includes(v as ContainerStatus));
      if (parsed.length > 0) return new Set(parsed);
    }
    return new Set<ContainerStatus>(["packing-list-received", "final-list-sent", "draft"]);
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ContainerStatus>>(() => new Set());
  const [period, setPeriod] = useState<Period>(() => {
    if (typeof window === "undefined") return "3M";
    const saved = localStorage.getItem("container-timeline:period");
    if (isTimelinePeriod(saved)) return saved;
    return "3M";
  });
  const [periodOpen, setPeriodOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [viewMode, setViewMode] = useState<"compact" | "detailed">(() => {
    if (typeof window === "undefined") return "compact";
    const saved = localStorage.getItem("container-timeline:viewMode");
    return isTimelineViewMode(saved) ? saved : "compact";
  });
  const [dbPrefsLoaded, setDbPrefsLoaded] = useState(false);
  const canEditTimeline = permissionsReady && can("container-timeline", "edit");

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath("/api/user/preferences"), { cache: "no-store" })
      .then((response) => response.json() as Promise<{ success: boolean; data?: Record<string, unknown> }>)
      .then((json) => {
        if (cancelled || !json.success || !json.data) return;
        const saved = json.data[TIMELINE_VIEW_PREFS_KEY];
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
        const prefs = saved as Record<string, unknown>;
        if (isTimelinePeriod(prefs.period)) {
          setPeriod(prefs.period);
          window.localStorage.setItem("container-timeline:period", prefs.period);
          if (prefs.period === "monthly" || prefs.period === "schedule") {
            const d = new Date();
            setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
          }
        }
        if (isTimelineViewMode(prefs.viewMode)) {
          setViewMode(prefs.viewMode);
          window.localStorage.setItem("container-timeline:viewMode", prefs.viewMode);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDbPrefsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pick]);

  useEffect(() => {
    if (!dbPrefsLoaded) return;
    window.localStorage.setItem("container-timeline:period", period);
    window.localStorage.setItem("container-timeline:viewMode", viewMode);
    if (prefSaveTimerRef.current !== null) window.clearTimeout(prefSaveTimerRef.current);
    prefSaveTimerRef.current = window.setTimeout(() => {
      prefSaveTimerRef.current = null;
      fetch(apiPath("/api/user/preferences"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: {
            [TIMELINE_VIEW_PREFS_KEY]: { period, viewMode },
          },
        }),
      }).catch(() => {});
    }, 800);
  }, [dbPrefsLoaded, period, viewMode]);

  useEffect(() => () => {
    if (prefSaveTimerRef.current !== null) window.clearTimeout(prefSaveTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedContainers = getCachedTimelineContainers();
    if (cachedContainers) {
      queueMicrotask(() => {
        if (!cancelled) {
          setContainers(cachedContainers);
          setLoading(false);
        }
      });
    }

    const cacheIsFresh = timelineMemoryCache
      ? Date.now() - timelineMemoryCache.cachedAt < TIMELINE_CACHE_TTL_MS
      : false;
    if (cacheIsFresh) {
      return () => {
        cancelled = true;
      };
    }

    fetch(apiPath("/api/containers?includeDetails=true&view=timeline"), { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        success: boolean;
        data?: ContainerApiRow[];
        error?: string;
      }>)
      .then((containerJson) => {
        if (cancelled) return;
        if (!containerJson.success) throw new Error(containerJson.error ?? pick("컨테이너를 불러오지 못했습니다.", "Failed to load containers"));
        const nextContainers = mapTimelineContainers(containerJson.data ?? []);
        setContainers(nextContainers);
        setCachedTimelineContainers(nextContainers);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : pick("알 수 없는 오류가 발생했습니다.", "Unknown error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pick]);

  // Auto-select container from ?container=NAME URL param
  useEffect(() => {
    if (didAutoSelect.current || !initialContainerName || containers.length === 0) return;
    const match = containers.find(
      (c) => c.containerNumber.toLowerCase() === initialContainerName.toLowerCase()
    );
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(match);
      didAutoSelect.current = true;
    }
  }, [containers, initialContainerName]);

  const selectedPlanningScope = useMemo(() => {
    if (!selected) return null;
    const categories = new Set(
      selected.items
        .map((item) => item.categoryCode)
        .filter((category): category is string => category === "SC" || category === "CC" || category === "FM"),
    );
    return categories.size === 1 ? Array.from(categories)[0] : "all";
  }, [selected]);

  useEffect(() => {
    if (!selectedPlanningScope) return;
    let cancelled = false;
    const cachedRows = planningRowsCache.get(selectedPlanningScope);
    if (cachedRows) {
      queueMicrotask(() => {
        if (!cancelled) {
          setPlanningRowsBySku(cachedRows);
          setPlanningLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setPlanningRowsBySku({});
        setPlanningLoading(true);
      }
    });
    const productParam = selectedPlanningScope === "all" ? "" : `&product=${selectedPlanningScope}`;
    let request = planningRowsRequests.get(selectedPlanningScope);
    if (!request) {
      request = fetch(
        apiPath(`/api/planning/dashboard?mode=link&includeDrafts=1&includeContainers=1${productParam}`),
      )
        .then((response) => response.json() as Promise<{
          success: boolean;
          data?: DemandPlanningData;
          error?: string;
        }>)
        .then((planningJson) => {
          if (!planningJson.success || !planningJson.data) {
            throw new Error(planningJson.error ?? pick("계획 데이터를 불러오지 못했습니다.", "Failed to load planning data"));
          }
          const rows = Object.fromEntries(planningJson.data.rows.map((row) => [row.sku, row]));
          planningRowsCache.set(selectedPlanningScope, rows);
          return rows;
        })
        .finally(() => planningRowsRequests.delete(selectedPlanningScope));
      planningRowsRequests.set(selectedPlanningScope, request);
    }

    request
      .then((rows) => {
        if (!cancelled) setPlanningRowsBySku(rows);
      })
      .catch(() => {
        if (!cancelled) setPlanningRowsBySku({});
      })
      .finally(() => {
        if (!cancelled) setPlanningLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pick, selectedPlanningScope]);

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
      const etaDates = containers.map((c) => containerScheduleDate(c)).filter((d): d is string => Boolean(d)).map((d) => toDate(d));
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
        const key = productKeyForTimelineSku(item, planningRowsBySku[item.sku]);
        if (key) keys.add(key);
      }
      result.set(container.id, Array.from(keys));
    }
    return result;
  }, [containers, planningRowsBySku]);

  const productMatchedContainers = useMemo(() => {
    if (productFilter === "all") return containers;
    if (productFilter === "empty") return containers.filter((c) => c.items.length === 0);
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
        // For fixed periods, hide containers whose scheduled date is outside the range
        // (but keep containers with no date — they appear as "날짜 미정")
        const scheduleDate = containerScheduleDate(c);
        if (period !== "all" && scheduleDate) {
          const eta = toDate(scheduleDate);
          if (eta < rangeStart || eta > rangeEnd) return false;
        }
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [searchMatchedContainers, activeStatuses, period, rangeStart, rangeEnd]);

  // ── Container count per month (for timeline header) ─────────────────────
  const countByMonth = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of grouped) {
      for (const c of group.items) {
        const scheduleDate = containerScheduleDate(c);
        if (!scheduleDate) continue;
        const eta = toDate(scheduleDate);
        const key = fmtMonthYear(new Date(eta.getFullYear(), eta.getMonth(), 1));
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [grouped]);

  const scheduleVisibleCount = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    return searchMatchedContainers.filter((container) => {
      if (!activeStatuses.has(container.status)) return false;
      const dateStr = containerScheduleDate(container);
      if (!dateStr) return false;
      const date = toDate(dateStr);
      return date.getFullYear() === year && date.getMonth() === month;
    }).length;
  }, [activeStatuses, calendarMonth, searchMatchedContainers]);

  // ── Summary counts for filter pills ──────────────────────────────────────
  const countsByStatus = useMemo(() => {
    const counts: Partial<Record<ContainerStatus, number>> = {};
    for (const c of searchMatchedContainers) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [searchMatchedContainers]);

  function toggleGroup(status: ContainerStatus) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

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

  const listHref = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    params.set("product", productFilter);
    const statusStr = [...activeStatuses].join(",");
    if (statusStr) params.set("status", statusStr);
    const qs = params.toString();
    return `/planning/container-planning${qs ? `?${qs}` : ""}`;
  }, [searchQuery, productFilter, activeStatuses]);

  async function moveContainerToDate(containerId: string, newDate: string) {
    if (!canEditTimeline) {
      toast.error(pick("컨테이너 타임라인 수정 권한이 없습니다.", "Container Timeline edit access is required."));
      return;
    }
    const container = containers.find((c) => c.id === containerId);
    if (!container) return;
    if (containerScheduleDate(container) === newDate) return;

    const isConfirmed = Boolean(container.confirmedDate);
    const previous = containers;
    const optimistic = containers.map((c) => {
      if (c.id !== containerId) return c;
      return isConfirmed ? { ...c, confirmedDate: newDate } : { ...c, etaLaxLgbDate: newDate };
    });
    setContainers(optimistic);
    setCachedTimelineContainers(optimistic);

    const queryParam = isConfirmed ? "confirmedOnly" : "etaLaxLgbOnly";
    const requestBody = isConfirmed
      ? { confirmedDate: newDate, confirmedTime: container.confirmedTime ?? null }
      : { etaLaxLgbDate: newDate };

    try {
      const response = await fetch(apiPath(`/api/containers?id=${encodeURIComponent(containerId)}&${queryParam}=true`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setContainers(previous);
        setCachedTimelineContainers(previous);
        toast.error(response.status === 403
          ? pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action.")
          : (json.error ?? pick("날짜 변경에 실패했습니다.", "Failed to update the date.")));
        return;
      }

      toast.success(isConfirmed
        ? pick("입고 확정일이 변경되었습니다.", "Confirmed delivery date updated.")
        : pick("ETA LAX/LGB 날짜가 변경되었습니다.", "ETA LAX/LGB date updated."));
    } catch {
      setContainers(previous);
      setCachedTimelineContainers(previous);
      toast.error(pick("날짜 변경에 실패했습니다.", "Failed to update the date."));
    }
  }

  function exportToExcel() {
    const visibleContainers = grouped.flatMap((g) => g.items);
    const rows: (string | number)[][] = [
      ["Container", "Status", "ETA", "Factory", "Warehouse", "SKU Count", "Total Qty", "Total CBM (m³)"],
      ...visibleContainers.map((c) => [
        c.containerNumber,
        STATUS_LABEL_FULL[c.status],
        c.etaDate ?? "",
        c.factoryName ?? "",
        c.destWarehouse ?? "",
        c.itemCount,
        c.totalQty,
        c.totalCbm,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Container Timeline");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `container_timeline_${date}.xlsx`);
  }

  function barProps(c: Container): { left: number; width: number } | null {
    const etaStr = containerScheduleDate(c);
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
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={pick("컨테이너 일정 로딩 중", "Loading container timeline")}>
        <div className="flex items-start gap-2">
          <CalendarRange className="mt-1 h-5 w-5 shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-[#1a1917]">{pick("컨테이너 일정", "Container Timeline")}</h1>
            <p className="text-sm text-muted-foreground">{pick("입고 예정 컨테이너 · ETA 기준 Gantt 뷰", "Inbound containers · Gantt view by ETA")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-8 w-[280px] animate-pulse rounded-lg bg-stone-200" />
          <div className="h-8 w-64 animate-pulse rounded-lg bg-stone-200" />
          <div className="h-8 w-48 animate-pulse rounded-lg bg-stone-200" />
        </div>
        <div className="overflow-hidden rounded-xl border border-[#e2dfd8] bg-white">
          <div className="h-10 animate-pulse border-b border-[#e2dfd8] bg-stone-100" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex h-16 items-center gap-4 border-b border-[#eee] px-4 last:border-0">
              <div className="h-4 w-32 animate-pulse rounded bg-stone-200" />
              <div className="h-5 flex-1 animate-pulse rounded-full bg-blue-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
    );
  }

  const todayVisible = todayPct >= 0 && todayPct <= 100;
  const totalVisible = period === "schedule"
    ? scheduleVisibleCount
    : grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className={`container-timeline-surface flex flex-col gap-4 transition-[margin] duration-200 ${selected ? "2xl:mr-[1120px]" : ""}`}>
        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex shrink-0 items-start gap-2">
            <CalendarRange className="mt-1 h-5 w-5 shrink-0" />
            <div>
              <h1 className="text-lg font-bold text-[#1a1917]">{pick("컨테이너 일정", "Container Timeline")}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {pick("입고 예정 컨테이너를 날짜 기준으로 시각화합니다.", "Visualizes scheduled inbound containers on a date-based timeline.")}
              </p>
            </div>
          </div>

          {/* ── Top-right action buttons ─── */}
          <div className="flex items-center gap-2 shrink-0">
            {/* List / Timeline view toggle */}
            <div className="flex overflow-hidden rounded-md border border-[#d8d6ce]">
              <Link
                href={listHref}
                className="flex items-center gap-1.5 border-r border-[#d8d6ce] bg-white px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-[#f0eee9]"
              >
                <List className="h-4 w-4" />
                {pick("목록", "List")}
              </Link>
              <span className="flex items-center gap-1.5 bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white">
                <CalendarRange className="h-4 w-4" />
                {pick("일정", "Timeline")}
              </span>
            </div>

            {/* Add container → container-planning with form open */}
            <Link
              href="/planning/container-planning?action=add"
              className="flex items-center gap-1.5 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1650c4]"
            >
              <Plus className="h-4 w-4" />
              {pick("컨테이너 추가", "Add Container")}
            </Link>

            {/* Excel export */}
            <button
              type="button"
              onClick={exportToExcel}
              className="flex items-center gap-1.5 rounded-md border border-[#d8d6ce] bg-white px-3 py-2 text-sm font-medium text-[#1a1917] transition-colors hover:bg-[#f0eee9]"
            >
              <FileDown className="h-4 w-4" />
              {pick("엑셀 내보내기", "Excel Export")}
            </button>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-[280px] shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
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
                {option.value === "all" ? pick("전체", "All") : option.value === "empty" ? pick("SKU없음", "No SKU") : option.shortLabel}
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

          {/* Period dropdown */}
          <span className="text-[11px] font-semibold text-muted-foreground">{pick("기간", "Period")}</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPeriodOpen((o) => !o)}
              className="flex items-center gap-1.5 h-[26px] rounded-lg border border-[#d8d6ce] bg-white px-2.5 text-[11px] font-semibold text-[#1a1917] hover:bg-[#f0eee9] transition-colors"
            >
              {pick(
                PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period,
                PERIOD_OPTIONS.find((o) => o.value === period)?.labelEn ?? period,
              )}
              <ChevronDown className="h-3 w-3 text-stone-400" />
            </button>
            {periodOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-[#e2dfd8] bg-white py-1 shadow-lg">
                  {PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setPeriod(opt.value);
                        localStorage.setItem("container-timeline:period", opt.value);
                        setPeriodOpen(false);
                        if (opt.value === "monthly" || opt.value === "schedule") {
                          const d = new Date();
                          setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                        }
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[#f0eee9] transition-colors ${
                        period === opt.value ? "font-semibold text-[#1a5cdb]" : "text-[#1a1917]"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${period === opt.value ? "bg-[#1a5cdb]" : "bg-transparent"}`} />
                      {pick(opt.label, opt.labelEn)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {period !== "monthly" && period !== "schedule" && (
            <>
              <span className="w-px h-4 bg-[#d8d6ce]" />

              {/* View mode toggle */}
              <div className="flex bg-[#f0eee9] border border-[#d8d6ce] rounded-lg p-0.5 gap-0.5">
                {(["compact", "detailed"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setViewMode(mode);
                      localStorage.setItem("container-timeline:viewMode", mode);
                    }}
                    className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      viewMode === mode
                        ? "bg-white text-[#1a1917] shadow-sm ring-1 ring-inset ring-[#d8d6ce]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode === "compact" ? pick("간략하게", "Compact") : pick("상세하게", "Detailed")}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Result count */}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {pick(`${totalVisible}개 표시 중`, `${totalVisible} shown`)}
          </span>
        </div>

        {/* ── Monthly calendar view ────────────────────────────────────── */}
        {period === "monthly" && (
          <CalendarMonthView
            containers={searchMatchedContainers}
            activeStatuses={activeStatuses}
            calendarMonth={calendarMonth}
            setCalendarMonth={setCalendarMonth}
            selected={selected}
            setSelected={setSelected}
            today={today}
            pick={pick}
            canDragDrop={canEditTimeline}
            onMoveContainer={moveContainerToDate}
          />
        )}

        {/* ── Schedule list view ──────────────────────────────────────── */}
        {period === "schedule" && (
          <ContainerScheduleView
            containers={searchMatchedContainers}
            activeStatuses={activeStatuses}
            calendarMonth={calendarMonth}
            setCalendarMonth={setCalendarMonth}
            selected={selected}
            setSelected={setSelected}
            today={today}
            pick={pick}
          />
        )}

        {/* ── Gantt table ──────────────────────────────────────────────── */}
        {period !== "monthly" && period !== "schedule" && (
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
                      m.isCurrent ? "text-[#1a5cdb] bg-blue-50" : "text-stone-500"
                    }`}
                  >
                    {m.label}
                    {countByMonth[m.label] ? (
                      <span className="ml-1.5 font-normal opacity-60">({countByMonth[m.label]})</span>
                    ) : null}
                  </div>
                ))}
              </div>
              {todayVisible && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ left: `${todayPct}%` }}
                >
                  <div className="w-[2px] h-full bg-red-500" />
                  <div className="absolute top-1 left-0 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm whitespace-nowrap shadow-sm">
                    Today
                  </div>
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
                <div
                  className="flex border-b border-[#f0ede8] bg-[#fafaf7] cursor-pointer select-none hover:bg-[#eceae4] transition-colors"
                  onClick={() => toggleGroup(group.status)}
                >
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
                  <div className="flex-1 flex items-center justify-end pr-3">
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-stone-400 transition-transform duration-150 ${
                        collapsedGroups.has(group.status) ? "-rotate-90" : ""
                      }`}
                    />
                  </div>
                </div>

                {/* Container rows */}
                {!collapsedGroups.has(group.status) && group.items.map((c) => {
                  const bar = barProps(c);
                  const isSelected = selected?.id === c.id;
                  const containerProductKeys = productKeysByContainer.get(c.id) ?? [];
                  const isDraft = c.status === "draft";
                  const displayDate = containerScheduleDate(c);

                  return (
                    <div
                      key={c.id}
                      className={`flex border-b border-[#f0ede8] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f0eee9] ${
                        isSelected ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]/40" : ""
                      }`}
                      onClick={() => setSelected(isSelected ? null : c)}
                    >
                      {/* Sidebar */}
                      {viewMode === "compact" ? (
                        <div
                          className={`border-r border-[#e2dfd8] px-3 py-1.5 flex items-center gap-2 ${
                            isSelected ? "w-[276px] shrink-0" : "w-[280px] shrink-0"
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: STATUS_COLOR[c.status] }}
                          />
                          <span className="font-mono text-[11px] font-bold text-[#1a1917] truncate flex-1">
                            {confirmedChipLabel(c, pick)}
                          </span>
                          <span className="text-[10px] text-stone-400 shrink-0">
                            {c.itemCount} SKUs
                          </span>
                          {!c.confirmedDate && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              · {displayDate ?? "—"}
                            </span>
                          )}
                        </div>
                      ) : (
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
                              {confirmedChipLabel(c, pick)}
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
                            {!c.confirmedDate && `ETA ${displayDate ?? "—"} · `}{c.itemCount} SKUs · {c.totalQty.toLocaleString()} units
                          </div>
                        </div>
                      )}

                      {/* Timeline */}
                      <div className={`flex-1 relative ${viewMode === "compact" ? "py-1.5 min-h-[36px]" : "py-3 min-h-[62px]"}`}>
                        {/* Month grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {months.map((m, i) => (
                            <div
                              key={i}
                              style={{ width: `${m.widthPct}%` }}
                              className={`shrink-0 border-r border-[#f0ede8] last:border-r-0 ${
                                m.isCurrent ? "bg-blue-50" : ""
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
                            <div className="w-[2px] h-full bg-red-500 opacity-60" />
                          </div>
                        )}

                        {/* Gantt bar */}
                        {bar ? (
                          <div
                            className={`absolute rounded-md flex items-center overflow-hidden shadow-sm ${viewMode === "compact" ? "top-1 bottom-1" : "top-3 bottom-3"}`}
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
                                className="flex items-center gap-1 text-[11px] font-bold text-white truncate flex-1"
                                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
                              >
                                {c.confirmedDate && <span className="shrink-0">✓</span>}
                                <span className="truncate">{c.containerNumber}</span>
                              </span>
                              {displayDate && (
                                <span className="text-[10px] text-white/80 shrink-0">
                                  {fmtDate(toDate(displayDate))}
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
        )} {/* end period !== "monthly" */}

        {/* Legend */}
        {period !== "monthly" && period !== "schedule" && (
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
            <div className="w-[2px] h-4 bg-red-500" />
            {pick("오늘", "Today")}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3 rounded-sm bg-blue-50 border border-blue-200" />
            {pick("이번달", "This Month")}
          </div>
          <span className="ml-auto text-[10px] text-stone-300">
            {pick("※ 바 너비 = 30일 Transit 기간 (발주일 컬럼 추가 시 실제 기간으로 전환 가능)", "※ Bar width = 30-day transit period (can switch to actual period when order date column is added)")}
          </span>
        </div>
        )} {/* end legend */}
      </div>

      {/* ── Right overlay drawer ──────────────────────────────────────────────── */}
      {selected && (
        <ContainerDetailDrawer
          key={selected.id}
          container={selected}
          planningRowsBySku={planningRowsBySku}
          planningLoading={planningLoading}
          skuSearchQuery={searchQuery}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ── Calendar day cell (manages its own overflow popup) ───────────────────────

function CalendarDayCell({
  date,
  isCurrentMonth,
  isToday,
  isSat,
  isSun,
  dayCells,
  selected,
  setSelected,
  pick,
  canDragDrop,
  onDropContainer,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSat: boolean;
  isSun: boolean;
  dayCells: Container[];
  selected: Container | null;
  setSelected: (c: Container | null) => void;
  pick: (ko: string, en: string) => string;
  canDragDrop: boolean;
  onDropContainer: (containerId: string) => void;
}) {
  const MAX_VISIBLE = 4;
  const visible = dayCells.slice(0, MAX_VISIBLE);
  const overflow = dayCells.length - MAX_VISIBLE;

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canDragDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!canDragDrop) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }

  function handleDragLeave() {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!canDragDrop) return;
    event.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const containerId = event.dataTransfer.getData("text/plain");
    if (containerId) onDropContainer(containerId);
  }

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function openPopup() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (overflowRef.current) {
      const rect = overflowRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      const x = spaceRight < 272 ? rect.right - 260 : rect.left;
      const spaceBelow = window.innerHeight - rect.bottom;
      const y = spaceBelow < 300 ? rect.top - 8 - Math.min(dayCells.length * 38 + 48, 300) : rect.bottom + 4;
      setPopupPos({ x, y });
    }
    setPopupOpen(true);
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setPopupOpen(false), 150);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-r border-[#e2dfd8] last:border-r-0 overflow-hidden p-1.5 transition-colors ${
        dragOver
          ? "bg-blue-100 ring-2 ring-inset ring-[#1a5cdb]"
          : !isCurrentMonth
            ? "bg-[#fafaf7]"
            : isToday
              ? "bg-blue-50/40"
              : "bg-white"
      }`}
    >
      {/* Date number */}
      <div className="flex justify-center mb-1">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
            isToday
              ? "bg-[#1a5cdb] text-white"
              : !isCurrentMonth
                ? "text-stone-300"
                : isSun
                  ? "text-red-400"
                  : isSat
                    ? "text-blue-400"
                    : "text-[#1a1917]"
          }`}
        >
          {date.getDate()}
        </span>
      </div>

      {/* Visible chips */}
      <div className="flex flex-col gap-0.5">
        {visible.map((c) => {
          const isSelected = selected?.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              draggable={canDragDrop}
              onDragStart={(event) => {
                if (!canDragDrop) return;
                event.dataTransfer.setData("text/plain", c.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => setSelected(isSelected ? null : c)}
              title={`${c.containerNumber} · ${STATUS_LABEL_FULL[c.status]}${c.confirmedDate ? ` · ${pick("확정", "Confirmed")} ${c.confirmedDate}${c.confirmedTime ? ` ${c.confirmedTime}` : ""}${c.destWarehouse ? ` · ${c.destWarehouse}` : ""}` : ""}`}
              className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] font-semibold text-white transition-opacity hover:opacity-90 ${canDragDrop ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                isSelected ? "ring-2 ring-white ring-offset-1" : ""
              }`}
              style={{ backgroundColor: STATUS_COLOR[c.status] }}
            >
              <span className="min-w-0 flex-1 truncate">{confirmedChipLabel(c, pick)}</span>
              {c.itemCount > 0 && (
                <span className="shrink-0 rounded bg-black/20 px-1 py-px text-[9px] font-bold">
                  {c.itemCount}
                </span>
              )}
            </button>
          );
        })}

        {/* Overflow trigger */}
        {overflow > 0 && (
          <button
            ref={overflowRef}
            type="button"
            onMouseEnter={openPopup}
            onMouseLeave={scheduleClose}
            className="px-1.5 text-left text-[10px] font-semibold text-[#1a5cdb] hover:underline"
          >
            +{overflow} {pick("개 더보기", "more")}
          </button>
        )}
      </div>

      {/* Overflow popup (fixed-positioned so it escapes the cell) */}
      {popupOpen && popupPos && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-[#e2dfd8] bg-white shadow-2xl"
          style={{ left: popupPos.x, top: popupPos.y }}
        >
          {/* Popup header */}
          <div className="border-b border-[#e2dfd8] bg-[#f5f4f0] px-3 py-2">
            <span className="text-[12px] font-semibold text-[#1a1917]">
              {date.toLocaleDateString(pick("ko-KR", "en-US"), { month: "long", day: "numeric" })}
            </span>
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              · {dayCells.length}{pick("개", " containers")}
            </span>
          </div>

          {/* All containers list */}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-2">
            {dayCells.map((c) => {
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  draggable={canDragDrop}
                  onDragStart={(event) => {
                    if (!canDragDrop) return;
                    event.dataTransfer.setData("text/plain", c.id);
                    event.dataTransfer.effectAllowed = "move";
                    setPopupOpen(false);
                  }}
                  onClick={() => {
                    setSelected(isSelected ? null : c);
                    setPopupOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-white transition-opacity hover:opacity-90 ${canDragDrop ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                    isSelected ? "ring-2 ring-white ring-offset-1 ring-offset-white" : ""
                  }`}
                  style={{ backgroundColor: STATUS_COLOR[c.status] }}
                >
                  <span className="flex-1 truncate text-[11px] font-bold">{confirmedChipLabel(c, pick)}</span>
                  <span className="shrink-0 text-[9px] font-semibold opacity-80">
                    {STATUS_LABEL_FULL[c.status]}
                  </span>
                  {c.itemCount > 0 && (
                    <span className="shrink-0 rounded bg-black/15 px-1 py-px text-[9px] font-semibold">
                      {c.itemCount} SKU
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Monthly Calendar View ─────────────────────────────────────────────────────

const DAY_NAMES_KO = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_NAMES_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function CalendarMonthView({
  containers,
  activeStatuses,
  calendarMonth,
  setCalendarMonth,
  selected,
  setSelected,
  today,
  pick,
  canDragDrop,
  onMoveContainer,
}: {
  containers: Container[];
  activeStatuses: Set<ContainerStatus>;
  calendarMonth: Date;
  setCalendarMonth: (d: Date) => void;
  selected: Container | null;
  setSelected: (c: Container | null) => void;
  today: Date;
  pick: (ko: string, en: string) => string;
  canDragDrop: boolean;
  onMoveContainer: (containerId: string, newDate: string) => void;
}) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  // Mon-based grid: Mon=0 … Sun=6
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDOW = (firstDay.getDay() + 6) % 7; // Mon=0
  const calStart = new Date(firstDay.getTime() - startDOW * 86_400_000);
  const numWeeks = Math.ceil((startDOW + lastDay.getDate()) / 7);

  const todayKey = today.toISOString().slice(0, 10);

  // Build date-keyed map of containers (filtered by status)
  const containersByDate = new Map<string, Container[]>();
  let monthTotal = 0;
  for (const c of containers) {
    if (!activeStatuses.has(c.status)) continue;
    const dateStr = containerScheduleDate(c);
    if (!dateStr) continue;
    const list = containersByDate.get(dateStr) ?? [];
    list.push(c);
    containersByDate.set(dateStr, list);
    // Count only containers whose date falls in the displayed month
    const d = new Date(dateStr + "T00:00:00");
    if (d.getFullYear() === year && d.getMonth() === month) monthTotal++;
  }

  const monthLabel = calendarMonth.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  const monthLabelEn = calendarMonth.toLocaleDateString("en-US", { year: "numeric", month: "long" });

  const prevMonth = () => setCalendarMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCalendarMonth(new Date(year, month + 1, 1));
  const goToday = () => {
    const d = new Date();
    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const dayNames = pick(DAY_NAMES_KO.join(","), DAY_NAMES_EN.join(",")).split(",");

  return (
    <div className="rounded-xl border border-[#e2dfd8] bg-white shadow-sm overflow-hidden">
      {/* Calendar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2dfd8] bg-[#f5f4f0]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border border-[#b8b3aa] bg-white px-4 py-1.5 text-[12px] font-semibold text-[#1a1917] hover:bg-[#f0eee9] transition-colors"
          >
            {pick("오늘", "Today")}
          </button>
          <button
            type="button"
            onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-[#e8e6e0] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-[#e8e6e0] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-3 text-[20px] font-semibold tracking-tight text-[#1a1917]">
            {pick(monthLabel, monthLabelEn)}
          </span>
          {monthTotal > 0 && (
            <span className="rounded-full bg-[#1a5cdb] px-2.5 py-px text-[11px] font-bold text-white">
              {monthTotal}
            </span>
          )}
        </div>
        <div className="hidden items-center gap-3 text-[11px] text-muted-foreground md:flex">
          {STATUS_ORDER.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
              {STATUS_LABEL_FULL[status]}
            </span>
          ))}
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-[#e2dfd8] bg-[#fafaf7]">
        {dayNames.map((name, i) => (
          <div
            key={i}
            className={`py-2 text-center text-[11px] font-semibold tracking-wide ${
              i === 6 ? "text-red-400" : i === 5 ? "text-blue-400" : "text-stone-400"
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {Array.from({ length: numWeeks }, (_, wi) => (
        <div
          key={wi}
          className="grid grid-cols-7 border-b border-[#e2dfd8] last:border-b-0"
          style={{ height: 148 }}
        >
          {Array.from({ length: 7 }, (_, di) => {
            const date = new Date(calStart.getTime() + (wi * 7 + di) * 86_400_000);
            const dateKey = date.toISOString().slice(0, 10);
            return (
              <CalendarDayCell
                key={di}
                date={date}
                isCurrentMonth={date.getMonth() === month}
                isToday={dateKey === todayKey}
                isSat={di === 5}
                isSun={di === 6}
                dayCells={containersByDate.get(dateKey) ?? []}
                selected={selected}
                setSelected={setSelected}
                pick={pick}
                canDragDrop={canDragDrop}
                onDropContainer={(containerId) => onMoveContainer(containerId, dateKey)}
              />
            );
          })}
        </div>
      ))}

    </div>
  );
}

// ── Schedule List View ───────────────────────────────────────────────────────

function ContainerScheduleView({
  containers,
  activeStatuses,
  calendarMonth,
  setCalendarMonth,
  selected,
  setSelected,
  today,
  pick,
}: {
  containers: Container[];
  activeStatuses: Set<ContainerStatus>;
  calendarMonth: Date;
  setCalendarMonth: (d: Date) => void;
  selected: Container | null;
  setSelected: (c: Container | null) => void;
  today: Date;
  pick: (ko: string, en: string) => string;
}) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const todayKey = today.toISOString().slice(0, 10);

  const rowsByDate = new Map<string, Container[]>();
  for (const container of containers) {
    if (!activeStatuses.has(container.status)) continue;
    const dateStr = containerScheduleDate(container);
    if (!dateStr) continue;
    const date = toDate(dateStr);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    const list = rowsByDate.get(dateStr) ?? [];
    list.push(container);
    rowsByDate.set(dateStr, list);
  }

  const dateKeys = Array.from(rowsByDate.keys()).sort();
  for (const dateKey of dateKeys) {
    rowsByDate.get(dateKey)?.sort((a, b) => {
      const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      if (statusDiff !== 0) return statusDiff;
      return a.containerNumber.localeCompare(b.containerNumber);
    });
  }

  const monthLabel = calendarMonth.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  const monthLabelEn = calendarMonth.toLocaleDateString("en-US", { year: "numeric", month: "long" });
  const prevMonth = () => setCalendarMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCalendarMonth(new Date(year, month + 1, 1));
  const goToday = () => {
    const d = new Date();
    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#e2dfd8] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e2dfd8] bg-[#f5f4f0] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border border-[#b8b3aa] bg-white px-4 py-1.5 text-[12px] font-semibold text-[#1a1917] hover:bg-[#f0eee9] transition-colors"
          >
            {pick("오늘", "Today")}
          </button>
          <button
            type="button"
            onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-[#e8e6e0] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-[#e8e6e0] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-3 text-[20px] font-semibold tracking-tight text-[#1a1917]">
            {pick(monthLabel, monthLabelEn)}
          </span>
          {dateKeys.length > 0 && (
            <span className="rounded-full bg-[#1a5cdb] px-2.5 py-px text-[11px] font-bold text-white">
              {Array.from(rowsByDate.values()).reduce((sum, list) => sum + list.length, 0)}
            </span>
          )}
        </div>
        <div className={`hidden items-center gap-3 text-[11px] text-muted-foreground md:flex ${selected ? "2xl:hidden" : ""}`}>
          {STATUS_ORDER.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
              {STATUS_LABEL_FULL[status]}
            </span>
          ))}
        </div>
      </div>

      {dateKeys.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          <div>{pick("표시할 스케줄이 없습니다", "No scheduled containers to display")}</div>
          <div className="mt-1 text-[11px] text-stone-300">
            {pick("월을 변경하거나 필터를 조정해보세요", "Try another month or adjust the filters")}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[#e2dfd8]">
          {dateKeys.map((dateKey) => {
            const date = toDate(dateKey);
            const dayNumber = date.getDate();
            const isToday = dateKey === todayKey;
            const dateLabel = date.toLocaleDateString(pick("ko-KR", "en-US"), {
              month: "short",
              weekday: "short",
            });
            const rows = rowsByDate.get(dateKey) ?? [];

            return (
              <div
                key={dateKey}
                className={`grid ${selected ? "grid-cols-[72px_1fr] md:grid-cols-[118px_1fr]" : "grid-cols-[86px_1fr] md:grid-cols-[190px_1fr]"} ${isToday ? "bg-blue-50/35" : "bg-white"}`}
              >
                <div className={`flex items-start gap-3 border-r border-[#eef0f3] py-3.5 ${selected ? "px-2.5 md:px-3" : "px-4"}`}>
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] font-bold ${
                      isToday ? "bg-[#1a5cdb] text-white" : "text-[#1a1917]"
                    }`}
                  >
                    {dayNumber}
                  </div>
                  <div className={`hidden min-w-0 pt-1 md:block ${selected ? "2xl:hidden" : ""}`}>
                    <div className={`text-[12px] font-bold uppercase tracking-wide ${isToday ? "text-[#1a5cdb]" : "text-stone-500"}`}>
                      {dateLabel}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {rows.length}{pick("개 컨테이너", " containers")}
                    </div>
                  </div>
                </div>

                <div className={`grid grid-cols-1 gap-1.5 p-2.5 ${selected ? "2xl:grid-cols-1" : "lg:grid-cols-3 2xl:grid-cols-4"}`}>
                  {rows.map((container) => {
                    const isSelected = selected?.id === container.id;
                    const cbmPct = container.cbmCapacity > 0
                      ? Math.round((container.totalCbm / container.cbmCapacity) * 100)
                      : null;

                    return (
                      <button
                        key={container.id}
                        type="button"
                        onClick={() => setSelected(isSelected ? null : container)}
                        className={`grid min-h-[56px] grid-cols-[14px_1fr] items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-[#f0eee9] ${
                          isSelected ? "border-[#9db7f5] bg-[#ebf0fd] ring-1 ring-inset ring-[#9db7f5]" : "border-[#e2dfd8] bg-white"
                        }`}
                      >
                        <span className="mt-1.5 h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: STATUS_COLOR[container.status] }} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono text-[13px] font-bold text-[#1a1917]">
                              {confirmedChipLabel(container, pick)}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${STATUS_PILL[container.status]}`}>
                              {STATUS_LABEL_FULL[container.status]}
                            </span>
                          </span>
                          <span className="mt-px flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] text-muted-foreground">
                            <span>{container.itemCount} SKUs</span>
                            <span>{container.totalQty.toLocaleString()} units</span>
                            <span>{container.totalCbm.toFixed(1)} CBM</span>
                            {cbmPct !== null && <span>{cbmPct}%</span>}
                            {container.destWarehouse && <span className="truncate">{container.destWarehouse}</span>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ContainerDetailDrawer({
  container: c,
  planningRowsBySku,
  planningLoading,
  skuSearchQuery,
  onClose,
}: {
  container: Container;
  planningRowsBySku: Record<string, DemandRow>;
  planningLoading: boolean;
  skuSearchQuery: string;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const normalizedSkuSearch = skuSearchQuery.trim().toLowerCase();
  const [activeTab, setActiveTab] = useState<"sku" | "history">("sku");
  const [localSkuFilter, setLocalSkuFilter] = useState("");
  const [selectedSkuRowId, setSelectedSkuRowId] = useState<string | null>(null);
  const highlightedSkuRowRef = useRef<HTMLTableRowElement | null>(null);
  const [skuSort, setSkuSort] = useState<{ key: SkuImpactSortKey; direction: SortDirection }>({
    key: "sku",
    direction: "asc",
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("sku");
  }, [c.id]);
  const totalCbm = c.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const totalQty = c.items.reduce((sum, item) => sum + item.qty, 0);
  const cbmUsedPct = c.cbmCapacity > 0 ? Math.min(100, (totalCbm / c.cbmCapacity) * 100) : 0;
  const detailProductKeys = Array.from(new Set(
    c.items
      .map((item) => productKeyForTimelineSku(item, planningRowsBySku[item.sku]))
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
    if (firstHighlightedIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      highlightedSkuRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstHighlightedIndex]);

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
  const dateFields = [
    { label: pick("예상 선적일", "Est. Loading"), value: c.estLoadingDate },
    { label: "ETD NGB", value: c.etdNgbDate },
    { label: "ETA LAX/LGB", value: c.etaLaxLgbDate },
    {
      label: c.status === "complete" ? pick("실제 입고", "Actual Arrival") : pick("창고 입고일 (ETA)", "Warehouse (ETA)"),
      value: displayDate,
      accent: c.status === "complete",
    },
    ...(c.confirmedDate
      ? [{
          label: pick("입고 확정", "Confirmed Delivery"),
          value: [c.confirmedDate, c.confirmedTime, c.destWarehouse].filter(Boolean).join(" · "),
          accent: true,
        }]
      : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/15 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="container-timeline-surface fixed right-0 w-[min(1120px,calc(100vw-24px))] z-40 bg-white border-l border-[#e2dfd8] shadow-2xl flex flex-col overflow-hidden"
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

        {planningLoading && (
          <div className="h-1 shrink-0 overflow-hidden bg-blue-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[#1a5cdb]" />
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Meta info */}
          <div className="shrink-0 px-6 py-4 space-y-3 border-b border-[#e2dfd8]">
            <div className="grid grid-cols-[minmax(220px,1.2fr)_minmax(220px,1fr)_minmax(100px,0.7fr)] items-center gap-x-6 text-[12px]">
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                <span className="font-semibold text-muted-foreground">{pick("공장", "Factory")}:</span>
                <span className="truncate font-semibold">{c.factoryName ?? "—"}</span>
              </div>
              <div className="flex min-w-0 items-center justify-self-end gap-2 whitespace-nowrap text-right">
                <span className="font-semibold text-muted-foreground">{pick("창고", "Warehouse")}:</span>
                <span className="truncate font-semibold">{c.destWarehouse ?? "—"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {dateFields.map((field) => (
                <div key={field.label} className="rounded-lg border border-[#e2dfd8] bg-[#fafaf7] px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    {field.label}
                  </div>
                  <div className={`mt-0.5 font-mono text-xs font-semibold ${field.accent ? "text-[#22a666]" : "text-foreground"}`}>
                    {field.value ?? "—"}
                  </div>
                </div>
              ))}
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

          {/* Tab bar */}
          <div className="flex shrink-0 border-b border-[#e2dfd8] px-6">
            <button
              type="button"
              onClick={() => setActiveTab("sku")}
              className={`mr-6 border-b-2 py-2.5 text-[11px] font-semibold transition-colors ${activeTab === "sku" ? "border-[#1a5cdb] text-[#1a5cdb]" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {pick("SKU 목록", "SKU List")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1.5 border-b-2 py-2.5 text-[11px] font-semibold transition-colors ${activeTab === "history" ? "border-[#1a5cdb] text-[#1a5cdb]" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <History className="h-3.5 w-3.5" />
              {pick("변경 이력", "Change History")}
            </button>
          </div>

          {/* SKU tab */}
          {activeTab === "sku" && (
          <div className="flex min-h-0 flex-1 flex-col border-b border-[#e2dfd8]">
            <div className="flex shrink-0 flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 sm:max-w-[420px]">
                <input
                  type="text"
                  value={localSkuFilter}
                  onChange={(e) => setLocalSkuFilter(e.target.value)}
                  placeholder={pick("SKU 검색...", "Search SKU...")}
                  className="w-full rounded-md border border-[#e2dfd8] bg-[#fafaf7] px-3 py-1.5 text-[12px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
                />
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 text-[11px] text-muted-foreground sm:justify-end">
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
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
              {c.items.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-muted-foreground border border-dashed border-[#d8d6ce] rounded-lg">
                  {pick("등록된 SKU가 없습니다", "No SKUs registered")}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#e2dfd8]">
                  <div className="min-h-0 flex-1 overflow-x-auto overflow-y-scroll">
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
                        const skuRowId = item.id || item.sku;
                        const isSelectedSku = selectedSkuRowId === skuRowId;
                        return (
                        <tr
                          key={item.id || i}
                          ref={i === firstHighlightedIndex ? highlightedSkuRowRef : undefined}
                          onClick={() => setSelectedSkuRowId(skuRowId)}
                          onDoubleClick={() => {
                            window.open(
                              withBasePath(`/planning/sku-forecasts?sku=${encodeURIComponent(item.sku)}&tab=inventory&includeDrafts=1&highlightContainerId=${encodeURIComponent(c.id)}&highlightContainer=${encodeURIComponent(c.containerNumber)}`),
                              "_blank",
                              "noopener,noreferrer",
                            );
                          }}
                          aria-selected={isSelectedSku}
                          title={pick("더블클릭하여 SKU Planning에서 열기", "Double-click to open in SKU Planning")}
                          className={`cursor-pointer border-b border-[#f0ede8] last:border-b-0 transition-colors ${
                            isSelectedSku ? "bg-[#dbeafe] outline outline-2 -outline-offset-2 outline-[#2563eb] hover:bg-[#dbeafe]" :
                            isHighlighted ? "bg-blue-100 outline outline-2 -outline-offset-2 outline-[#1a5cdb] hover:bg-blue-100" :
                            level === "critical" ? "bg-red-50/70 hover:bg-red-50" :
                            level === "warning" ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-[#fafaf7]"
                          }`}
                        >
                          <td className={`px-3 py-2 font-mono font-semibold truncate ${isSelectedSku || isHighlighted ? "text-[#1238a0]" : "text-[#1a1917]"}`}>{item.sku}</td>
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
                    </table>
                  </div>
                  <div className="grid shrink-0 grid-cols-[18%_8%_8%_9%_7%_8%_10%_7%_10%_7%_8%] border-t border-[#e2dfd8] bg-[#f5f4f0] text-[11px] shadow-[0_-1px_0_#e2dfd8]">
                    <div className="px-3 py-2 font-semibold text-muted-foreground">Total ({c.items.length} SKUs)</div>
                    <div className="col-span-7" />
                    <div className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-bold">{pick("입고", "Inbound")} {totalQty.toLocaleString()} units</div>
                    <div />
                    <div className="px-3 py-2 text-right tabular-nums font-bold">{totalCbm.toFixed(2)} m³</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
          {activeTab === "history" && (
            <ContainerHistoryTab containerId={String(c.id)} />
          )}
        </div>

      </div>
    </>
  );
}
