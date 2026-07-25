// Code Guide:
// Primitives shared by both OOS-impact screens (preorder-screen.tsx,
// recovery-screen.tsx). Anything used by only one screen belongs in that
// screen's own file, not here — keep this file lean so both people working
// on separate screens rarely need to touch it at the same time.

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type Severity = "good" | "warning" | "serious" | "critical";

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
  label, value, unit, foot,
}: { label: string; value: React.ReactNode; unit?: string; foot?: React.ReactNode }) {
  return (
    <div className="planning-panel flex flex-col gap-1.5 rounded-xl border p-4">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {value}
        {unit && <span className="ml-0.5 font-sans text-sm font-semibold text-foreground/70">{unit}</span>}
      </span>
      {foot && <span className="text-[11px] text-muted-foreground">{foot}</span>}
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

export function LineChart({
  xs, series, yMin, yMax, yTicks, xTicks, xUnit = "", yUnit = "",
  refValue, refLabel, marker, markerLabel, height = 240,
}: {
  xs: number[]; series: LineSeries[]; yMin: number; yMax: number; yTicks: number[];
  xTicks?: number[]; xUnit?: string; yUnit?: string;
  refValue?: number; refLabel?: string; marker?: number; markerLabel?: string; height?: number;
}) {
  const width = 900;
  const padL = 38, padR = 16, padT = 18, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const [xMinV, xMaxV] = [xs[0], xs[xs.length - 1]];
  const X = (x: number) => padL + ((x - xMinV) / (xMaxV - xMinV || 1)) * plotW;
  const Y = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible">
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 8} y={Y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{t}{yUnit}</text>
        </g>
      ))}
      {(xTicks ?? xs).map((t) => (
        <text key={`x${t}`} x={X(t)} y={height - padB + 16} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{t}{xUnit}</text>
      ))}
      {refValue !== undefined && (
        <g>
          <line x1={padL} x2={width - padR} y1={Y(refValue)} y2={Y(refValue)} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          {refLabel && <text x={width - padR} y={Y(refValue) - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" fontWeight={600}>{refLabel}</text>}
        </g>
      )}
      {marker !== undefined && (
        <g>
          <line x1={X(marker)} x2={X(marker)} y1={padT} y2={height - padB} stroke="var(--foreground)" strokeWidth={1.25} strokeDasharray="3 3" opacity={0.55} />
          {markerLabel && <text x={X(marker)} y={padT - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--foreground)">{markerLabel}</text>}
        </g>
      )}
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
            {s.endLabel && <text x={lastX + 8} y={lastY + 4} fontSize={10} fontWeight={700} fill={s.color}>{s.endLabel}</text>}
          </g>
        );
      })}
    </svg>
  );
}
