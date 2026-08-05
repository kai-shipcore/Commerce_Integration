"use client";

// Code Guide: Screen 1 — Shopify Pre-Order conversion drop rate.
// Reads real OOS episodes + Custom velocity data from the preorder API.
// Only touch shared.tsx for things this file and recovery-screen.tsx both need.

import { useEffect, useState } from "react";
import { Clock, PackageCheck, Search, TrendingDown, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  Chip, FilterRow, Histogram, Kpi, LineChart, PAGE_SIZES, PERCENT_BUCKETS, Pagination, SeverityPill, SortIcon,
  average, histogramFrom, median, medianExplanation, type PercentBucket, type Severity, type SortDir,
} from "./shared";

// normalRange ends the day before convDate; poRange starts at convDate.
// Both use the same available window length, capped at 30 days.
interface Row1 {
  id: string;
  sku: string;
  itemCategory: string;
  channel: string;
  normalRange: string;
  windowDays: number;
  normalQty: number;
  pre: number;
  convDate: string;
  restockDate: string | null;
  poRange: string;
  preorderQty: number;
  post: number;
  drop: number;
  severity: Severity;
  stage: "active" | "ended";
}

interface PreorderApiRow {
  id: string;
  sku: string;
  itemCategory: string;
  channel: string;
  normalStart: string;
  normalEnd: string;
  preorderStart: string;
  preorderEnd: string;
  conversionDate: string;
  restockDate: string | null;
  windowDays: number;
  normalQty: number;
  preorderQty: number;
  normalDailyAverage: number;
  preorderDailyAverage: number;
  dropRate: number;
  severity: Severity;
  stage: "active" | "ended";
}

function shortDate(value: string) {
  const [, month = "", day = ""] = value.slice(0, 10).split("-");
  return `${month}/${day}`;
}

function demandChartScale(normalDailyAverage: number, preorderDailyAverage: number) {
  const peak = Math.max(normalDailyAverage, preorderDailyAverage);
  if (peak <= 0) return { max: 1, ticks: [0, 0.5, 1] };
  const max = Number((peak * 1.25).toPrecision(2));
  return {
    max,
    ticks: [0, Number((max / 2).toPrecision(2)), max],
  };
}

function toScreenRow(row: PreorderApiRow): Row1 {
  return {
    id: row.id,
    sku: row.sku,
    itemCategory: row.itemCategory,
    channel: row.channel,
    normalRange: `${shortDate(row.normalStart)} – ${shortDate(row.normalEnd)}`,
    windowDays: row.windowDays,
    normalQty: row.normalQty,
    pre: row.normalDailyAverage,
    convDate: row.conversionDate,
    restockDate: row.restockDate,
    poRange: `${shortDate(row.preorderStart)} – ${shortDate(row.preorderEnd)}`,
    preorderQty: row.preorderQty,
    post: row.preorderDailyAverage,
    drop: row.dropRate,
    severity: row.severity,
    stage: row.stage,
  };
}

// 진행 상태(Pre-Order 진행중 / 재입고 완료)는 감소율 심각도와는 다른 축이라
// 색을 넣지 않고 중립 태그로 분리해서 표시한다.
function StageTag({ stage }: { stage: Row1["stage"] }) {
  const { pick } = useI18n();
  const Icon = stage === "active" ? Clock : PackageCheck;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
      <Icon className="h-3 w-3" />
      {stage === "active"
        ? pick("진행중", "Active")
        : pick("재입고 완료", "Restocked")}
    </span>
  );
}

const SHOPIFY_CHANNELS = ["Coverland B2C", "Coverland B2B", "Icarcover"] as const;
const ITEM_CATEGORIES = ["Car Cover", "Seat Cover", "Floor Mat", "SWC"] as const;
const ITEM_FILTERS = ["전체", ...ITEM_CATEGORIES] as const;
const MIN_ANALYSIS_WINDOW_DAYS = 14;
const MIN_BASELINE_DAILY_AVERAGE = 1;

type SortKey = "sku" | "normalRange" | "windowDays" | "pre" | "poRange" | "post" | "drop" | "stage";
type StageFilter = "all" | Row1["stage"];
type KpiFilter = "reliable" | "completed" | "active" | "maxImpact";

function isReliableAnalysisRow(row: Row1) {
  return row.windowDays >= MIN_ANALYSIS_WINDOW_DAYS && row.pre >= MIN_BASELINE_DAILY_AVERAGE;
}

function lostDailyAverage(row: Row1) {
  return Math.max(0, row.pre - row.post);
}

function histogramMedianPosition(value: number, buckets: PercentBucket[]) {
  const index = buckets.findIndex((bucket) => value >= bucket.min && value < bucket.max);
  if (index < 0) return value < buckets[0].min ? 0 : 1;
  const bucket = buckets[index];
  const fraction = Number.isFinite(bucket.min) && Number.isFinite(bucket.max)
    ? Math.min(1, Math.max(0, (value - bucket.min) / (bucket.max - bucket.min)))
    : 0.5;
  return (index + fraction) / buckets.length;
}

// Columns whose first click sorts ascending (text/date-like); numeric columns
// default to descending so the most extreme values surface first.
const DEFAULT_ASC_KEYS: SortKey[] = ["sku", "normalRange", "poRange", "stage"];
const STAGE_RANK: Record<Row1["stage"], number> = { active: 0, ended: 1 };

const TABLE_COLUMNS: { key?: SortKey; ko: string; en: string; right?: boolean }[] = [
  { key: "sku", ko: "Master SKU", en: "Master SKU" },
  { key: "normalRange", ko: "정상판매 구간", en: "Normal Sales Period" },
  { key: "windowDays", ko: "비교 기간", en: "Window", right: true },
  { key: "pre", ko: "정상 일평균", en: "Normal Daily Avg.", right: true },
  { key: "poRange", ko: "Pre-Order 구간", en: "Pre-Order Period" },
  { key: "post", ko: "PO 일평균", en: "PO Daily Avg.", right: true },
  { key: "drop", ko: "감소율", en: "Drop Rate", right: true },
  { key: "stage", ko: "진행 상태", en: "Stage", right: true },
];

function sortValueOf(r: Row1, key: SortKey): string | number {
  switch (key) {
    case "sku": return r.sku;
    case "normalRange": return r.normalRange;
    case "windowDays": return r.windowDays;
    case "pre": return r.pre;
    case "poRange": return r.poRange;
    case "post": return r.post;
    case "drop": return r.drop;
    case "stage": return STAGE_RANK[r.stage];
  }
}

export function PreorderScreen() {
  const { pick, locale } = useI18n();
  const [items, setItems] = useState<string[]>([...ITEM_CATEGORIES]);
  const [channels, setChannels] = useState<string[]>([...SHOPIFY_CHANNELS]);
  const [rows, setRows] = useState<Row1[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBin, setSelectedBin] = useState<number | null>(null);
  const [kpiFilter, setKpiFilter] = useState<KpiFilter | null>(null);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  useEffect(() => {
    let cancelled = false;

    fetch(apiPath("/api/planning/oos-impact/preorder"))
      .then(async (response) => {
        const json = await response.json() as { success: boolean; data?: PreorderApiRow[]; error?: string };
        if (!response.ok || !json.success) throw new Error(json.error ?? `HTTP ${response.status}`);
        return json.data ?? [];
      })
      .then((data) => {
        if (!cancelled) setRows(data.map(toScreenRow));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : pick("데이터를 불러오지 못했습니다.", "Failed to load data."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pick]);

  const toggleChannel = (channel: string) => {
    setChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel]);
    setSelectedBin(null);
    setKpiFilter(null);
    setOpenKey(null);
    setPage(1);
  };

  const toggleItem = (item: string) => {
    setItems((current) => {
      if (item === "전체") {
        return current.length === ITEM_CATEGORIES.length ? [] : [...ITEM_CATEGORIES];
      }
      return current.includes(item) ? current.filter((value) => value !== item) : [...current, item];
    });
    setSelectedBin(null);
    setKpiFilter(null);
    setOpenKey(null);
    setPage(1);
  };

  const allItemsSelected = items.length === ITEM_CATEGORIES.length;
  const scopedRows = rows.filter((row) =>
    channels.includes(row.channel) && items.includes(row.itemCategory),
  );
  const reliableScopedRows = scopedRows.filter(isReliableAnalysisRow);
  const activeRows = reliableScopedRows.filter((row) => row.stage === "active");
  const completedRows = reliableScopedRows.filter((row) => row.stage === "ended");
  const visibleRows = stageFilter === "all" ? scopedRows : scopedRows.filter((row) => row.stage === stageFilter);
  const reliableVisibleRows = visibleRows.filter(isReliableAnalysisRow);
  const percentBuckets: PercentBucket[] = [
    { label: pick("판매 증가", "Sales increase"), min: Number.NEGATIVE_INFINITY, max: 0 },
    ...PERCENT_BUCKETS,
  ];
  const maxImpactRow = reliableVisibleRows.length
    ? reliableVisibleRows.reduce((current, candidate) => {
        const impactDifference = lostDailyAverage(candidate) - lostDailyAverage(current);
        if (impactDifference !== 0) return impactDifference > 0 ? candidate : current;
        if (candidate.drop !== current.drop) return candidate.drop > current.drop ? candidate : current;
        return candidate.windowDays > current.windowDays ? candidate : current;
      })
    : null;
  const chartRows = kpiFilter === "completed"
    ? reliableScopedRows.filter((row) => row.stage === "ended")
    : kpiFilter === "active"
      ? reliableScopedRows.filter((row) => row.stage === "active")
      : kpiFilter === "maxImpact"
        ? (maxImpactRow ? [maxImpactRow] : [])
        : reliableVisibleRows;
  const drops = chartRows.map((r) => r.drop);
  const bins = histogramFrom(drops, percentBuckets);
  const medianDrop = median(drops);
  const medianDetail = medianExplanation(drops, locale);
  const statusSummary = stageFilter === "all"
    ? pick("전체", "All")
    : stageFilter === "active"
      ? pick("Pre-Order 진행중", "Pre-Order Active")
      : pick("재입고 완료", "Restocked");
  const metricValue = (metricRows: Row1[], metric: "average" | "median") => {
    if (!metricRows.length) return "—";
    const values = metricRows.map((row) => row.drop);
    return String(Math.round(metric === "average" ? average(values) : median(values)));
  };

  const tableRows = selectedBin === null
    ? (kpiFilter === null ? visibleRows : chartRows)
    : chartRows.filter((row) => {
        const bucket = percentBuckets[selectedBin];
        return row.drop >= bucket.min && row.drop < bucket.max;
      });

  const selectKpiFilter = (nextFilter: KpiFilter) => {
    const clearing = kpiFilter === nextFilter;
    setKpiFilter(clearing ? null : nextFilter);
    setSelectedBin(null);
    setSearch("");
    setPage(1);

    if (clearing) {
      if (nextFilter === "completed" || nextFilter === "active") setStageFilter("all");
      setOpenKey(null);
      return;
    }
    if (nextFilter === "completed") setStageFilter("ended");
    if (nextFilter === "active") setStageFilter("active");
    setOpenKey(nextFilter === "maxImpact" ? maxImpactRow?.id ?? null : null);
  };

  const searchQuery = search.trim().toUpperCase();
  const searchedRows = searchQuery
    ? tableRows.filter((r) => r.sku.toUpperCase().includes(searchQuery))
    : tableRows;

  const sortedRows = sortKey
    ? [...searchedRows].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        const av = sortValueOf(a, sortKey), bv = sortValueOf(b, sortKey);
        const cmp = typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
        return cmp * dir;
      })
    : searchedRows;

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
  const open = openKey ? sortedRows.find((r) => r.id === openKey) ?? null : null;
  const openChartScale = open ? demandChartScale(open.pre, open.post) : null;
  const openChartDays = Math.max(1, open?.windowDays ?? 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="planning-panel flex flex-col gap-3 rounded-xl border p-4">
        <FilterRow label={pick("아이템", "Item")}>
          {ITEM_FILTERS.map((it) => (
            <Chip key={it} active={it === "전체" ? allItemsSelected : items.includes(it)} onClick={() => toggleItem(it)}>
              {it === "전체" ? pick("전체", "All") : it}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label={pick("채널", "Channel")}>
          {SHOPIFY_CHANNELS.map((ch) => (
            <Chip key={ch} active={channels.includes(ch)} onClick={() => toggleChannel(ch)}>{ch}</Chip>
          ))}
          <Chip ghost title={pick("Pre-Order는 Shopify 전용 기능이라 다른 채널은 이 화면 대상이 아님", "Pre-Order is Shopify-only, so marketplaces are excluded from this analysis.")}>
            {pick("Amazon / eBay / Walmart 해당 없음", "Amazon / eBay / Walmart not applicable")}
          </Chip>
        </FilterRow>
        <FilterRow label={pick("상태", "Status")}>
          {(
            [
              ["all", pick("전체", "All")],
              ["active", pick("Pre-Order 진행중", "Pre-Order Active")],
              ["ended", pick("재입고 완료", "Restocked")],
            ] as [StageFilter, string][]
          ).map(([value, label]) => (
            <Chip
              key={value}
              active={stageFilter === value}
              onClick={() => {
                setStageFilter(value);
                setSelectedBin(null);
                setKpiFilter(null);
                setOpenKey(null);
                setPage(1);
              }}
            >
              {label}
            </Chip>
          ))}
          <span className="text-[11px] text-muted-foreground">
            {pick("진행중은 잠정치 · 재입고 완료는 확정치", "Active records are preliminary · restocked records are final")}
          </span>
        </FilterRow>
      </div>

      {loading ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          {pick("실제 품절·Pre-Order 데이터를 불러오는 중입니다...", "Loading actual stockout and Pre-Order data...")}
        </div>
      ) : loadError ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border border-red-200 px-6 text-center text-sm text-red-700 dark:border-red-900 dark:text-red-300">
          {pick("데이터를 불러오지 못했습니다:", "Failed to load data:")} {loadError}
        </div>
      ) : items.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          {pick("최소 하나의 아이템을 선택하세요", "Select at least one item")}
        </div>
      ) : channels.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          {pick("최소 하나의 채널을 선택하세요", "Select at least one channel")}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border px-6 text-center text-sm text-muted-foreground">
          {pick("선택한 아이템·채널·상태 조건에 해당하는 품절 전환 데이터가 없습니다.", "No stockout conversion data matches the selected items, channels, and status.")}
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label={pick("신뢰 분석 대상 SKU", "Reliable SKUs Analyzed")}
          value={reliableVisibleRows.length.toLocaleString("en-US")}
          active={kpiFilter === "reliable"}
          onClick={() => selectKpiFilter("reliable")}
          foot={
            <span className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
              <span className="font-semibold text-foreground">
                {pick(
                  `전체 ${visibleRows.length.toLocaleString("en-US")}건 중 · ${MIN_ANALYSIS_WINDOW_DAYS}일 이상 · 정상 ${MIN_BASELINE_DAILY_AVERAGE}개 / 일 이상`,
                  `${visibleRows.length.toLocaleString("en-US")} total · ${MIN_ANALYSIS_WINDOW_DAYS}+ days · normal ${MIN_BASELINE_DAILY_AVERAGE}+ unit / day`,
                )}
              </span>
              <span className="grid min-w-0 grid-cols-[46px_1fr] items-start gap-2">
                <span className="font-semibold text-muted-foreground">{pick("아이템", "Item")}</span>
                <span className="min-w-0 break-words font-semibold text-foreground">{allItemsSelected ? pick("전체", "All") : items.join(", ")}</span>
              </span>
              <span className="grid min-w-0 grid-cols-[46px_1fr] items-start gap-2">
                <span className="font-semibold text-muted-foreground">{pick("채널", "Channel")}</span>
                <span className="min-w-0 break-words font-semibold text-foreground">
                  {channels.length ? channels.join(", ") : pick("선택 없음", "None selected")}
                </span>
              </span>
              <span className="grid min-w-0 grid-cols-[46px_1fr] items-start gap-2">
                <span className="font-semibold text-muted-foreground">{pick("상태", "Status")}</span>
                <span className="min-w-0 break-words font-semibold text-foreground">{statusSummary}</span>
              </span>
            </span>
          }
        />
        <Kpi
          label={pick("재입고 완료 평균 · 확정치", "Restocked Average · Final")}
          value={metricValue(completedRows, "average")}
          unit={completedRows.length ? "%" : undefined}
          active={kpiFilter === "completed"}
          onClick={() => selectKpiFilter("completed")}
          foot={
            <span className="flex flex-col gap-1">
              <span>{pick(`${completedRows.length.toLocaleString("en-US")}건`, `${completedRows.length.toLocaleString("en-US")} records`)}</span>
              <span>{pick("중앙값", "Median")}: <b className="text-foreground">{metricValue(completedRows, "median")}{completedRows.length ? "%" : ""}</b></span>
            </span>
          }
        />
        <Kpi
          label={pick("Pre-Order 진행중 평균 · 잠정치", "Active Pre-Order Average · Preliminary")}
          value={metricValue(activeRows, "average")}
          unit={activeRows.length ? "%" : undefined}
          active={kpiFilter === "active"}
          onClick={() => selectKpiFilter("active")}
          foot={
            <span className="flex flex-col gap-1">
              <span>{pick(`${activeRows.length.toLocaleString("en-US")}건`, `${activeRows.length.toLocaleString("en-US")} records`)}</span>
              <span>{pick("중앙값", "Median")}: <b className="text-foreground">{metricValue(activeRows, "median")}{activeRows.length ? "%" : ""}</b></span>
            </span>
          }
        />
        <Kpi
          label={pick("판매 영향 최대 SKU", "Highest Sales-Impact SKU")}
          value={<span className="font-mono text-sm">{maxImpactRow?.sku ?? "—"}</span>}
          active={kpiFilter === "maxImpact"}
          onClick={() => selectKpiFilter("maxImpact")}
          foot={maxImpactRow ? (
            <span>
              <b className="font-mono text-foreground">{lostDailyAverage(maxImpactRow).toFixed(2)}{pick("개 / 일", " units / day")}</b>
              {pick(` 감소 · ${maxImpactRow.drop}%`, ` lost · ${maxImpactRow.drop}% drop`)}
            </span>
          ) : pick("해당 없음", "None")}
        />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">{pick("SKU별 감소율 분포", "SKU Drop-Rate Distribution")}</h3>
          <span className="text-[11px] text-muted-foreground">{pick(`${chartRows.length.toLocaleString("en-US")}개 신뢰 분석 SKU · 구간별 개수`, `${chartRows.length.toLocaleString("en-US")} reliable SKUs · count by range`)}</span>
        </div>
        <Histogram
          bins={bins}
          medianValue={medianDrop}
          medianPosition={histogramMedianPosition(medianDrop, percentBuckets)}
          medianLabel={pick(`신뢰 분석 ${chartRows.length.toLocaleString("en-US")}개 SKU 중앙값 ${Math.round(medianDrop)}%`, `Median across ${chartRows.length.toLocaleString("en-US")} reliable SKUs: ${Math.round(medianDrop)}%`)}
          medianDescription={medianDetail}
          activeIndex={selectedBin}
          onBinClick={(index) => {
            setSelectedBin((current) => current === index ? null : index);
            setOpenKey(null);
            setPage(1);
          }}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          <strong className="text-foreground">{pick("중앙값 계산:", "Median calculation:")}</strong> {medianDetail}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {pick(
            `분석 기준: 비교 기간 ${MIN_ANALYSIS_WINDOW_DAYS}일 이상 · 품절 전 정상 일평균 ${MIN_BASELINE_DAILY_AVERAGE}개 / 일 이상 · 상세 그리드에는 전체 원본 이력 표시`,
            `Analysis criteria: ${MIN_ANALYSIS_WINDOW_DAYS}+ comparison days · normal average ${MIN_BASELINE_DAILY_AVERAGE}+ unit / day · the detail grid retains all raw episodes`,
          )}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {pick("막대를 클릭하면 아래 SKU별 상세가 해당 구간으로 필터링됩니다 · 같은 막대를 다시 클릭하면 해제됩니다.", "Click a bar to filter the SKU details below to that range · click the same bar again to clear the filter.")}
        </p>
      </div>

      <div className={cn("grid items-start gap-4", open && "min-[1500px]:grid-cols-[minmax(0,1.8fr)_minmax(500px,1fr)]")}>
      <div className="planning-panel min-w-0 overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            {pick("SKU별 상세", "SKU Details")} <span className="font-normal text-muted-foreground">— {pick(`${sortedRows.length.toLocaleString("en-US")}건 표시`, `${sortedRows.length.toLocaleString("en-US")} rows`)}</span>
          </span>
          <div className="relative flex min-w-[220px] items-center">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={pick("마스터 SKU 검색...", "Search Master SKU...")}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-8 text-xs outline-none focus:border-foreground/40"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPage(1); }}
                aria-label={pick("검색어 지우기", "Clear search")}
                title={pick("검색어 지우기", "Clear search")}
                className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed border-collapse text-xs">
            {open ? (
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[14%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
              </colgroup>
            ) : (
              <colgroup>
                <col className="w-[17%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[15%]" />
              </colgroup>
            )}
            <thead>
              <tr className="bg-muted">
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key ?? col.en}
                    onClick={col.key ? () => handleSort(col.key!) : undefined}
                    className={cn(
                      "whitespace-nowrap border-b border-border px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground",
                      col.right && "text-right",
                      !open && col.key === "poRange" && "pl-5",
                      col.key && "cursor-pointer select-none hover:text-foreground",
                    )}
                  >
                    {pick(col.ko, col.en)}
                    {col.key && <SortIcon active={sortKey === col.key} dir={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenKey(openKey === r.id ? null : r.id)}
                  className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted", openKey === r.id && "bg-muted")}
                >
                  <td className="px-3 py-2.5"><span className="font-mono font-semibold text-[#1238a0] dark:text-[#7aa2f7]">{r.sku}</span></td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">{r.normalRange}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{pick(`${r.windowDays}일`, `${r.windowDays} days`)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{r.pre.toFixed(2)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground", !open && "pl-5")}>{r.poRange}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{r.post.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {r.drop < 0 ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl bg-sky-100 px-2.5 py-1 font-mono text-[11px] font-bold leading-tight text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                        <TrendingUp className="h-3 w-3" />
                        <span>{r.drop}%</span>
                        <span className="font-sans">{pick("판매 증가", "Sales increase")}</span>
                      </span>
                    ) : (
                      <SeverityPill severity={r.severity}><TrendingDown className="h-3 w-3" />{r.drop}%</SeverityPill>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right"><StageTag stage={r.stage} /></td>
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

      {open && (
        <div className="planning-panel min-w-0 rounded-xl border p-4 min-[1500px]:sticky min-[1500px]:top-4">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-semibold">{open.sku}</span>
              <span className="text-xs text-muted-foreground">{pick("실제 일평균 · 정상 구간 vs Pre-Order 구간", "Actual daily average · Normal vs Pre-Order period")}</span>
            </div>
            <button type="button" onClick={() => setOpenKey(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">{pick("닫기", "Close")}</button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <LineChart
              xs={[-openChartDays, -openChartDays * 0.67, -openChartDays * 0.33, -0.001, 0, openChartDays * 0.33, openChartDays * 0.67, openChartDays]}
              yMin={0}
              yMax={openChartScale?.max ?? 1}
              yTicks={openChartScale?.ticks ?? [0, 0.5, 1]}
              xTicks={[-openChartDays, 0, openChartDays]}
              xUnit={pick("일", "d")}
              markers={[{ at: 0, label: pick("품절 기준일", "Stockout Date") }]}
              height={400}
              labelFontSize={18}
              series={[{ data: [open.pre, open.pre, open.pre, open.pre, open.post, open.post, open.post, open.post], color: "var(--chart-blue)", area: true, endLabel: pick(`${open.post.toFixed(2)}개 / 일`, `${open.post.toFixed(2)} / day`) }]}
            />
            <div className="overflow-hidden rounded-lg border border-border">
              {[
                [pick("품절 전 정상 일평균", "Normal Daily Avg. Before Stockout"), pick(`${open.pre.toFixed(2)}개 / 일 (${open.normalQty}개 ÷ ${open.windowDays}일)`, `${open.pre.toFixed(2)} units / day (${open.normalQty} ÷ ${open.windowDays} days)`)],
                [pick("Pre-Order 일평균", "Pre-Order Daily Avg."), pick(`${open.post.toFixed(2)}개 / 일 (${open.preorderQty}개 ÷ ${open.windowDays}일)`, `${open.post.toFixed(2)} units / day (${open.preorderQty} ÷ ${open.windowDays} days)`)],
                [
                  pick("판매 감소율", "Sales Drop Rate"),
                  open.drop < 0
                    ? pick(`${open.drop}% (판매 ${Math.abs(open.drop)}% 증가)`, `${open.drop}% (${Math.abs(open.drop)}% sales increase)`)
                    : `${open.drop}%`,
                ],
                [pick("품절 기준일", "Stockout Date"), open.convDate],
                [pick("재입고일", "Restock Date"), open.restockDate ?? pick("미입고", "Not restocked")],
                [pick("비교 기간", "Comparison Window"), pick(`${open.windowDays}일`, `${open.windowDays} days`)],
                [pick("진행 상태", "Stage"), open.stage === "active" ? pick("Pre-Order 진행중", "Pre-Order Active") : pick("재입고 완료", "Restocked")],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0">
                  <span className="text-[11px] font-medium text-muted-foreground">{k}</span>
                  <span className="font-semibold tabular-nums">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
      </>
      )}

    </div>
  );
}
