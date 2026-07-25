"use client";

// Code Guide: Screen 2 — marketplace (Amazon/eBay/Walmart) restock recovery.
// Owns its own sample data and screen-only pieces (ChannelBadge).
// Only touch shared.tsx for things this file and preorder-screen.tsx both need.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, FilterRow, Kpi, LineChart, SeverityPill, average, type LineSeries, type Severity } from "./shared";

interface Row2 {
  sku: string;
  channel: string;
  channelColor: "blue" | "orange" | "aqua";
  oos: number;
  restock: string;
  baseline: number;
  r30: number;
  r60: number;
  r90: number;
  severity: Severity;
  label: string;
  vars: [string, string][];
  chart: number[];
}

const ROWS2: Row2[] = [
  {
    sku: "CA-SC-10-F-40-WR-1TO", channel: "Amazon FBA", channelColor: "blue",
    oos: 62, restock: "2026-05-02", baseline: 8.0, r30: 38, r60: 63, r90: 88,
    severity: "good", label: "정상화",
    vars: [
      ["days_since_restock", "94"], ["previous_oos_days", "62"],
      ["recovery_rate_30d", "38%"], ["recovery_rate_60d", "63%"], ["recovery_rate_90d", "88%"],
      ["expected_recovery_stage", "안정화 단계"], ["pre_oos_baseline_demand", "8.0/day"], ["recovery_adjusted_demand", "7.0/day"],
    ],
    chart: [0, 3.1, 5.0, 7.0],
  },
  {
    sku: "CC-CS-15-I-GRBK-STR", channel: "eBay Auto_Armor", channelColor: "orange",
    oos: 118, restock: "2026-05-10", baseline: 3.4, r30: 21, r60: 34, r90: 47,
    severity: "critical", label: "회복 초기",
    vars: [
      ["days_since_restock", "86"], ["previous_oos_days", "118"],
      ["recovery_rate_30d", "21%"], ["recovery_rate_60d", "34%"], ["recovery_rate_90d", "47%"],
      ["expected_recovery_stage", "초기 회복 단계"], ["pre_oos_baseline_demand", "3.4/day"], ["recovery_adjusted_demand", "1.6/day"],
    ],
    chart: [0, 0.7, 1.2, 1.6],
  },
  {
    sku: "CA-FM-TX-80-XL", channel: "Walmart", channelColor: "aqua",
    oos: 21, restock: "2026-06-01", baseline: 5.1, r30: 71, r60: 92, r90: 97,
    severity: "good", label: "정상화",
    vars: [
      ["days_since_restock", "53"], ["previous_oos_days", "21"],
      ["recovery_rate_30d", "71%"], ["recovery_rate_60d", "92%"], ["recovery_rate_90d", "97%"],
      ["expected_recovery_stage", "안정화 단계"], ["pre_oos_baseline_demand", "5.1/day"], ["recovery_adjusted_demand", "4.9/day"],
    ],
    chart: [0, 3.6, 4.7, 4.9],
  },
  {
    sku: "CA-SC-10-B-02-WR-1TO", channel: "Amazon FBM", channelColor: "blue",
    oos: 45, restock: "2026-04-15", baseline: 6.2, r30: 55, r60: 68, r90: 79,
    severity: "warning", label: "회복 후반",
    vars: [
      ["days_since_restock", "100"], ["previous_oos_days", "45"],
      ["recovery_rate_30d", "55%"], ["recovery_rate_60d", "68%"], ["recovery_rate_90d", "79%"],
      ["expected_recovery_stage", "회복 후반 단계"], ["pre_oos_baseline_demand", "6.2/day"], ["recovery_adjusted_demand", "4.9/day"],
    ],
    chart: [0, 3.4, 4.2, 4.9],
  },
];

const RECOVERY_XS = [0, 15, 30, 45, 60, 75, 90, 105, 120];
const RECOVERY_SERIES = {
  overall: [0, 22, 46, 58, 64, 71, 78, 83, 87],
  amazon: [0, 25, 50, 62, 68, 75, 82, 87, 91],
  ebay: [0, 12, 28, 38, 45, 52, 60, 66, 71],
  walmart: [0, 30, 58, 72, 80, 86, 91, 94, 96],
};

const CHANNEL_DOT: Record<Row2["channelColor"], string> = {
  blue: "bg-[var(--chart-blue)]",
  orange: "bg-[var(--chart-orange)]",
  aqua: "bg-[var(--chart-aqua)]",
};

function ChannelBadge({ channel, color }: { channel: string; color: Row2["channelColor"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-foreground/80">
      <span className={cn("h-1.5 w-1.5 rounded-full", CHANNEL_DOT[color])} />
      {channel}
    </span>
  );
}

const MARKETPLACE_CHANNELS = ["Amazon FBA", "Amazon FBM", "eBay Auto_Armor", "eBay Advance_Parts", "Walmart"] as const;

export function RecoveryScreen() {
  const [channels, setChannels] = useState<string[]>([...MARKETPLACE_CHANNELS]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const toggle = (v: string) => setChannels((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const visibleRows2 = useMemo(() => ROWS2.filter((r) => channels.includes(r.channel)), [channels]);
  // Bounds-check instead of resetting via effect: if a channel toggle shrinks
  // the list out from under an open row, the drawer just closes on its own.
  const open = openIdx !== null && openIdx < visibleRows2.length ? visibleRows2[openIdx] : null;

  const showAmazon = channels.includes("Amazon FBA") || channels.includes("Amazon FBM");
  const showEbay = channels.includes("eBay Auto_Armor") || channels.includes("eBay Advance_Parts");
  const showWalmart = channels.includes("Walmart");

  const recoverySeries = useMemo(() => {
    const s: LineSeries[] = [];
    if (showAmazon) s.push({ data: RECOVERY_SERIES.amazon, color: "var(--chart-blue)", endLabel: "91%" });
    if (showEbay) s.push({ data: RECOVERY_SERIES.ebay, color: "var(--chart-orange)", endLabel: "71%" });
    if (showWalmart) s.push({ data: RECOVERY_SERIES.walmart, color: "var(--chart-aqua)", endLabel: "96%" });
    if (s.length > 0) s.unshift({ data: RECOVERY_SERIES.overall, color: "var(--foreground)", dashed: true });
    return s;
  }, [showAmazon, showEbay, showWalmart]);

  const drilldownSeries = useMemo(() => {
    if (!open) return null;
    const pre = open.baseline;
    const [, m30, m60, m90] = open.chart;
    return [pre * 0.98, pre * 1.02, 0, m30, m60, m60 + (m90 - m60) * 0.4, m90];
  }, [open]);

  return (
    <div className="flex flex-col gap-4">
      <div className="planning-panel flex flex-col gap-3 rounded-xl border p-4">
        <FilterRow label="채널">
          {MARKETPLACE_CHANNELS.map((ch) => (
            <Chip key={ch} active={channels.includes(ch)} onClick={() => toggle(ch)}>{ch}</Chip>
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

      {channels.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          최소 하나의 채널을 선택하세요
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="재입고 추적 SKU" value={String(visibleRows2.length)} foot="선택된 채널 기준" />
        <Kpi label="평균 30일 회복률" value={String(Math.round(average(visibleRows2.map((r) => r.r30))))} unit="%" foot="기준선 대비" />
        <Kpi label="평균 60일 회복률" value={String(Math.round(average(visibleRows2.map((r) => r.r60))))} unit="%" foot="기준선 대비" />
        <Kpi label="평균 90일 회복률" value={String(Math.round(average(visibleRows2.map((r) => r.r90))))} unit="%" foot="기준선 대비" />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">재입고 후 경과일별 회복률 — 채널 비교</h3>
          <span className="text-[11px] text-muted-foreground">85% 회복 평균 소요 <b className="font-mono text-foreground/80">82일</b></span>
        </div>
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
      </div>

      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            SKU별 상세 <span className="font-normal text-muted-foreground">— {visibleRows2.length}건 표시</span>
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
              {visibleRows2.map((r, i) => (
                <tr
                  key={r.sku}
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted", openIdx === i && "bg-muted")}
                >
                  <td className="px-3.5 py-2.5"><span className="font-mono font-semibold text-[#1238a0] dark:text-[#7aa2f7]">{r.sku}</span></td>
                  <td className="px-3.5 py-2.5"><ChannelBadge channel={r.channel} color={r.channelColor} /></td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.oos}일</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.restock}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.baseline.toFixed(1)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.r30}%</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.r60}%</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono font-bold tabular-nums">{r.r90}%</td>
                  <td className="px-3.5 py-2.5"><SeverityPill severity={r.severity}>{r.label}</SeverityPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && drilldownSeries && (
        <div className="planning-panel rounded-xl border p-4">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-semibold">{open.sku}</span>
              <span className="text-xs text-muted-foreground">일별 판매량(실측) vs 품절 직전 기준선</span>
            </div>
            <button type="button" onClick={() => setOpenIdx(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">닫기</button>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.5fr_1fr]">
            <LineChart
              xs={[-30, -15, 0, 15, 30, 60, 90]} xTicks={[-30, 0, 30, 60, 90]} xUnit="d"
              yMin={0} yMax={Math.max(open.baseline * 1.15, open.chart[3] * 1.15)}
              yTicks={[0, Math.round(open.baseline / 2), Math.round(open.baseline)]}
              refValue={open.baseline} refLabel={`기준선 ${open.baseline.toFixed(1)}/day`}
              marker={0} markerLabel="재입고"
              series={[{ data: drilldownSeries, color: "var(--chart-blue)", area: true, endLabel: `${open.chart[3].toFixed(1)}/day` }]}
            />
            <div className="overflow-hidden rounded-lg border border-border">
              {open.vars.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-0">
                  <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
                  <span className="font-mono font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
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
          <li>드릴다운의 모델 입력 변수 패널은 <span className="font-mono">recovery_rate_30d</span> 등 계획 문서의 필드를 그대로 매핑 — 추후 수요예측 모델 연동 시 화면 변경 없이 값만 채우면 됨.</li>
        </ul>
      </div>
    </div>
  );
}
