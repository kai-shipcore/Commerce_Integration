"use client";

// Code Guide: Screen 2 — marketplace (Amazon/eBay/Walmart) restock recovery.
// "스큐 비교" (histogram + table) is wired to real data via
// /api/planning/oos-impact/recovery (+ /recovery/drilldown for the per-row
// chart). "채널 비교" (the line chart) still uses sample RECOVERY_SERIES —
// it needs a separate time-series aggregation design, tracked as follow-up.
// Only touch shared.tsx for things this file and preorder-screen.tsx both need.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";
import {
  Chip, FilterRow, Histogram, Kpi, LineChart, PERCENT_BUCKETS, SeverityPill,
  average, histogramFrom, median, medianExplanation, type LineSeries, type Severity,
} from "./shared";

interface RecoveryRow {
  sku: string;
  channel: string;
  oosDays: number;
  restockDate: string;
  daysSinceRestock: number;
  baseline: number;
  currentRecovery: number;
  r30: number | null;
  r60: number | null;
  r90: number | null;
  severity: Severity;
  label: string;
}

interface Drilldown {
  points: number[];
  baseline: number;
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

const CHANNEL_DOT: Record<string, string> = {
  "Amazon FBA": "bg-[var(--chart-blue)]",
  "Amazon FBM": "bg-[var(--chart-blue)]",
  Auto_Armor: "bg-[var(--chart-orange)]",
  Advance_Parts: "bg-[var(--chart-orange)]",
  Walmart: "bg-[var(--chart-aqua)]",
};

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-foreground/80">
      <span className={cn("h-1.5 w-1.5 rounded-full", CHANNEL_DOT[channel] ?? "bg-muted-foreground")} />
      {CHANNEL_DISPLAY_LABELS[channel] ?? channel}
    </span>
  );
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export function RecoveryScreen() {
  const [channels, setChannels] = useState<string[]>([...MARKETPLACE_CHANNELS]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [chartView, setChartView] = useState<"channel" | "sku">("sku");
  const [selectedBin, setSelectedBin] = useState<number | null>(null);

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

  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  const toggle = (v: string) => {
    setChannels((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    setSelectedBin(null);
  };

  const visibleRows = useMemo(() => (rows ?? []).filter((r) => channels.includes(r.channel)), [rows, channels]);

  const tableRows = useMemo(() => {
    if (chartView !== "sku" || selectedBin === null) return visibleRows;
    const bucket = PERCENT_BUCKETS[selectedBin];
    return visibleRows.filter((r) => r.currentRecovery >= bucket.min && r.currentRecovery < bucket.max);
  }, [visibleRows, chartView, selectedBin]);

  // Bounds-check instead of resetting via effect: if a channel toggle shrinks
  // the list out from under an open row, the drawer just closes on its own.
  const open = openIdx !== null && openIdx < tableRows.length ? tableRows[openIdx] : null;

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

  const recoveryValues = useMemo(() => visibleRows.map((r) => r.currentRecovery), [visibleRows]);
  const recoveryBins = useMemo(() => histogramFrom(recoveryValues), [recoveryValues]);
  const recoveryMedian = median(recoveryValues);

  const nonNull = (nums: (number | null)[]) => nums.filter((n): n is number => n !== null);

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
        <Kpi label="재입고 추적 SKU" value={String(visibleRows.length)} foot="선택된 채널 기준" />
        <Kpi label="평균 30일 회복률" value={String(Math.round(average(nonNull(visibleRows.map((r) => r.r30)))))} unit="%" foot="기준선 대비" />
        <Kpi label="평균 60일 회복률" value={String(Math.round(average(nonNull(visibleRows.map((r) => r.r60)))))} unit="%" foot="기준선 대비" />
        <Kpi label="평균 90일 회복률" value={String(Math.round(average(nonNull(visibleRows.map((r) => r.r90)))))} unit="%" foot="기준선 대비" />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">재입고 후 경과일별 회복률 — {chartView === "channel" ? "채널 비교" : "스큐 비교"}</h3>
          <div className="flex items-center gap-1.5">
            <Chip active={chartView === "channel"} onClick={() => setChartView("channel")}>채널 비교</Chip>
            <Chip active={chartView === "sku"} onClick={() => setChartView("sku")}>스큐 비교</Chip>
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
              medianValue={recoveryMedian}
              medianLabel={`전체 ${visibleRows.length}개 SKU 중앙값 ${Math.round(recoveryMedian)}%`}
              medianDescription={medianExplanation(recoveryValues)}
              activeIndex={selectedBin}
              onBinClick={(i) => setSelectedBin((prev) => (prev === i ? null : i))}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              막대를 클릭하면 아래 SKU별 상세가 해당 구간으로 필터링됩니다 · 같은 막대를 다시 클릭하면 해제됩니다.
            </p>
          </>
        )}
      </div>

      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            SKU별 상세 <span className="font-normal text-muted-foreground">— {tableRows.length}건 표시</span>
          </span>
          <span className="flex min-w-[220px] items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            마스터 SKU 검색...
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-xs">
            <thead>
              <tr className="bg-muted">
                {["Master SKU", "채널", "직전 품절", "재입고일", "기준선", "30일", "60일", "90일", "상태"].map((h, i) => (
                  <th key={h} className={cn("whitespace-nowrap border-b border-border px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground", i >= 2 && i <= 7 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => (
                <tr
                  key={`${r.sku}|${r.channel}|${r.restockDate}`}
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted", openIdx === i && "bg-muted")}
                >
                  <td className="px-3.5 py-2.5"><span className="font-mono font-semibold text-[#1238a0] dark:text-[#7aa2f7]">{r.sku}</span></td>
                  <td className="px-3.5 py-2.5"><ChannelBadge channel={r.channel} /></td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.oosDays}일</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.restockDate}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.baseline.toFixed(1)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{pct(r.r30)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{pct(r.r60)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono font-bold tabular-nums">{pct(r.r90)}</td>
                  <td className="px-3.5 py-2.5"><SeverityPill severity={r.severity}>{r.label}</SeverityPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="planning-panel rounded-xl border p-4">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-semibold">{open.sku}</span>
              <span className="text-xs text-muted-foreground">일별 판매량(실측) vs 품절 직전 기준선</span>
            </div>
            <button type="button" onClick={() => setOpenIdx(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">닫기</button>
          </div>
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
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.5fr_1fr]">
              <LineChart
                xs={[-30, -15, 0, 15, 30, 60, 90]} xTicks={[-30, 0, 30, 60, 90]} xUnit="d"
                yMin={0} yMax={Math.max(drilldown.baseline * 1.15, ...drilldown.points.map((p) => p * 1.15), 1)}
                yTicks={[0, Math.round(drilldown.baseline / 2), Math.round(drilldown.baseline)]}
                refValue={drilldown.baseline} refLabel={`기준선 ${drilldown.baseline.toFixed(1)}/day`}
                marker={0} markerLabel="재입고"
                series={[{ data: drilldown.points, color: "var(--chart-blue)", area: true, endLabel: `${drilldown.points[drilldown.points.length - 1].toFixed(1)}/day` }]}
              />
              <div className="overflow-hidden rounded-lg border border-border">
                {([
                  ["days_since_restock", String(open.daysSinceRestock)],
                  ["previous_oos_days", String(open.oosDays)],
                  ["recovery_rate_30d", pct(open.r30)],
                  ["recovery_rate_60d", pct(open.r60)],
                  ["recovery_rate_90d", pct(open.r90)],
                  ["current_recovery_rate", pct(open.currentRecovery)],
                  ["expected_recovery_stage", open.label],
                  ["pre_oos_baseline_demand", `${open.baseline.toFixed(2)}/day`],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0">
                    <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
                    <span className="font-mono font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      </>
      )}

      <div className="planning-panel flex flex-col gap-2 rounded-xl border p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">설계 노트</h4>
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-foreground/80">
          <li>&quot;현재 품절중 제외&quot;가 기본 고정 — 대상 정의(과거 품절 → 재입고 완료 건만)를 필터가 아니라 규칙으로 강제.</li>
          <li>직전 품절 기간 필터 — &quot;장기 품절일수록 회복이 느리다&quot;는 가설을 화면에서 바로 검증할 수 있어야 발주 타이밍 논의가 됨.</li>
          <li>상태 pill은 항상 아이콘 + 텍스트 + 숫자를 같이 표시 — 색만으로 판단하지 않도록 함.</li>
          <li>
            <span className="font-mono">스큐 비교</span>는 실제 데이터로 연동됨 (<span className="font-mono">/api/planning/oos-impact/recovery</span>) —
            품절 시작 30일 전 평균을 기준선으로, 재입고 후 최근 14일 평균을 현재 회복률로 계산. 30/60/90일 회복률은 그 시점이 실제로 지난 SKU만 표시(&quot;—&quot;는 아직 집계 전).
            심각도 기준: 85% 이상 정상화 · 50~85% 회복 후반 · 50% 미만 회복 초기.
          </li>
          <li><span className="font-mono">채널 비교</span>(라인차트)는 아직 샘플 데이터 — 채널별 시계열 집계는 별도 설계가 필요해 다음 단계로 예정.</li>
        </ul>
      </div>
    </div>
  );
}
