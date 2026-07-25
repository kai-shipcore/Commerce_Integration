"use client";

// Code Guide: Screen 1 — Shopify Pre-Order conversion drop rate.
// Owns its own sample data and screen-only pieces (StageTag, Histogram).
// Only touch shared.tsx for things this file and recovery-screen.tsx both need.

import { useState } from "react";
import { Clock, PackageCheck, Search, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, FilterRow, Kpi, LineChart, SeverityPill, average, type Severity } from "./shared";

// normalRange = 30 days ending the day BEFORE convDate (regular sale)
// poRange     = 30 days starting AT convDate (Pre-Order)
interface Row1 {
  sku: string;
  channel: string;
  normalRange: string;
  pre: number;
  convDate: string;
  poRange: string;
  post: number;
  before: number;
  after: number;
  drop: number;
  severity: Severity;
  stage: "active" | "ended";
}

const ROWS1: Row1[] = [
  { sku: "CA-SC-10-F-40-WR-1TO", channel: "Coverland B2C", normalRange: "05/25 – 06/23", pre: 10.0, convDate: "2026-06-24", poRange: "06/24 – 07/23", post: 5.0, before: 10, after: 5, drop: 50, severity: "serious", stage: "active" },
  { sku: "CA-SC-10-B-02-WR-1TO", channel: "Coverland B2C", normalRange: "05/20 – 06/18", pre: 8.4, convDate: "2026-06-19", poRange: "06/19 – 07/18", post: 6.9, before: 84, after: 69, drop: 18, severity: "good", stage: "ended" },
  { sku: "CC-CS-15-I-GRBK-STR", channel: "Icarcover", normalRange: "05/01 – 05/30", pre: 4.2, convDate: "2026-05-31", poRange: "05/31 – 06/29", post: 1.1, before: 42, after: 11, drop: 74, severity: "critical", stage: "active" },
  { sku: "CA-FM-TX-80-XL", channel: "Coverland B2B", normalRange: "06/01 – 06/30", pre: 6.0, convDate: "2026-07-01", poRange: "07/01 – 07/30", post: 3.9, before: 60, after: 39, drop: 35, severity: "warning", stage: "active" },
  { sku: "CA-SC-10-F-52-WR-1TO", channel: "Coverland B2C", normalRange: "04/27 – 05/26", pre: 3.3, convDate: "2026-05-27", poRange: "05/27 – 06/25", post: 2.6, before: 33, after: 26, drop: 21, severity: "warning", stage: "ended" },
  { sku: "CA-CC-15-BMZ301-BK", channel: "Coverland B2B", normalRange: "06/04 – 07/03", pre: 2.1, convDate: "2026-07-04", poRange: "07/04 – 08/02", post: 1.5, before: 21, after: 15, drop: 29, severity: "warning", stage: "active" },
  { sku: "CA-SC-10-B-11-WR-1TO", channel: "Coverland B2C", normalRange: "05/10 – 06/08", pre: 5.6, convDate: "2026-06-09", poRange: "06/09 – 07/08", post: 2.0, before: 56, after: 20, drop: 64, severity: "critical", stage: "active" },
  { sku: "CA-FM-TX-80-M", channel: "Coverland B2B", normalRange: "03/18 – 04/16", pre: 4.9, convDate: "2026-04-17", poRange: "04/17 – 05/16", post: 4.4, before: 49, after: 44, drop: 10, severity: "good", stage: "ended" },
  { sku: "CA-CC-15-CHCM11-GR", channel: "Icarcover", normalRange: "05/29 – 06/27", pre: 1.8, convDate: "2026-06-28", poRange: "06/28 – 07/27", post: 0.9, before: 18, after: 9, drop: 50, severity: "serious", stage: "active" },
  { sku: "CA-SC-10-F-40-WR-2TO", channel: "Coverland B2C", normalRange: "04/01 – 04/30", pre: 7.2, convDate: "2026-05-01", poRange: "05/01 – 05/30", post: 5.6, before: 72, after: 56, drop: 22, severity: "warning", stage: "ended" },
];

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianExplanation(nums: number[]): string {
  if (nums.length === 0) return "계산할 SKU가 없습니다.";
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return `감소율을 낮은 순으로 정렬했을 때 ${mid + 1}번째 값 ${sorted[mid]}%입니다.`;
  }
  return `감소율을 낮은 순으로 정렬했을 때 ${mid}번째 값 ${sorted[mid - 1]}%와 ${mid + 1}번째 값 ${sorted[mid]}%의 평균입니다.`;
}

function histogramFrom(drops: number[]): { label: string; count: number }[] {
  const buckets = [
    { label: "0–20%", min: 0, max: 20 },
    { label: "20–40%", min: 20, max: 40 },
    { label: "40–60%", min: 40, max: 60 },
    { label: "60–80%", min: 60, max: 80 },
    { label: "80–100%", min: 80, max: 101 },
  ];
  return buckets.map((b) => ({
    label: b.label,
    count: drops.filter((d) => d >= b.min && d < b.max).length,
  }));
}

// 진행 상태(Pre-Order 진행중 / 재입고 완료)는 감소율 심각도와는 다른 축이라
// 색을 넣지 않고 중립 태그로 분리해서 표시한다.
function StageTag({ stage }: { stage: Row1["stage"] }) {
  const Icon = stage === "active" ? Clock : PackageCheck;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
      <Icon className="h-3 w-3" />
      {stage === "active" ? "Pre-Order 진행중" : "재입고 완료"}
    </span>
  );
}

function Histogram({
  bins, medianValue, medianLabel, medianDescription,
}: {
  bins: { label: string; count: number }[];
  medianValue: number;
  medianLabel: string;
  medianDescription: string;
}) {
  const width = 900, height = 200, padL = 34, padR = 10, padT = 10, padB = 26;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const bw = plotW / bins.length;
  const medianX = padL + plotW * (Math.min(100, Math.max(0, medianValue)) / 100);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {bins.map((b, i) => {
        const h = (b.count / max) * plotH;
        const x = padL + i * bw + bw * 0.22;
        const w = bw * 0.56;
        const y = padT + plotH - h;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={w} height={h} rx={4} ry={4} fill="var(--chart-blue)" />
            <text x={x + w / 2} y={y - 5} textAnchor="middle" fontSize={10} fill="var(--foreground)">{b.count}</text>
            <text x={x + w / 2} y={padT + plotH + 16} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{b.label}</text>
          </g>
        );
      })}
      <g className="cursor-help">
        <title>{`${medianLabel}: ${medianDescription}`}</title>
        <line x1={medianX} x2={medianX} y1={padT} y2={padT + plotH} stroke="transparent" strokeWidth={14} />
        <line x1={medianX} x2={medianX} y1={padT} y2={padT + plotH} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={medianX + 6} y={padT + 10} fontSize={10} fontWeight={700} fill="var(--foreground)">{medianLabel}</text>
      </g>
    </svg>
  );
}

const SHOPIFY_CHANNELS = ["Coverland B2C", "Coverland B2B", "Icarcover"] as const;

export function PreorderScreen() {
  const [items, setItems] = useState(["전체"]);
  const [channels, setChannels] = useState<string[]>([...SHOPIFY_CHANNELS]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const visibleRows = ROWS1.filter((r) => channels.includes(r.channel));
  const drops = visibleRows.map((r) => r.drop);
  const maxDropRow = visibleRows.length ? visibleRows.reduce((a, b) => (b.drop > a.drop ? b : a)) : null;
  const bins = histogramFrom(drops);
  const medianDrop = median(drops);
  const medianDetail = medianExplanation(drops);

  // Bounds-check instead of resetting via effect: if a channel toggle shrinks
  // the list out from under an open row, the drawer just closes on its own.
  const open = openIdx !== null && openIdx < visibleRows.length ? visibleRows[openIdx] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="planning-panel flex flex-col gap-3 rounded-xl border p-4">
        <FilterRow label="아이템">
          {["전체", "Car Cover", "Seat Cover", "Floor Mat", "SWC"].map((it) => (
            <Chip key={it} active={items.includes(it)} onClick={() => toggle(items, setItems, it)}>{it}</Chip>
          ))}
        </FilterRow>
        <FilterRow label="채널">
          {SHOPIFY_CHANNELS.map((ch) => (
            <Chip key={ch} active={channels.includes(ch)} onClick={() => toggle(channels, setChannels, ch)}>{ch}</Chip>
          ))}
          <Chip ghost title="Pre-Order는 Shopify 전용 기능이라 다른 채널은 이 화면 대상이 아님">
            Amazon / eBay / Walmart 해당 없음
          </Chip>
        </FilterRow>
      </div>

      {channels.length === 0 ? (
        <div className="planning-panel flex min-h-[240px] items-center justify-center rounded-xl border text-sm text-muted-foreground">
          최소 하나의 채널을 선택하세요
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="분석 대상 SKU" value={String(visibleRows.length)} foot="선택된 채널 기준" />
        <Kpi label="평균 판매 감소율" value={String(Math.round(average(drops)))} unit="%" foot="선택된 채널 평균" />
        <Kpi
          label="중앙값 감소율"
          value={String(Math.round(medianDrop))}
          unit="%"
          foot={`전체 ${visibleRows.length}개 SKU의 가운데 값 · 극단값의 영향을 평균보다 덜 받음`}
        />
        <Kpi
          label="최대 감소 SKU"
          value={<span className="font-mono text-sm">{maxDropRow?.sku ?? "—"}</span>}
          foot={maxDropRow ? <span><b className="font-mono text-foreground">{maxDropRow.drop}%</b> 감소 — 확인 필요</span> : "해당 없음"}
        />
      </div>

      <div className="planning-panel rounded-xl border p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">SKU별 감소율 분포</h3>
          <span className="text-[11px] text-muted-foreground">{visibleRows.length}개 SKU · 구간별 개수</span>
        </div>
        <Histogram
          bins={bins}
          medianValue={medianDrop}
          medianLabel={`전체 ${visibleRows.length}개 SKU 중앙값 ${Math.round(medianDrop)}%`}
          medianDescription={medianDetail}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          <strong className="text-foreground">중앙값 계산:</strong> {medianDetail}
        </p>
      </div>

      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <span className="text-[12.5px] font-semibold">
            SKU별 상세 <span className="font-normal text-muted-foreground">— {visibleRows.length}건 표시</span>
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
                {["Master SKU", "정상판매 구간", "정상 일평균", "Pre-Order 구간", "PO 일평균", "Before / After", "감소율", "진행 상태"].map((h, i) => (
                  <th key={h} className={cn("whitespace-nowrap border-b border-border px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground", i >= 2 && (i === 2 || i === 4 || i === 6) && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr
                  key={r.sku}
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted", openIdx === i && "bg-muted")}
                >
                  <td className="px-3.5 py-2.5"><span className="font-mono font-semibold text-[#1238a0] dark:text-[#7aa2f7]">{r.sku}</span></td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.normalRange}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.pre.toFixed(1)}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-muted-foreground">{r.poRange}</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono tabular-nums">{r.post.toFixed(1)}</td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex h-[22px] items-end gap-[3px]">
                      <div className="w-[7px] rounded-t-sm bg-[var(--chart-baseline-bar)]" style={{ height: Math.max(4, (r.before / 100) * 22) }} title={`정상 ${r.before}`} />
                      <div className="w-[7px] rounded-t-sm bg-[var(--chart-orange)]" style={{ height: Math.max(4, (r.after / 100) * 22) }} title={`PO ${r.after}`} />
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <SeverityPill severity={r.severity}><TrendingDown className="h-3 w-3" />{r.drop}%</SeverityPill>
                  </td>
                  <td className="px-3.5 py-2.5"><StageTag stage={r.stage} /></td>
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
              <span className="text-xs text-muted-foreground">일별 판매량 · 정상 구간 vs Pre-Order 구간</span>
            </div>
            <button type="button" onClick={() => setOpenIdx(null)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground">닫기</button>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.5fr_1fr]">
            <LineChart
              xs={[-30, -20, -10, -1, 5, 15, 25, 30]}
              yMin={0} yMax={12} yTicks={[0, 5, 10]} xTicks={[]}
              marker={-1} markerLabel="전환일"
              series={[{ data: [open.pre, open.pre * 1.04, open.pre * 0.96, open.pre, open.post * 1.04, open.post * 0.96, open.post * 1.02, open.post], color: "var(--chart-blue)", area: true, endLabel: `${open.post.toFixed(1)}/day` }]}
            />
            <div className="overflow-hidden rounded-lg border border-border">
              {[
                ["pre_baseline_demand", `${open.pre.toFixed(1)} / day`],
                ["post_conversion_demand", `${open.post.toFixed(1)} / day`],
                ["drop_rate", `${open.drop}%`],
                ["conversion_date", open.convDate],
                ["stage", open.stage === "active" ? "Pre-Order 진행중" : "재입고 완료"],
              ].map(([k, v]) => (
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
          <li>채널 필터가 Shopify 3개뿐인 이유 — Pre-Order는 Shopify 전용 기능이라 Amazon/eBay/Walmart는 애초에 이 화면의 분석 대상이 아님 (다른 채널은 재입고 회복 화면에서 별도로 다룸).</li>
          <li>Before/After는 추세가 아닌 두 구간의 단순 비교라 라인이 아닌 막대 2개로 표현.</li>
          <li>정상판매/Pre-Order 구간은 SKU마다 길이가 다를 수 있음 — 전환 후 실제 경과일만큼을 Pre-Order 구간으로 잡고, 정상판매 구간도 항상 같은 길이로 맞춤. 전역으로 &quot;7D/30D/60D&quot;를 고정하지 않는 이유는 SKU마다 전환일(anchor)이 달라서 같은 절대 기간을 강제하면 방금 전환된 SKU는 계산이 안 되기 때문.</li>
          <li>감소율(심각도)과 진행 상태(Pre-Order 진행중 / 재입고 완료)는 서로 다른 축이라 컬럼을 분리 — 색 있는 pill은 심각도, 색 없는 태그는 생애주기 상태.</li>
        </ul>
      </div>
    </div>
  );
}
