"use client";

// Code Guide: Screen 2 — marketplace (Amazon/eBay/Walmart) restock recovery.
// Histogram + table are wired to real data via
// /api/planning/oos-impact/recovery (+ /recovery/drilldown for the per-row
// chart). A separate "채널 비교" (per-channel line chart) view used to sit
// alongside this, but it only ever showed sample data (no real time-series
// aggregation was built for it) — removed rather than shipping a fake chart.
//
// Core metric is daysToRecovery (days since restock until sales trailing-
// average first reached 80% of baseline), NOT a live/current sales snapshot —
// this screen exists to find SKUs whose post-restock recovery was slow or
// never happened, which is a question about the past trajectory, not "is this
// SKU selling well today." See recovery/route.ts for the SQL-side definition.
//
// Only touch shared.tsx for things this file and preorder-screen.tsx both need.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  Chip, FilterRow, Histogram, Kpi, LineChart, Pagination, SeverityPill, SortIcon,
  average, type Severity, type SortDir,
} from "./shared";

interface RecoveryRow {
  sku: string;
  channel: string;
  itemCategory: string;
  oosStartedOn: string;
  restockDate: string;
  oosDays: number;
  daysSinceRestock: number;
  baseline: number;
  day0to30: number | null;
  day30to60: number | null;
  day60to90: number | null;
  daysToRecovery: number | null;
  severity: Severity;
  label: string;
}

interface DrilldownPoint {
  dayOffset: number;
  value: number;
  qty: number;
}

interface Drilldown {
  points: DrilldownPoint[];
  baseline: number;
}

// "판매량 TOP 100 SKU만" filter — restricts the recovery table (both 채널
// 비교/스큐 비교 views) to Master SKUs that rank in the trailing-30-day,
// all-channel top 100 (see /api/planning/oos-impact/top-sellers). Only the
// sku field is used; the rest of the response is unused here.
interface TopSellerRow {
  rank: number;
  sku: string;
  categoryCode: string | null;
  totalQty: number;
  avgDaily: number;
}

// Raw channel column values (shipcore.fc_velocity_link/custom_snapshot) — eBay
// rows are stored without an "eBay " prefix, so display labels are mapped
// separately from the value used for filtering/queries.
const MARKETPLACE_CHANNELS = ["Amazon FBA", "Amazon FBM", "Auto_Armor", "Advance_Parts", "Walmart"] as const;

const CHANNEL_DISPLAY_LABELS: Record<string, string> = {
  "Amazon FBA": "Amazon FBA",
  "Amazon FBM": "Amazon FBM",
  Auto_Armor: "eBay Auto_Armor",
  Advance_Parts: "eBay Advance_Parts",
  Walmart: "Walmart",
};

// Same 4 categories/values as preorder-screen.tsx's item filter (item_category
// is precomputed onto every fc_velocity_*_snapshot row at sync time — see
// ITEM_CATEGORY_CASE in velocity/repository.ts). Rows outside these 4
// (Miscellaneous) are never shown here, matching preorder-screen's behavior.
const ITEM_CATEGORIES = ["Car Cover", "Seat Cover", "Floor Mat", "SWC"] as const;
const ITEM_FILTERS = ["전체", ...ITEM_CATEGORIES] as const;

// This screen's own page-size options (default 10) — kept local rather than
// changed on shared.tsx's PAGE_SIZES, since that would also shift
// preorder-screen's default.
const RECOVERY_PAGE_SIZES = [10, 25, 50, 100];

function num1(v: number | null): string {
  return v === null ? "—" : v.toFixed(1);
}

function daysToRecoveryLabel(r: RecoveryRow, pick: (ko: string, en: string) => string): string {
  if (r.daysToRecovery !== null) return pick(`${r.daysToRecovery}일`, `${r.daysToRecovery}d`);
  return r.severity === "critical" ? pick("미회복", "Not Recovered") : pick("관찰중", "Pending");
}

type SortKey = "sku" | "baseline" | "oosStartedOn" | "restockDate" | "oosDays" | "daysToRecovery" | "severity";

// Columns whose first click sorts ascending (text/date-like); numeric columns
// default to descending so the most extreme values surface first.
const DEFAULT_ASC_KEYS: SortKey[] = ["sku", "oosStartedOn", "restockDate", "severity"];
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, good: 3 };

const TABLE_COLUMNS: { key: SortKey; ko: string; en: string; right?: boolean }[] = [
  { key: "sku", ko: "Master SKU", en: "Master SKU" },
  { key: "baseline", ko: "품절직전 일평균", en: "Pre-Stockout Daily Avg.", right: true },
  { key: "oosStartedOn", ko: "품절일", en: "Stockout Date" },
  { key: "restockDate", ko: "재입고일", en: "Restock Date" },
  { key: "oosDays", ko: "품절기간", en: "Stockout Days", right: true },
  { key: "daysToRecovery", ko: "회복까지 걸린 일수", en: "Days to Recovery", right: true },
  { key: "severity", ko: "상태", en: "Status" },
];

function rowKey(r: RecoveryRow): string {
  return `${r.sku}|${r.channel}|${r.restockDate}`;
}

// Distribution buckets for the "스큐 비교" histogram — categorical (days-to-
// recovery ranges plus the two undecided/failed outcomes), not a continuous
// 0–100% scale, so no median line here (Histogram's median props are optional).
type RecoveryBucketKey = "0-30" | "30-60" | "60-90" | "pending" | "none";
const RECOVERY_BUCKETS: { key: RecoveryBucketKey; ko: string; en: string }[] = [
  { key: "0-30", ko: "0–30일", en: "0–30d" },
  { key: "30-60", ko: "30–60일", en: "30–60d" },
  { key: "60-90", ko: "60–90일", en: "60–90d" },
  { key: "pending", ko: "관찰중", en: "Pending" },
  { key: "none", ko: "미회복", en: "Not Recovered" },
];

function bucketOf(r: RecoveryRow): RecoveryBucketKey {
  if (r.daysToRecovery !== null) {
    if (r.daysToRecovery <= 30) return "0-30";
    if (r.daysToRecovery <= 60) return "30-60";
    return "60-90";
  }
  return r.severity === "critical" ? "none" : "pending";
}

export function RecoveryScreen() {
  const { pick } = useI18n();
  const [channels, setChannels] = useState<string[]>([...MARKETPLACE_CHANNELS]);
  const [items, setItems] = useState<string[]>([...ITEM_CATEGORIES]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [selectedBin, setSelectedBin] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(RECOVERY_PAGE_SIZES[0]);

  const [rows, setRows] = useState<RecoveryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 회복 판정 기준(기준선 대비 %) — 정수 퍼센트로 들고 있다가 fetch 시점에 0-1
  // 소수로 변환. 입력창은 별도 draft 상태로 받아 blur/Enter 시에만 커밋해서
  // 타이핑 중간값("8" 등)으로 매번 재조회가 일어나지 않도록 함.
  const [thresholdPct, setThresholdPct] = useState(80);
  const [thresholdDraft, setThresholdDraft] = useState("80");

  function commitThresholdDraft() {
    const parsed = Math.round(Number(thresholdDraft));
    const clamped = Number.isFinite(parsed) ? Math.min(100, Math.max(50, parsed)) : thresholdPct;
    setThresholdDraft(String(clamped));
    if (clamped !== thresholdPct) setThresholdPct(clamped);
  }

  // 재입고 후 이 일수가 지나기 전의 기준선 도달은 무시(재입고 직후 밀린 주문이
  // 한꺼번에 풀리며 생기는 일시적 스파이크를 "회복"으로 오인하지 않기 위함).
  // 13일 미만은 트레일링 14일 윈도우 자체가 재입고 이전 판매를 끌어오게 되므로
  // 서버에서도 강제로 13일 이상으로 클램프하지만, 입력 단계에서도 막아둠.
  const [minRecoveryDays, setMinRecoveryDays] = useState(13);
  const [minRecoveryDaysDraft, setMinRecoveryDaysDraft] = useState("13");

  function commitMinRecoveryDaysDraft() {
    const parsed = Math.round(Number(minRecoveryDaysDraft));
    const clamped = Number.isFinite(parsed) ? Math.min(89, Math.max(13, parsed)) : minRecoveryDays;
    setMinRecoveryDaysDraft(String(clamped));
    if (clamped !== minRecoveryDays) setMinRecoveryDays(clamped);
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setRows(null);
      setLoadError(null);
      setSelectedBin(null);
      setOpenKey(null);
      setPage(1);
      const params = new URLSearchParams({
        threshold: (thresholdPct / 100).toFixed(2),
        minRecoveryDays: String(minRecoveryDays),
      });
      try {
        const res = await fetch(apiPath(`/api/planning/oos-impact/recovery?${params}`));
        const json = await res.json() as { success: boolean; data?: RecoveryRow[]; error?: string };
        if (!json.success) throw new Error(json.error ?? "Unknown error");
        if (!cancelled) setRows(json.data ?? []);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [thresholdPct, minRecoveryDays]);

  // "판매량 TOP 100 SKU만" filter — see /api/planning/oos-impact/top-sellers.
  const [topRows, setTopRows] = useState<TopSellerRow[] | null>(null);
  const [topLoadError, setTopLoadError] = useState<string | null>(null);
  const [topSellersOnly, setTopSellersOnly] = useState(false);

  useEffect(() => {
    fetch(apiPath("/api/planning/oos-impact/top-sellers"))
      .then((r) => r.json())
      .then((json: { success: boolean; data?: TopSellerRow[]; error?: string }) => {
        if (!json.success) throw new Error(json.error ?? "Unknown error");
        setTopRows(json.data ?? []);
      })
      .catch((err: Error) => setTopLoadError(err.message));
  }, []);

  const topSellerSkuSet = useMemo(() => new Set((topRows ?? []).map((r) => r.sku)), [topRows]);

  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  // 그래프에 트레일링 14일 평균(회복 판정과 동일한 값) 또는 하루치 실측 판매량 중
  // 무엇을 그릴지 — 일별 판매량은 노이즈가 커서(주문 몰림/0건 반복) 그 자체로는
  // 회복 여부를 판단하기 어렵지만, 트레일링 평균이 왜 그렇게 나왔는지 원본 데이터를
  // 직접 보고 싶을 때를 위해 둘 다 볼 수 있게 함.
  const [drilldownMode, setDrilldownMode] = useState<"trailing" | "daily">("trailing");

  const toggle = (v: string) => {
    setChannels((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    setSelectedBin(null);
    setPage(1);
  };

  const toggleItem = (item: string) => {
    setItems((current) => {
      if (item === "전체") {
        return current.length === ITEM_CATEGORIES.length ? [] : [...ITEM_CATEGORIES];
      }
      return current.includes(item) ? current.filter((v) => v !== item) : [...current, item];
    });
    setSelectedBin(null);
    setPage(1);
  };

  const allItemsSelected = items.length === ITEM_CATEGORIES.length;

  const visibleRows = useMemo(
    () => (rows ?? [])
      .filter((r) => channels.includes(r.channel))
      .filter((r) => items.includes(r.itemCategory))
      .filter((r) => !topSellersOnly || topSellerSkuSet.has(r.sku)),
    [rows, channels, items, topSellersOnly, topSellerSkuSet],
  );

  const tableRows = useMemo(() => {
    if (selectedBin === null) return visibleRows;
    const bucketKey = RECOVERY_BUCKETS[selectedBin].key;
    return visibleRows.filter((r) => bucketOf(r) === bucketKey);
  }, [visibleRows, selectedBin]);

  const searchedRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tableRows;
    return tableRows.filter((r) => r.sku.toUpperCase().includes(q));
  }, [tableRows, search]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return searchedRows;
    const dir = sortDir === "asc" ? 1 : -1;
    const valueOf = (r: RecoveryRow): string | number => {
      switch (sortKey) {
        case "sku": return r.sku;
        case "baseline": return r.baseline;
        case "oosStartedOn": return r.oosStartedOn;
        case "restockDate": return r.restockDate;
        case "oosDays": return r.oosDays;
        case "daysToRecovery": return r.daysToRecovery ?? (sortDir === "asc" ? Infinity : -Infinity);
        case "severity": return SEVERITY_RANK[r.severity];
      }
    };
    return [...searchedRows].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      const cmp = typeof av === "string" || typeof bv === "string"
        ? String(av).localeCompare(String(bv))
        : (av as number) - (bv as number);
      return cmp * dir;
    });
  }, [searchedRows, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_ASC_KEYS.includes(key) ? "asc" : "desc");
    }
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  // Keyed instead of indexed: sorting/searching reorders the array without
  // changing its length, so an index-based "open row" would silently point at
  // the wrong row. Looking it up by key means it just closes if filtered out.
  const open = openKey ? sortedRows.find((r) => rowKey(r) === openKey) ?? null : null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setDrilldown(null);
      setDrilldownError(null);
      if (!open) return;
      setDrilldownLoading(true);
      try {
        const params = new URLSearchParams({ sku: open.sku, channel: open.channel, restockDate: open.restockDate });
        const res = await fetch(apiPath(`/api/planning/oos-impact/recovery/drilldown?${params}`));
        const json = await res.json() as { success: boolean; data?: Drilldown; error?: string };
        if (!json.success || !json.data) throw new Error(json.error ?? "Unknown error");
        if (!cancelled) setDrilldown(json.data);
      } catch (err) {
        if (!cancelled) setDrilldownError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setDrilldownLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.sku, open?.channel, open?.restockDate]);

  const recoveryBins = useMemo(
    () => RECOVERY_BUCKETS.map((def) => ({
      label: pick(def.ko, def.en),
      count: visibleRows.filter((r) => bucketOf(r) === def.key).length,
    })),
    [visibleRows, pick],
  );

  const confirmedDays = useMemo(
    () => visibleRows.map((r) => r.daysToRecovery).filter((n): n is number => n !== null),
    [visibleRows],
  );
  const neverRecoveredCount = useMemo(() => visibleRows.filter((r) => r.severity === "critical").length, [visibleRows]);
  const pendingCount = useMemo(() => visibleRows.filter((r) => r.severity === "serious").length, [visibleRows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="planning-panel flex flex-col gap-3 rounded-xl border p-4">
        <FilterRow label={pick("채널", "Channel")}>
          {MARKETPLACE_CHANNELS.map((ch) => (
            <Chip key={ch} active={channels.includes(ch)} onClick={() => toggle(ch)}>{CHANNEL_DISPLAY_LABELS[ch]}</Chip>
          ))}
        </FilterRow>
        <FilterRow label={pick("대상", "Scope")}>
          <Chip active>{pick("과거 품절 → 재입고 완료", "Past Stockout → Restocked")}</Chip>
          <Chip ghost title={pick("현재 품절 중인 상품은 회복 추이 계산 자체가 불가능해 제외", "Currently out-of-stock items are excluded — a recovery trend can't be calculated for them")}>
            {pick("현재 품절중 제외", "Excludes Currently Out of Stock")}
          </Chip>
          <Chip
            active={topSellersOnly}
            onClick={() => { setTopSellersOnly((v) => !v); setPage(1); }}
            title={
              topLoadError
                ? pick(`TOP 100 데이터 로드 실패: ${topLoadError}`, `Failed to load TOP 100 data: ${topLoadError}`)
                : topRows === null
                  ? pick("TOP 100 데이터 불러오는 중…", "Loading TOP 100 data…")
                  : pick("최근 30일 전체 채널(Shopify 포함) 판매량 기준 상위 100 Master SKU만", "Only the top 100 Master SKUs by trailing-30-day sales across all channels (Shopify included)")
            }
          >
            {pick("판매량 TOP 100 SKU만", "Top 100 Sellers Only")}
          </Chip>
        </FilterRow>
        <FilterRow label={pick("아이템", "Item")}>
          {ITEM_FILTERS.map((it) => (
            <Chip key={it} active={it === "전체" ? allItemsSelected : items.includes(it)} onClick={() => toggleItem(it)}>
              {it === "전체" ? pick("전체", "All") : it}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {loadError ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-destructive">
          {pick("재입고 회복 데이터 로드 실패", "Failed to load restock recovery data")}: {loadError}
        </div>
      ) : rows === null ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center gap-2 rounded-xl border text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {pick("재입고 회복 데이터 불러오는 중…", "Loading restock recovery data…")}
        </div>
      ) : channels.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          {pick("최소 하나의 채널을 선택하세요", "Select at least one channel")}
        </div>
      ) : items.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          {pick("최소 하나의 아이템을 선택하세요", "Select at least one item")}
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label={pick("재입고 추적 SKU", "SKUs Tracked")}
          value={String(visibleRows.length)}
          foot={topSellersOnly ? pick("선택된 채널 · 판매량 TOP 100 SKU 기준", "Selected channels · Top 100 sellers only") : pick("선택된 채널 기준", "Based on selected channels")}
        />
        <Kpi
          label={pick("평균 회복 소요일", "Avg. Days to Recovery")}
          value={confirmedDays.length ? String(Math.round(average(confirmedDays))) : "—"}
          unit={pick("일", "days")}
          foot={pick("회복 확정된 건 평균", "Average of confirmed recoveries")}
        />
        <Kpi
          label={pick("미회복 SKU", "Not Recovered")}
          value={String(neverRecoveredCount)}
          foot={pick(
            `전체의 ${visibleRows.length ? Math.round((neverRecoveredCount / visibleRows.length) * 100) : 0}% · 90일 내 회복 못함`,
            `${visibleRows.length ? Math.round((neverRecoveredCount / visibleRows.length) * 100) : 0}% of total · not recovered within 90 days`,
          )}
        />
        <Kpi label={pick("관찰중 SKU", "Pending")} value={String(pendingCount)} foot={pick("아직 90일 안 지나 판단 보류", "Fewer than 90 days have passed — not yet classified")} />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">
            {pick("재입고 후 경과일별 회복률", "Recovery Rate by Days Since Restock")} — {pick("스큐 비교", "SKU Comparison")}
          </h3>
        </div>
        <Histogram
          bins={recoveryBins}
          activeIndex={selectedBin}
          onBinClick={(i) => { setSelectedBin((prev) => (prev === i ? null : i)); setPage(1); }}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {pick(
            "회복까지 걸린 일수 기준 분포 — 막대를 클릭하면 아래 SKU별 상세가 해당 구간으로 필터링됩니다 · 같은 막대를 다시 클릭하면 해제됩니다.",
            "Distribution by days to recovery — click a bar to filter the SKU details below to that range · click the same bar again to clear the filter.",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            {pick("SKU별 상세", "SKU Details")} <span className="font-normal text-muted-foreground">— {pick(`${sortedRows.length}건 표시`, `${sortedRows.length} rows shown`)}</span>
          </span>
          <div className="relative flex min-w-[220px] items-center">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={pick("마스터 SKU 검색...", "Search Master SKU...")}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-foreground/40"
            />
          </div>
        </div>
        <p className="border-b border-border bg-muted/40 px-3.5 py-1.5 text-[10.5px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">{pick("상태 기준", "Status Criteria")}</span> — {pick(
            "정상 회복: 재입고 후 30일 이내 회복 · 느린 회복: 30~90일 이내 회복 · 관찰중: 재입고 후 아직 90일 안 지남 · 미회복: 90일이 지나도 회복 못함",
            "Normal Recovery: recovered within 30 days of restock · Slow Recovery: recovered within 30–90 days · Pending: fewer than 90 days since restock · Not Recovered: still not recovered after 90 days",
          )}
          <span className="ml-1 inline-flex items-center gap-1" title={pick("회복 = 트레일링 14일 평균 판매량이 품절 직전 기준선(baseline)의 이 % 이상에 도달", "Recovery = the trailing 14-day average sales reaches this % of the pre-stockout baseline")}>
            ({pick("회복 기준: 기준선의", "Recovery threshold: reaches")}
            <input
              type="number"
              min={50}
              max={100}
              step={1}
              value={thresholdDraft}
              onChange={(e) => setThresholdDraft(e.target.value)}
              onBlur={commitThresholdDraft}
              onKeyDown={(e) => { if (e.key === "Enter") { commitThresholdDraft(); (e.target as HTMLInputElement).blur(); } }}
              className="w-11 rounded border border-border bg-background px-1 py-0.5 text-center text-[10.5px] font-semibold text-foreground outline-none focus:border-foreground/40"
            />
            {pick("% 도달)", "% of baseline)")}
          </span>
          <span className="ml-1 inline-flex items-center gap-1" title={pick("재입고 후 이 일수가 지나기 전에 기준선에 도달해도 회복으로 인정하지 않음 — 재입고 직후 밀린 주문이 한꺼번에 풀리며 생기는 일시적 스파이크를 걸러내기 위함(13일 미만은 트레일링 14일 윈도우 특성상 허용 안 됨)", "Reaching the threshold before this many days have passed since restock doesn't count as recovery — this filters out temporary spikes from backlogged orders shipping all at once right after restock (values below 13 aren't allowed, since the trailing 14-day window can't validly be shorter than that)")}>
            ({pick("재입고 후", "Ignore recovery within")}
            <input
              type="number"
              min={13}
              max={89}
              step={1}
              value={minRecoveryDaysDraft}
              onChange={(e) => setMinRecoveryDaysDraft(e.target.value)}
              onBlur={commitMinRecoveryDaysDraft}
              onKeyDown={(e) => { if (e.key === "Enter") { commitMinRecoveryDaysDraft(); (e.target as HTMLInputElement).blur(); } }}
              className="w-11 rounded border border-border bg-background px-1 py-0.5 text-center text-[10.5px] font-semibold text-foreground outline-none focus:border-foreground/40"
            />
            {pick("일 이내 회복은 무시)", "days of restock)")}
          </span>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="bg-muted">
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={cn(
                      "cursor-pointer select-none whitespace-nowrap border-b border-border px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground",
                      col.right && "text-right",
                    )}
                  >
                    {pick(col.ko, col.en)}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={() => setOpenKey(openKey === rowKey(r) ? null : rowKey(r))}
                  className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted", openKey === rowKey(r) && "bg-muted")}
                >
                  <td className="px-3.5 py-2.5"><span className="font-mono font-semibold text-[#1238a0] dark:text-[#7aa2f7]">{r.sku}</span></td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.baseline.toFixed(1)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.oosStartedOn}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.restockDate}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{pick(`${r.oosDays}일`, `${r.oosDays}d`)}</td>
                  <td
                    className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono font-bold tabular-nums"
                    title={pick(
                      `재입고 후 트레일링 14일 평균이 기준선의 ${thresholdPct}%에 처음 도달한 날 — 90일 안에 도달 못하면 미회복(또는 아직 90일 전이면 관찰중)`,
                      `The first day the trailing 14-day average reached ${thresholdPct}% of baseline after restock — if not reached within 90 days it's Not Recovered (or Pending if still under 90 days)`,
                    )}
                  >
                    {daysToRecoveryLabel(r, pick)}
                  </td>
                  <td className="px-3.5 py-2.5"><SeverityPill severity={r.severity}>{r.label}</SeverityPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={clampedPage}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={RECOVERY_PAGE_SIZES}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      </div>

      <div className="planning-panel flex flex-col gap-3 rounded-xl border p-4 lg:sticky lg:top-4 lg:self-start">
        {!open ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <span>{pick("SKU별 상세에서 행을 클릭하면", "Click a row in SKU Details")}</span>
            <span>{pick("재입고 후 일별 판매량 그래프가 여기에 표시됩니다.", "and the daily post-restock sales chart will appear here.")}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-sm font-semibold">{open.sku}</span>
              </div>
              <button type="button" onClick={() => setOpenKey(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">{pick("닫기", "Close")}</button>
            </div>
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{pick("일별 판매량(실측) vs 품절 직전 기준선", "Daily Sales (Actual) vs. Pre-Stockout Baseline")}</span>
              <div className="flex items-center gap-1.5">
                <Chip active={drilldownMode === "trailing"} onClick={() => setDrilldownMode("trailing")}>{pick("트레일링 14일 평균", "Trailing 14-Day Avg.")}</Chip>
                <Chip active={drilldownMode === "daily"} onClick={() => setDrilldownMode("daily")}>{pick("하루 판매량", "Daily Sales")}</Chip>
              </div>
            </div>
            {drilldownLoading ? (
              <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {pick("드릴다운 데이터 불러오는 중…", "Loading drilldown data…")}
              </div>
            ) : drilldownError ? (
              <div className="flex min-h-[160px] items-center justify-center text-sm text-destructive">
                {pick("드릴다운 데이터 로드 실패", "Failed to load drilldown data")}: {drilldownError}
              </div>
            ) : drilldown && drilldown.points.length > 0 ? (
              <>
                <LineChart
                  xs={drilldown.points.map((p) => p.dayOffset)}
                  xTicks={[...new Set([
                    drilldown.points[0].dayOffset, 0, 30, 60, 90, drilldown.points[drilldown.points.length - 1].dayOffset,
                  ].filter((t) => t >= drilldown.points[0].dayOffset && t <= drilldown.points[drilldown.points.length - 1].dayOffset))]}
                  xUnit="d"
                  yMin={0} yMax={Math.max(drilldown.baseline * 1.15, ...drilldown.points.map((p) => (drilldownMode === "trailing" ? p.value : p.qty) * 1.15), 1)}
                  yTicks={[0, Math.round(drilldown.baseline / 2), Math.round(drilldown.baseline)]}
                  refValue={drilldown.baseline} refLabel={`${pick("기준선", "Baseline")} ${drilldown.baseline.toFixed(1)}/day`}
                  markers={[
                    { at: 0, label: pick("재입고", "Restock") },
                    ...(open.daysToRecovery !== null
                      ? [{ at: open.daysToRecovery, label: pick(`회복(${open.daysToRecovery}일)`, `Recovery (${open.daysToRecovery}d)`), color: "var(--chart-aqua)" }]
                      : []),
                  ]}
                  series={[{
                    data: drilldown.points.map((p) => (drilldownMode === "trailing" ? p.value : p.qty)),
                    color: "var(--chart-blue)", area: true,
                    endLabel: drilldownMode === "trailing"
                      ? `${drilldown.points[drilldown.points.length - 1].value.toFixed(1)}/day`
                      : pick(`${drilldown.points[drilldown.points.length - 1].qty}개`, `${drilldown.points[drilldown.points.length - 1].qty} units`),
                  }]}
                  height={360}
                />
                <p className="text-[11px] text-muted-foreground">
                  {drilldownMode === "trailing"
                    ? pick(
                        "트레일링 14일 평균 판매량(실측, 판매 있었던 날짜만 표시) — 회복 판정에 쓰이는 것과 동일한 값이라 \"회복\" 마커가 실제로 기준선을 넘는 지점과 일치합니다.",
                        "Trailing 14-day average sales (actual, shown only for days with a sale) — this is the exact value used to determine recovery, so the \"Recovery\" marker lines up with where the line actually crosses the baseline.",
                      )
                    : pick(
                        "하루치 실측 판매량(판매 있었던 날짜만 표시) — 하루 단위라 주문이 몰리거나 0건인 날 때문에 들쭉날쭉할 수 있음. 회복 판정은 이 값이 아니라 왼쪽의 트레일링 14일 평균으로 계산됩니다.",
                        "Actual daily sales quantity (shown only for days with a sale) — being day-by-day, it can swing due to order bursts or zero-sale days. Recovery itself is calculated from the trailing 14-day average, not this value.",
                      )}
                </p>
                <div className="overflow-hidden rounded-lg border border-border">
                  {([
                    [pick("재입고 후 경과일", "Days Since Restock"), String(open.daysSinceRestock)],
                    [pick("직전 품절 기간", "Previous Stockout Days"), String(open.oosDays)],
                    [pick("회복까지 걸린 일수", "Days to Recovery"), daysToRecoveryLabel(open, pick)],
                    [pick("회복 결과", "Recovery Outcome"), open.label],
                    [pick("재입고 후 0~30일 평균", "Days 0–30 Avg."), `${num1(open.day0to30)}/day`],
                    [pick("재입고 후 30~60일 평균", "Days 30–60 Avg."), `${num1(open.day30to60)}/day`],
                    [pick("재입고 후 60~90일 평균", "Days 60–90 Avg."), `${num1(open.day60to90)}/day`],
                    [pick("품절 직전 기준 수요", "Pre-Stockout Baseline Demand"), `${open.baseline.toFixed(2)}/day`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0">
                      <span className="text-[11px] font-medium text-muted-foreground">{k}</span>
                      <span className="font-semibold tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : drilldown ? (
              <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                {pick("이 기간에 실제 판매 데이터가 없습니다.", "No actual sales data in this period.")}
              </div>
            ) : null}
          </>
        )}
      </div>
      </div>
      </>
      )}

    </div>
  );
}
