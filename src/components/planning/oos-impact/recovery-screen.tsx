"use client";

// Code Guide: Screen 2 — marketplace (Amazon/eBay/Walmart) restock recovery.
// "스큐 비교" (histogram + table) is wired to real data via
// /api/planning/oos-impact/recovery (+ /recovery/drilldown for the per-row
// chart). "채널 비교" (the line chart) still uses sample RECOVERY_SERIES —
// it needs a separate time-series aggregation design, tracked as follow-up.
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
  Chip, FilterRow, Histogram, Kpi, LineChart, PAGE_SIZES, Pagination, SeverityPill, SortIcon,
  average, type LineSeries, type Severity, type SortDir,
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

const RECOVERY_XS = [0, 15, 30, 45, 60, 75, 90, 105, 120];
const RECOVERY_SERIES = {
  overall: [0, 22, 46, 58, 64, 71, 78, 83, 87],
  amazon: [0, 25, 50, 62, 68, 75, 82, 87, 91],
  ebay: [0, 12, 28, 38, 45, 52, 60, 66, 71],
  walmart: [0, 30, 58, 72, 80, 86, 91, 94, 96],
};

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
  const [chartView, setChartView] = useState<"channel" | "sku">("sku");
  const [selectedBin, setSelectedBin] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1]);

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
    if (chartView !== "sku" || selectedBin === null) return visibleRows;
    const bucketKey = RECOVERY_BUCKETS[selectedBin].key;
    return visibleRows.filter((r) => bucketOf(r) === bucketKey);
  }, [visibleRows, chartView, selectedBin]);

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

  const showAmazon = channels.includes("Amazon FBA") || channels.includes("Amazon FBM");
  const showEbay = channels.includes("Auto_Armor") || channels.includes("Advance_Parts");
  const showWalmart = channels.includes("Walmart");

  const recoverySeries = useMemo(() => {
    const s: LineSeries[] = [];
    if (showAmazon) s.push({ data: RECOVERY_SERIES.amazon, color: "var(--chart-blue)", endLabel: "91%" });
    if (showEbay) s.push({ data: RECOVERY_SERIES.ebay, color: "var(--chart-orange)", endLabel: "71%" });
    if (showWalmart) s.push({ data: RECOVERY_SERIES.walmart, color: "var(--chart-aqua)", endLabel: "96%" });
    if (s.length > 0) s.unshift({ data: RECOVERY_SERIES.overall, color: "var(--foreground)", dashed: true });
    return s;
  }, [showAmazon, showEbay, showWalmart]);

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
            {pick("재입고 후 경과일별 회복률", "Recovery Rate by Days Since Restock")} — {chartView === "channel" ? pick("채널 비교", "Channel Comparison") : pick("스큐 비교", "SKU Comparison")}
          </h3>
          <div className="flex items-center gap-1.5">
            <Chip active={chartView === "channel"} onClick={() => { setChartView("channel"); setPage(1); }}>{pick("채널 비교", "Channel Comparison")}</Chip>
            <Chip active={chartView === "sku"} onClick={() => { setChartView("sku"); setPage(1); }}>{pick("스큐 비교", "SKU Comparison")}</Chip>
            {chartView === "channel" && (
              <span className="rounded-md border border-dashed border-border px-2 py-1 text-[10.5px] font-medium text-muted-foreground" title={pick("채널별 회복 곡선은 아직 샘플 데이터입니다 — 시계열 집계 설계가 필요해 다음 단계로 예정", "The per-channel recovery curve is still sample data — it needs a time-series aggregation design, planned as a follow-up")}>
                {pick("샘플 데이터", "Sample Data")}
              </span>
            )}
          </div>
        </div>
        {chartView === "channel" ? (
          <>
            <LineChart
              xs={RECOVERY_XS} xTicks={[0, 30, 60, 90, 120]} xUnit="d"
              yMin={0} yMax={100} yTicks={[0, 25, 50, 75, 100]} yUnit="%"
              refValue={100} refLabel={pick("정상 수요 기준선", "Normal Demand Baseline")}
              series={recoverySeries}
            />
            <div className="mt-1.5 flex flex-wrap gap-4 text-[11px] text-foreground/80">
              <span className="flex items-center gap-1.5"><span className="h-0 w-3.5 border-t-2 border-dashed border-foreground" />{pick("전체 평균", "Overall Average")}</span>
              {showAmazon && <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded bg-[var(--chart-blue)]" />Amazon</span>}
              {showEbay && <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded bg-[var(--chart-orange)]" />eBay</span>}
              {showWalmart && <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded bg-[var(--chart-aqua)]" />Walmart</span>}
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
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

      <div className="planning-panel flex flex-col gap-2 rounded-xl border p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{pick("설계 노트", "Design Notes")}</h4>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-foreground/80">
          <li>{pick(
            "\"현재 품절중 제외\"가 기본 고정 — 대상 정의(과거 품절 → 재입고 완료 건만)를 필터가 아니라 규칙으로 강제. SKU마다 가장 최근 품절 사이클 하나만 보고, 그게 아직 재입고 전(현재 품절중)이면 그 SKU는 통째로 제외 — 예전엔 SKU가 2번 이상 품절된 적 있으면 이미 지나간 예전 재입고 기록이 새어나와 지금 다시 품절중인 SKU도 표에 보이던 버그가 있었음.",
            "\"Excludes Currently Out of Stock\" is a fixed rule, not a toggle — it enforces the scope definition (past stockout → restocked only) as a hard rule rather than an optional filter. Only each SKU's single most recent stockout cycle is considered; if that cycle hasn't restocked yet (currently out of stock), the SKU is excluded entirely — previously, a SKU with 2+ stockout cycles could leak an old, already-superseded restock record, making a SKU that's out of stock again today still show up in the table.",
          )}</li>
          <li>{pick(
            "\"아이템\" 필터(Car Cover/Seat Cover/Floor Mat/SWC)는 preorder-screen과 동일한 item_category 값을 그대로 사용 — fc_velocity_*_snapshot 각 행에 동기화 시점에 미리 계산돼 저장된 컬럼이라 별도 조회 없이 바로 필터링 가능. 이 4개 카테고리 밖(Miscellaneous)은 preorder-screen과 마찬가지로 표시 대상에서 제외됨. (원래 이 자리엔 클릭이 안 되는 장식용 \"직전 품절\" 필터가 있었는데, 실제로 연결된 적이 없어서 아이템 필터로 교체함.)",
            "The \"Item\" filter (Car Cover/Seat Cover/Floor Mat/SWC) reuses the exact same item_category values as preorder-screen — it's precomputed onto each fc_velocity_*_snapshot row at sync time, so no extra lookup is needed to filter by it. Same as preorder-screen, anything outside these 4 categories (Miscellaneous) is excluded from view. (This slot used to hold a \"Previous Stockout\" filter that looked clickable but was never actually wired to anything, so it was replaced with the item filter.)",
          )}</li>
          <li>{pick(
            "상태 pill은 항상 아이콘 + 텍스트 + 숫자를 같이 표시 — 색만으로 판단하지 않도록 함.",
            "The status pill always shows an icon + text + number together — so it's never judged by color alone.",
          )}</li>
          <li>
            {pick(
              `이 탭의 목적은 "재입고 후 회복이 느린/안 된 SKU"를 찾는 것이라, 핵심 지표는 회복까지 걸린 일수(daysToRecovery) — 재입고 후 트레일링 14일 평균이 기준선의 ${thresholdPct}%에 처음 도달한 날. 90일 안에 도달 못하면 경과일이 90일 미만이면 "관찰중", 90일을 넘겼으면 "미회복"으로 확정(가장 타격이 큰 케이스). 예전엔 "오늘 기준 최근 14일" 현재 판매 상태로 상태/히스토그램을 계산했는데, 그건 회복 속도와 무관한 다른 질문(지금 잘 팔리냐)이라 완전히 제거함.`,
              `This tab's purpose is to find SKUs whose post-restock recovery was slow or never happened, so the core metric is Days to Recovery (daysToRecovery) — the first day the trailing 14-day average reaches ${thresholdPct}% of baseline after restock. If not reached within 90 days: "Pending" while under 90 days since restock, or confirmed as "Not Recovered" once past 90 days (the most damaging, confirmed case). This used to be calculated from "the last 14 days as of today" current sales health instead, which is a different question unrelated to recovery speed (is it selling well right now) — that's been removed entirely.`,
            )}
          </li>
          <li>{pick(
            "회복 기준(기준선 대비 %)과 \"재입고 후 며칠 이내 회복은 무시\"(기본 13일 = 트레일링 14일 윈도우가 재입고 이전으로 넘어가지 않는 최소값)는 둘 다 \"SKU별 상세\" 표 위 범례에서 직접 조정 가능 — 값을 바꾸면 서버에 새 기준으로 재조회해서 daysToRecovery/상태/히스토그램/KPI가 전부 다시 계산됨. 무시 일수를 올리는 이유: 재입고 직후엔 밀린 주문이 한꺼번에 풀리며 트레일링 평균이 잠깐 기준선을 넘는 경우가 있는데, 이건 진짜 회복이 아니라 일시적 스파이크라 그 기간의 도달은 무시하고 그 이후 처음 도달한 날을 찾음. 둘 다 저장되는 설정이 아니라 새로고침하면 기본값(80%/13일)으로 돌아감.",
            "Both the recovery threshold (% of baseline) and \"ignore recovery within N days of restock\" (default 13 days — the minimum below which the trailing 14-day window would reach before restock) are adjustable directly in the legend above SKU Details — changing either refetches from the server with the new setting, recalculating daysToRecovery/status/histogram/KPIs across the board. Why raise the ignore-days value: right after restock, backlogged orders can ship all at once, briefly pushing the trailing average over baseline — that's a temporary spike, not real recovery, so any crossing within that window is ignored and the search looks for the first crossing after it instead. Neither setting is saved — reloading the page resets both to their defaults (80% / 13 days).",
          )}</li>
          <li>{pick(
            "재입고 후 30/30~60/60~90일 하루 평균(겹치지 않는 구간)은 표 컬럼에서 빼고 오른쪽 드릴다운 패널의 변수 목록으로 옮김 — 회복까지 걸린 일수라는 단일 지표가 이미 있어서 표에서는 중복이고, 필요할 때(행 클릭 시) 그래프와 함께 보는 게 더 유용함. 채널 컬럼은 표에서 뺐지만 한 SKU가 채널별로 여러 행에 나올 수 있음(내부적으로는 SKU+채널+재입고일로 구분).",
            "The 0–30/30–60/60–90-day post-restock daily averages (non-overlapping windows) were moved out of the table columns into the drilldown panel's variable list on the right — with Days to Recovery already as the single headline metric, they'd be redundant in the table, and are more useful alongside the chart when needed (on row click). The channel column was dropped from the table, but one SKU can still appear as multiple rows across channels (internally keyed by SKU + channel + restock date).",
          )}</li>
          <li>{pick(
            "히스토그램은 0-100% 연속 분포가 아니라 \"0–30일/30–60일/60–90일/관찰중/미회복\" 이산 카테고리라 중앙값 선 없이 막대 개수만 표시 (Histogram 컴포넌트의 medianValue 등은 optional로 바꿔서 preorder-screen의 %기반 히스토그램과 공유).",
            "The histogram is a discrete category distribution (\"0–30d/30–60d/60–90d/Pending/Not Recovered\"), not a continuous 0–100% scale, so it shows only bar counts with no median line (the Histogram component's medianValue etc. were made optional so it's shared with preorder-screen's percent-based histogram).",
          )}</li>
          <li>{pick(
            "SKU별 상세는 열 헤더 클릭으로 정렬(다시 클릭 시 역순), SKU 검색으로 필터링, 페이지네이션(25/50/100개씩)까지 지원 — 열려있던 드릴다운 행은 SKU/채널/재입고일 키로 추적해 정렬·검색·페이지 이동과 무관하게 같은 행을 계속 가리키고, 필터에서 벗어나면 자동으로 닫힘.",
            "SKU Details supports click-to-sort column headers (click again to reverse), SKU search filtering, and pagination (25/50/100 rows) — an open drilldown row is tracked by its SKU/channel/restock-date key, so it keeps pointing at the same row through sorting, searching, and page changes, and closes automatically if it falls outside the current filter.",
          )}</li>
          <li>{pick(
            "드릴다운은 표 아래로 펼치지 않고 오른쪽에 고정 패널로 배치(넓은 화면 기준) — 행을 클릭해도 페이지가 밀리지 않고, 스크롤해도 패널이 따라와서 여러 SKU를 훑어보며 그래프를 바로바로 확인하기 편함. 좁은 화면(lg 미만)에서는 표 아래로 쌓임.",
            "The drilldown doesn't expand below the table — it's a fixed panel on the right (on wide screens), so clicking a row doesn't push the page down, and the panel follows on scroll, making it easy to skim multiple SKUs and check their charts one after another. On narrow screens (below lg) it stacks below the table instead.",
          )}</li>
          <li>{pick(
            "\"판매량 TOP 100 SKU만\" 필터(대상 행) — 품절/재입고 이력과 무관하게 Master SKU 단위·전체 채널(Shopify 포함)·최근 30일 판매량 기준 상위 100 SKU로만 회복 추적 대상을 좁힘. 채널 비교/스큐 비교 두 뷰 모두에 공통 적용되며, KPI·히스토그램·표가 전부 필터링된 집합 기준으로 갱신됨. link/custom 스냅샷 중복 집계 방지 로직(카테고리 기준 소스 택일)은 이 필터의 판매량 집계 API(top-sellers)에도 동일하게 적용됨.",
            "The \"Top 100 Sellers Only\" filter (in the Scope row) narrows recovery tracking down to the top 100 Master SKUs by trailing-30-day sales across all channels (Shopify included), independent of stockout/restock history. It applies uniformly to both the Channel Comparison and SKU Comparison views, and the KPIs, histogram, and table all update to the filtered set. The same double-count prevention logic (picking one source per category) used elsewhere also applies to this filter's sales aggregation API (top-sellers).",
          )}</li>
          <li>{pick(
            "드릴다운 그래프는 기본으로 판매 있었던 날짜별 트레일링 14일 평균을 그림(daysToRecovery 계산과 완전히 같은 값) — 예전엔 -30/-15/0/15/30/60/90 지점에 재입고일부터의 누적 평균을 찍어서, 그래프가 기준선을 넘는 것처럼 보이는 지점과 실제 회복 판정일이 전혀 대응되지 않았음. \"회복\" 마커를 daysToRecovery 지점에 정확히 찍어서 눈으로 검증 가능하게 함. \"하루 판매량\" 토글로 트레일링 평균 대신 그날그날 실제 판매 개수(노이즈 큰 원본 값)도 볼 수 있음 — 회복 판정 자체는 항상 트레일링 평균 기준. (구현 메모: 소스 뷰가 UTC/LA 타임존 경계에서 하루를 두 행으로 나눌 때가 있어, 날짜별로 먼저 GROUP BY 합산한 뒤 그 위에서 트레일링 평균을 계산 — 이래야 하루 판매량도 정확히 합산되고 트레일링 값도 중복 없이 하루 한 점으로 나옴.)",
            "By default, the drilldown chart plots the trailing 14-day average for each date with a sale (the exact value used in the daysToRecovery calculation) — previously it plotted cumulative-from-restock averages at fixed -30/-15/0/15/30/60/90 points, which didn't correspond to any single day's actual recovery reading, so the point where the line crossed the baseline never lined up with the real recovery date. The \"Recovery\" marker is now placed exactly at the daysToRecovery point so it can be verified visually. A \"Daily Sales\" toggle shows the raw, noisier day-by-day quantity instead of the trailing average — but recovery itself is always determined from the trailing average. (Implementation note: the source view sometimes splits one calendar day's orders into two rows at the UTC/LA timezone boundary, so quantities are summed per date via GROUP BY first, then the trailing average is computed on top of that — this both sums daily quantity correctly and gives one trailing-average point per day with no duplicates.)",
          )}</li>
        </ul>
      </div>
    </div>
  );
}
