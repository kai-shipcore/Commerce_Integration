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
import {
  Chip, FilterRow, Histogram, Kpi, LineChart, PAGE_SIZES, Pagination, SeverityPill, SortIcon,
  average, type LineSeries, type Severity, type SortDir,
} from "./shared";

interface RecoveryRow {
  sku: string;
  channel: string;
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

interface Drilldown {
  points: number[];
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

function num1(v: number | null): string {
  return v === null ? "—" : v.toFixed(1);
}

function daysToRecoveryLabel(r: RecoveryRow): string {
  if (r.daysToRecovery !== null) return `${r.daysToRecovery}일`;
  return r.severity === "critical" ? "미회복" : "관찰중";
}

type SortKey = "sku" | "baseline" | "oosStartedOn" | "restockDate" | "oosDays" | "daysToRecovery" | "severity";

// Columns whose first click sorts ascending (text/date-like); numeric columns
// default to descending so the most extreme values surface first.
const DEFAULT_ASC_KEYS: SortKey[] = ["sku", "oosStartedOn", "restockDate", "severity"];
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, good: 3 };

const TABLE_COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "sku", label: "Master SKU" },
  { key: "baseline", label: "품절직전 일평균", right: true },
  { key: "oosStartedOn", label: "품절일" },
  { key: "restockDate", label: "재입고일" },
  { key: "oosDays", label: "품절기간", right: true },
  { key: "daysToRecovery", label: "회복까지 걸린 일수", right: true },
  { key: "severity", label: "상태" },
];

function rowKey(r: RecoveryRow): string {
  return `${r.sku}|${r.channel}|${r.restockDate}`;
}

// Distribution buckets for the "스큐 비교" histogram — categorical (days-to-
// recovery ranges plus the two undecided/failed outcomes), not a continuous
// 0–100% scale, so no median line here (Histogram's median props are optional).
type RecoveryBucketKey = "0-30" | "30-60" | "60-90" | "pending" | "none";
const RECOVERY_BUCKETS: { key: RecoveryBucketKey; label: string }[] = [
  { key: "0-30", label: "0–30일" },
  { key: "30-60", label: "30–60일" },
  { key: "60-90", label: "60–90일" },
  { key: "pending", label: "관찰중" },
  { key: "none", label: "미회복" },
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
  const [channels, setChannels] = useState<string[]>([...MARKETPLACE_CHANNELS]);
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

  useEffect(() => {
    fetch(apiPath("/api/planning/oos-impact/recovery"))
      .then((r) => r.json())
      .then((json: { success: boolean; data?: RecoveryRow[]; error?: string }) => {
        if (!json.success) throw new Error(json.error ?? "Unknown error");
        setRows(json.data ?? []);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

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

  const toggle = (v: string) => {
    setChannels((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    setSelectedBin(null);
    setPage(1);
  };

  const visibleRows = useMemo(
    () => (rows ?? [])
      .filter((r) => channels.includes(r.channel))
      .filter((r) => !topSellersOnly || topSellerSkuSet.has(r.sku)),
    [rows, channels, topSellersOnly, topSellerSkuSet],
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
      label: def.label,
      count: visibleRows.filter((r) => bucketOf(r) === def.key).length,
    })),
    [visibleRows],
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
        <FilterRow label="채널">
          {MARKETPLACE_CHANNELS.map((ch) => (
            <Chip key={ch} active={channels.includes(ch)} onClick={() => toggle(ch)}>{CHANNEL_DISPLAY_LABELS[ch]}</Chip>
          ))}
        </FilterRow>
        <FilterRow label="대상">
          <Chip active>과거 품절 → 재입고 완료</Chip>
          <Chip ghost title="현재 품절 중인 상품은 회복 추이 계산 자체가 불가능해 제외">현재 품절중 제외</Chip>
          <Chip
            active={topSellersOnly}
            onClick={() => { setTopSellersOnly((v) => !v); setPage(1); }}
            title={topLoadError ? `TOP 100 데이터 로드 실패: ${topLoadError}` : topRows === null ? "TOP 100 데이터 불러오는 중…" : "최근 30일 전체 채널(Shopify 포함) 판매량 기준 상위 100 Master SKU만"}
          >
            판매량 TOP 100 SKU만
          </Chip>
        </FilterRow>
        <FilterRow label="직전 품절">
          {["전체", "14일 이상", "30일 이상", "60일 이상"].map((p) => (
            <Chip key={p} active={p === "전체"}>{p}</Chip>
          ))}
          <span className="text-[11px] text-muted-foreground">— 품절이 길었던 SKU일수록 회복이 느린지 확인할 때 사용</span>
        </FilterRow>
      </div>

      {loadError ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-destructive">
          재입고 회복 데이터 로드 실패: {loadError}
        </div>
      ) : rows === null ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center gap-2 rounded-xl border text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          재입고 회복 데이터 불러오는 중…
        </div>
      ) : channels.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          최소 하나의 채널을 선택하세요
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="재입고 추적 SKU" value={String(visibleRows.length)} foot={topSellersOnly ? "선택된 채널 · 판매량 TOP 100 SKU 기준" : "선택된 채널 기준"} />
        <Kpi
          label="평균 회복 소요일"
          value={confirmedDays.length ? String(Math.round(average(confirmedDays))) : "—"}
          unit="일"
          foot="회복 확정된 건 평균"
        />
        <Kpi
          label="미회복 SKU"
          value={String(neverRecoveredCount)}
          foot={`전체의 ${visibleRows.length ? Math.round((neverRecoveredCount / visibleRows.length) * 100) : 0}% · 90일 내 회복 못함`}
        />
        <Kpi label="관찰중 SKU" value={String(pendingCount)} foot="아직 90일 안 지나 판단 이름" />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">재입고 후 경과일별 회복률 — {chartView === "channel" ? "채널 비교" : "스큐 비교"}</h3>
          <div className="flex items-center gap-1.5">
            <Chip active={chartView === "channel"} onClick={() => { setChartView("channel"); setPage(1); }}>채널 비교</Chip>
            <Chip active={chartView === "sku"} onClick={() => { setChartView("sku"); setPage(1); }}>스큐 비교</Chip>
            {chartView === "channel" && (
              <span className="rounded-md border border-dashed border-border px-2 py-1 text-[10.5px] font-medium text-muted-foreground" title="채널별 회복 곡선은 아직 샘플 데이터입니다 — 시계열 집계 설계가 필요해 다음 단계로 예정">
                샘플 데이터
              </span>
            )}
          </div>
        </div>
        {chartView === "channel" ? (
          <>
            <LineChart
              xs={RECOVERY_XS} xTicks={[0, 30, 60, 90, 120]} xUnit="d"
              yMin={0} yMax={100} yTicks={[0, 25, 50, 75, 100]} yUnit="%"
              refValue={100} refLabel="정상 수요 기준선"
              series={recoverySeries}
            />
            <div className="mt-1.5 flex flex-wrap gap-4 text-[11px] text-foreground/80">
              <span className="flex items-center gap-1.5"><span className="h-0 w-3.5 border-t-2 border-dashed border-foreground" />전체 평균</span>
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
              회복까지 걸린 일수 기준 분포 — 막대를 클릭하면 아래 SKU별 상세가 해당 구간으로 필터링됩니다 · 같은 막대를 다시 클릭하면 해제됩니다.
            </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            SKU별 상세 <span className="font-normal text-muted-foreground">— {sortedRows.length}건 표시</span>
          </span>
          <div className="relative flex min-w-[220px] items-center">
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="마스터 SKU 검색..."
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-foreground/40"
            />
          </div>
        </div>
        <p className="border-b border-border bg-muted/40 px-3.5 py-1.5 text-[10.5px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">상태 기준</span> — 정상 회복: 재입고 후 30일 이내 회복 · 느린 회복: 30~90일 이내 회복 · 관찰중: 재입고 후 아직 90일 안 지남 · 미회복: 90일이 지나도 회복 못함
          <span className="ml-1" title="회복 = 트레일링 14일 평균 판매량이 품절 직전 기준선(baseline)의 80% 이상에 도달">(회복 기준: 기준선의 80% 도달)</span>
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
                    {col.label}
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
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.oosDays}일</td>
                  <td
                    className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono font-bold tabular-nums"
                    title="재입고 후 트레일링 14일 평균이 기준선의 80%에 처음 도달한 날 — 90일 안에 도달 못하면 미회복(또는 아직 90일 전이면 관찰중)"
                  >
                    {daysToRecoveryLabel(r)}
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
            <span>SKU별 상세에서 행을 클릭하면</span>
            <span>재입고 후 일별 판매량 그래프가 여기에 표시됩니다.</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-sm font-semibold">{open.sku}</span>
              </div>
              <button type="button" onClick={() => setOpenKey(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">닫기</button>
            </div>
            <span className="-mt-2 text-xs text-muted-foreground">일별 판매량(실측) vs 품절 직전 기준선</span>
            {drilldownLoading ? (
              <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                드릴다운 데이터 불러오는 중…
              </div>
            ) : drilldownError ? (
              <div className="flex min-h-[160px] items-center justify-center text-sm text-destructive">
                드릴다운 데이터 로드 실패: {drilldownError}
              </div>
            ) : drilldown ? (
              <>
                <LineChart
                  xs={[-30, -15, 0, 15, 30, 60, 90]} xTicks={[-30, 0, 30, 60, 90]} xUnit="d"
                  yMin={0} yMax={Math.max(drilldown.baseline * 1.15, ...drilldown.points.map((p) => p * 1.15), 1)}
                  yTicks={[0, Math.round(drilldown.baseline / 2), Math.round(drilldown.baseline)]}
                  refValue={drilldown.baseline} refLabel={`기준선 ${drilldown.baseline.toFixed(1)}/day`}
                  marker={0} markerLabel="재입고"
                  series={[{ data: drilldown.points, color: "var(--chart-blue)", area: true, endLabel: `${drilldown.points[drilldown.points.length - 1].toFixed(1)}/day` }]}
                  height={360}
                />
                <div className="overflow-hidden rounded-lg border border-border">
                  {([
                    ["days_since_restock", String(open.daysSinceRestock)],
                    ["previous_oos_days", String(open.oosDays)],
                    ["days_to_recovery", daysToRecoveryLabel(open)],
                    ["recovery_outcome", open.label],
                    ["day_0_30_avg", `${num1(open.day0to30)}/day`],
                    ["day_30_60_avg", `${num1(open.day30to60)}/day`],
                    ["day_60_90_avg", `${num1(open.day60to90)}/day`],
                    ["pre_oos_baseline_demand", `${open.baseline.toFixed(2)}/day`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0">
                      <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
                      <span className="font-mono font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
      </div>
      </>
      )}

      <div className="planning-panel flex flex-col gap-2 rounded-xl border p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">설계 노트</h4>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-foreground/80">
          <li>&quot;현재 품절중 제외&quot;가 기본 고정 — 대상 정의(과거 품절 → 재입고 완료 건만)를 필터가 아니라 규칙으로 강제.</li>
          <li>직전 품절 기간 필터 — &quot;장기 품절일수록 회복이 느리다&quot;는 가설을 화면에서 바로 검증할 수 있어야 발주 타이밍 논의가 됨.</li>
          <li>상태 pill은 항상 아이콘 + 텍스트 + 숫자를 같이 표시 — 색만으로 판단하지 않도록 함.</li>
          <li>
            이 탭의 목적은 &quot;재입고 후 회복이 느린/안 된 SKU&quot;를 찾는 것이라, 핵심 지표는 <span className="font-mono">회복까지 걸린 일수</span>(daysToRecovery) — 재입고 후 트레일링 14일 평균이 기준선의 80%에 처음 도달한 날. 90일 안에 도달 못하면 경과일이 90일 미만이면 &quot;관찰중&quot;, 90일을 넘겼으면 &quot;미회복&quot;으로 확정(가장 타격이 큰 케이스). 예전엔 &quot;오늘 기준 최근 14일&quot; 현재 판매 상태로 상태/히스토그램을 계산했는데, 그건 회복 속도와 무관한 다른 질문(지금 잘 팔리냐)이라 완전히 제거함.
          </li>
          <li>재입고 후 30/30~60/60~90일 하루 평균(겹치지 않는 구간)은 표 컬럼에서 빼고 오른쪽 드릴다운 패널의 변수 목록으로 옮김 — 회복까지 걸린 일수라는 단일 지표가 이미 있어서 표에서는 중복이고, 필요할 때(행 클릭 시) 그래프와 함께 보는 게 더 유용함. 채널 컬럼은 표에서 뺐지만 한 SKU가 채널별로 여러 행에 나올 수 있음(내부적으로는 SKU+채널+재입고일로 구분).</li>
          <li>히스토그램은 0-100% 연속 분포가 아니라 &quot;0–30일/30–60일/60–90일/관찰중/미회복&quot; 이산 카테고리라 중앙값 선 없이 막대 개수만 표시 (Histogram 컴포넌트의 medianValue 등은 optional로 바꿔서 preorder-screen의 %기반 히스토그램과 공유).</li>
          <li>SKU별 상세는 열 헤더 클릭으로 정렬(다시 클릭 시 역순), SKU 검색으로 필터링, 페이지네이션(25/50/100개씩)까지 지원 — 열려있던 드릴다운 행은 SKU/채널/재입고일 키로 추적해 정렬·검색·페이지 이동과 무관하게 같은 행을 계속 가리키고, 필터에서 벗어나면 자동으로 닫힘.</li>
          <li>드릴다운은 표 아래로 펼치지 않고 오른쪽에 고정 패널로 배치(넓은 화면 기준) — 행을 클릭해도 페이지가 밀리지 않고, 스크롤해도 패널이 따라와서 여러 SKU를 훑어보며 그래프를 바로바로 확인하기 편함. 좁은 화면(lg 미만)에서는 표 아래로 쌓임.</li>
          <li>&quot;판매량 TOP 100 SKU만&quot; 필터(대상 행) — 품절/재입고 이력과 무관하게 Master SKU 단위·전체 채널(Shopify 포함)·최근 30일 판매량 기준 상위 100 SKU로만 회복 추적 대상을 좁힘. 채널 비교/스큐 비교 두 뷰 모두에 공통 적용되며, KPI·히스토그램·표가 전부 필터링된 집합 기준으로 갱신됨. link/custom 스냅샷 중복 집계 방지 로직(카테고리 기준 소스 택일)은 이 필터의 판매량 집계 API(top-sellers)에도 동일하게 적용됨.</li>
        </ul>
      </div>
    </div>
  );
}
