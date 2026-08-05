// Code Guide:
// Primitives shared by both OOS-impact screens (preorder-screen.tsx,
// recovery-screen.tsx). Anything used by only one screen belongs in that
// screen's own file, not here — keep this file lean so both people working
// on separate screens rarely need to touch it at the same time.

import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n-provider";

export type Severity = "good" | "warning" | "serious" | "critical";

// ---------------------------------------------------------------------------
// Sortable-table header icon — used by both screens' "SKU별 상세" tables.
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

export function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return <Icon className="ml-1 inline h-3 w-3 text-foreground" />;
}

// ---------------------------------------------------------------------------
// Pagination — used below both screens' "SKU별 상세" tables.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100];

export function Pagination({
  page, totalPages, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = PAGE_SIZES,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  const { pick } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span>{pick("페이지당", "Per page")}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded border border-border bg-background px-1.5 py-1 text-[11px] outline-none"
        >
          {pageSizeOptions.map((s) => <option key={s} value={s}>{pick(`${s}개`, `${s} rows`)}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted"
        >
          ‹
        </button>
        <span>{page} / {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export const SEVERITY_STYLES: Record<Severity, string> = {
  good: "bg-[#e6f6e6] text-[#0ca30c] dark:bg-[#0c2c14] dark:text-[#3ecf3e]",
  warning: "bg-[#fef3d9] text-[#a5670a] dark:bg-[#3a2a0c] dark:text-[#f0ad2e]",
  serious: "bg-[#fde7de] text-[#c2542e] dark:bg-[#3a2015] dark:text-[#f0895f]",
  critical: "bg-[#fbe4e4] text-[#d03b3b] dark:bg-[#3a1414] dark:text-[#f26a6a]",
};

const SEVERITY_ICON: Record<Severity, typeof CheckCircle2> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertTriangle,
  critical: XCircle,
};

export function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function medianExplanation(nums: number[], locale: "ko" | "en" = "ko"): string {
  if (nums.length === 0) return locale === "ko" ? "계산할 SKU가 없습니다." : "No SKUs are available for calculation.";
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return locale === "ko"
      ? `낮은 순으로 정렬했을 때 ${mid + 1}번째 값 ${sorted[mid]}%입니다.`
      : `When sorted from lowest to highest, the median is value ${mid + 1}: ${sorted[mid]}%.`;
  }
  return locale === "ko"
    ? `낮은 순으로 정렬했을 때 ${mid}번째 값 ${sorted[mid - 1]}%와 ${mid + 1}번째 값 ${sorted[mid]}%의 평균입니다.`
    : `When sorted from lowest to highest, the median is the average of values ${mid} (${sorted[mid - 1]}%) and ${mid + 1} (${sorted[mid]}%).`;
}

export interface PercentBucket { label: string; min: number; max: number; }

export const PERCENT_BUCKETS: PercentBucket[] = [
  { label: "0–20%", min: 0, max: 20 },
  { label: "20–40%", min: 20, max: 40 },
  { label: "40–60%", min: 40, max: 60 },
  { label: "60–80%", min: 60, max: 80 },
  { label: "80–100%", min: 80, max: 101 },
];

export function histogramFrom(values: number[], buckets: PercentBucket[] = PERCENT_BUCKETS): { label: string; count: number }[] {
  return buckets.map((b) => ({
    label: b.label,
    count: values.filter((v) => v >= b.min && v < b.max).length,
  }));
}

export function Chip({
  active, onClick, children, ghost, title,
}: { active?: boolean; onClick?: () => void; children: React.ReactNode; ghost?: boolean; title?: string }) {
  if (ghost) {
    return (
      <span title={title} className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-24 shrink-0 text-[11px] font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Kpi({
  label, value, unit, foot, active = false, onClick,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  foot?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {value}
        {unit && <span className="ml-0.5 font-sans text-sm font-semibold text-foreground/70">{unit}</span>}
      </span>
      {foot && <span className="text-[11px] text-muted-foreground">{foot}</span>}
    </>
  );
  const className = cn(
    "planning-panel flex w-full flex-col gap-1.5 rounded-xl border p-4 text-left",
    onClick && "cursor-pointer transition-colors hover:border-foreground/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active && "border-foreground/60 bg-muted/40 ring-2 ring-foreground/15",
  );

  if (onClick) {
    return (
      <button type="button" aria-pressed={active} onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

export function SeverityPill({ severity, children }: { severity: Severity; children: React.ReactNode }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold", SEVERITY_STYLES[severity])}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LineChart — plain computed SVG, no charting library. Used by both screens'
// main charts and both drilldown panels.
// ---------------------------------------------------------------------------

export interface LineSeries {
  data: number[];
  color: string;
  dashed?: boolean;
  area?: boolean;
  endLabel?: string;
}

export interface ChartMarker {
  at: number;
  label?: string;
  color?: string;
}

export function LineChart({
  xs, series, yMin, yMax, yTicks, xTicks, xUnit = "", yUnit = "",
  refValue, refLabel, markers, height = 240, labelFontSize = 10,
}: {
  xs: number[]; series: LineSeries[]; yMin: number; yMax: number; yTicks: number[];
  xTicks?: number[]; xUnit?: string; yUnit?: string;
  refValue?: number; refLabel?: string; markers?: ChartMarker[]; height?: number; labelFontSize?: number;
}) {
  const width = 900;
  const padL = labelFontSize > 10 ? 52 : 38;
  const padR = labelFontSize > 10 ? 24 : 16;
  const padT = labelFontSize > 10 ? labelFontSize * 2 + 12 : 18;
  const padB = labelFontSize > 10 ? 36 : 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const [xMinV, xMaxV] = [xs[0], xs[xs.length - 1]];
  const X = (x: number) => padL + ((x - xMinV) / (xMaxV - xMinV || 1)) * plotW;
  const Y = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;
  // Callers sometimes derive ticks from rounded data (e.g. Math.round(baseline/2)),
  // which can collide for small values — dedupe so React keys stay unique and we
  // don't draw the same gridline/label on top of itself.
  const uniqueYTicks = [...new Set(yTicks)];
  const uniqueXTicks = [...new Set(xTicks ?? xs)];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible">
      {uniqueYTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 8} y={Y(t) + labelFontSize * 0.35} textAnchor="end" fontSize={labelFontSize} fontWeight={600} fill="var(--muted-foreground)">{t}{yUnit}</text>
        </g>
      ))}
      {uniqueXTicks.map((t) => (
        <text key={`x${t}`} x={X(t)} y={height - padB + labelFontSize + 5} textAnchor="middle" fontSize={labelFontSize} fontWeight={600} fill="var(--muted-foreground)">{t}{xUnit}</text>
      ))}
      {refValue !== undefined && (
        <g>
          <line x1={padL} x2={width - padR} y1={Y(refValue)} y2={Y(refValue)} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          {refLabel && <text x={width - padR} y={Y(refValue) - 7} textAnchor="end" fontSize={labelFontSize} fill="var(--muted-foreground)" fontWeight={700}>{refLabel}</text>}
        </g>
      )}
      {markers?.map((m, mi) => (
        <g key={mi}>
          <line x1={X(m.at)} x2={X(m.at)} y1={padT} y2={height - padB} stroke={m.color ?? "var(--foreground)"} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.55} />
          {m.label && <text x={X(m.at)} y={padT - 7} textAnchor="middle" fontSize={labelFontSize + 1} fontWeight={700} fill={m.color ?? "var(--foreground)"}>{m.label}</text>}
        </g>
      ))}
      {series.map((s, si) => {
        const pts = xs.map((x, i) => `${X(x)},${Y(s.data[i])}`).join(" ");
        const lastX = X(xs[xs.length - 1]);
        const lastY = Y(s.data[s.data.length - 1]);
        return (
          <g key={si}>
            {s.area && (
              <polygon points={`${pts} ${X(xMaxV)},${Y(yMin)} ${X(xMinV)},${Y(yMin)}`} fill={s.color} opacity={0.1} />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={lastX} cy={lastY} r={4} fill={s.color} />
            <circle cx={lastX} cy={lastY} r={6} fill="none" stroke={s.color} strokeWidth={1.5} opacity={0.4} />
            {s.endLabel && (
              <text
                x={labelFontSize > 10 ? lastX - 9 : lastX + 8}
                y={labelFontSize > 10 ? lastY - 10 : lastY + labelFontSize * 0.35}
                textAnchor={labelFontSize > 10 ? "end" : "start"}
                fontSize={labelFontSize}
                fontWeight={700}
                fill={s.color}
              >
                {s.endLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Histogram — plain computed SVG bar chart with a median marker. Used for
// SKU-count-by-percent-bucket distributions (drop rate, recovery rate, ...).
// onBinClick/activeIndex are optional so non-interactive callers are unaffected.
// ---------------------------------------------------------------------------

export function Histogram({
  bins, medianValue, medianPosition, medianLabel, medianDescription, activeIndex, onBinClick,
}: {
  bins: { label: string; count: number }[];
  // Omit all three when bins aren't points on a continuous 0–100 scale (e.g.
  // discrete outcome categories) — the median line only makes sense for a
  // percent-style distribution like preorder-screen's drop-rate histogram.
  medianValue?: number;
  medianPosition?: number;
  medianLabel?: string;
  medianDescription?: string;
  activeIndex?: number | null;
  onBinClick?: (index: number) => void;
}) {
  const width = 900, height = 200, padL = 34, padR = 10, padT = 10, padB = 26;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const bw = plotW / bins.length;
  const showMedian = medianValue !== undefined && medianLabel !== undefined;
  const medianX = padL + plotW * (medianPosition ?? (Math.min(100, Math.max(0, medianValue ?? 0)) / 100));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{Math.round(max * f).toLocaleString("en-US")}</text>
          </g>
        );
      })}
      {bins.map((b, i) => {
        const h = (b.count / max) * plotH;
        const x = padL + i * bw + bw * 0.22;
        const w = bw * 0.56;
        const y = padT + plotH - h;
        const isActive = activeIndex === i;
        const isDimmed = activeIndex != null && !isActive;
        return (
          <g key={b.label}>
            <rect
              x={x} y={y} width={w} height={h} rx={4} ry={4}
              fill="var(--chart-blue)"
              opacity={isDimmed ? 0.35 : 1}
              stroke={isActive ? "var(--foreground)" : "none"}
              strokeWidth={isActive ? 2 : 0}
              className={onBinClick ? "cursor-pointer" : undefined}
              onClick={onBinClick ? () => onBinClick(i) : undefined}
            />
            <text
              x={x + w / 2}
              y={y - 5}
              textAnchor="middle"
              fontSize={10}
              fill="var(--foreground)"
              className={onBinClick ? "cursor-pointer select-none" : undefined}
              onClick={onBinClick ? () => onBinClick(i) : undefined}
            >
              {b.count.toLocaleString("en-US")}
            </text>
            <text x={x + w / 2} y={padT + plotH + 16} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{b.label}</text>
          </g>
        );
      })}
      {showMedian && (
        <g className="cursor-help">
          <title>{`${medianLabel}: ${medianDescription ?? ""}`}</title>
          <line x1={medianX} x2={medianX} y1={padT} y2={padT + plotH} stroke="transparent" strokeWidth={14} />
          <line x1={medianX} x2={medianX} y1={padT} y2={padT + plotH} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={medianX + 6} y={padT + 10} fontSize={10} fontWeight={700} fill="var(--foreground)">{medianLabel}</text>
        </g>
      )}
    </svg>
  );
}
