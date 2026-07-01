"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface ParetoData {
  x: number[];
  y: number[];
  annotation: { sku_pct: number; demand_pct: number } | null;
}


const HEIGHT_RATIO = 0.44;
const PL = 62, PR = 28, PT = 24, PB = 52;
const TICKS = [0, 25, 50, 75, 100];
const LABEL_W = 210, LABEL_H = 44;

export function DemandConcentration({
  pareto,
}: {
  pareto: ParetoData;
}) {
  const { pick } = useI18n();
  const { x, y, annotation: ann } = pareto;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 396 });
  const [hoverPt, setHoverPt] = useState<{ px: number; py: number; sku_pct: number; demand_pct: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setDims({ w, h: Math.round(w * HEIGHT_RATIO) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { w, h } = dims;
  const PW = w - PL - PR;
  const PH = h - PT - PB;

  const sx = (p: number) => PL + (p / 100) * PW;
  const sy = (p: number) => PT + PH - (p / 100) * PH;

  // Curve path — prepend origin
  const curveParts = [`M ${sx(0).toFixed(1)},${sy(0).toFixed(1)}`];
  for (let i = 0; i < x.length; i++) {
    curveParts.push(`L ${sx(x[i]).toFixed(1)},${sy(y[i]).toFixed(1)}`);
  }
  const curvePath = curveParts.join(" ");

  // Mouse handlers
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || x.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const dataX = (mouseX - PL) / PW * 100;
    if (dataX < 0 || dataX > 100) { setHoverPt(null); return; }

    let lo = 0, hi = x.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= dataX) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (idx + 1 < x.length && Math.abs(x[idx + 1] - dataX) < Math.abs(x[idx] - dataX)) idx++;

    const curveY_svg = sy(y[idx]);
    const diagY_svg  = sy(dataX);
    if (mouseY < curveY_svg || mouseY > diagY_svg) { setHoverPt(null); return; }

    setHoverPt({
      px: sx(x[idx]),
      py: sy(y[idx]),
      sku_pct: Math.round(x[idx] * 10) / 10,
      demand_pct: Math.round(y[idx] * 10) / 10,
    });
  }

  function handleMouseLeave() { setHoverPt(null); }

  // Shared annotation box
  function AnnotationBox({
    px, py, sku_pct, demand_pct, isHover,
  }: { px: number; py: number; sku_pct: number; demand_pct: number; isHover: boolean }) {
    const labelLeft = sku_pct > 50;
    let rx = labelLeft ? px - 182 : px + 10;
    rx = Math.max(1, Math.min(w - LABEL_W - 1, rx));
    const ry = Math.max(PT + 4, py) + 12;

    const dotFill   = isHover ? "#6b7280" : "#2563eb";
    const border    = isHover ? "#e5e7eb" : "#dbeafe";
    const titleFill = isHover ? "#374151" : "#1d4ed8";
    const subFill   = isHover ? "#6b7280" : "#3b82f6";
    const dashColor = isHover ? "#d1d5db" : "#93c5fd";
    const tickFill  = isHover ? "#6b7280" : "#2563eb";

    return (
      <g>
        <line x1={px} y1={py} x2={px} y2={sy(0)} stroke={dashColor} strokeWidth="1" strokeDasharray="3,3" />
        <line x1={sx(0)} y1={py} x2={px} y2={py} stroke={dashColor} strokeWidth="1" strokeDasharray="3,3" />
        <text x={px} y={PT + PH + 16} textAnchor="middle" fontSize="10" fill={tickFill} fontWeight="600">
          {sku_pct}%
        </text>
        <text x={PL - 7} y={py} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={tickFill} fontWeight="600">
          {demand_pct}%
        </text>
        <circle cx={px} cy={py} r="4.5" fill={dotFill} stroke="white" strokeWidth="2" />
        <rect x={rx} y={ry} width={LABEL_W} height={LABEL_H} rx="4" fill="white" stroke={border} strokeWidth="1" />
        <text x={rx + LABEL_W / 2} y={ry + 15} textAnchor="middle" fontSize="12.5" fontWeight="600" fill={titleFill}>
          {isHover ? pick(`상위 ${sku_pct}% SKU`, `Top ${sku_pct}% of SKUs`) : pick("예측된 SKU", "Forecasted SKUs")}
        </text>
        <text x={rx + LABEL_W / 2} y={ry + 32} textAnchor="middle" fontSize="11.5" fill={subFill}>
          {isHover
            ? pick(`수요의 ${demand_pct}%`, `${demand_pct}% of demand`)
            : pick(`SKU ${sku_pct}% → 수요 ${demand_pct}%`, `${sku_pct}% of SKUs → ${demand_pct}% of demand`)}
        </text>
      </g>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-1 pt-4">
        <CardTitle className="text-sm font-medium">{pick("수요 집중도", "Demand concentration")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {pick(
            "SKU를 수량 기준 높은 순으로 추가할 때 수요의 누적 비율입니다. 대각선 위의 간격이 수요가 얼마나 집중되어 있는지를 나타냅니다.",
            "Cumulative share of demand as SKUs are added from highest to lowest volume. The gap above the diagonal shows how concentrated demand is.",
          )}
        </p>
      </CardHeader>
      <CardContent className="pb-4 pt-1">
        <div ref={containerRef} className="min-w-0 flex-1">
          <svg
            ref={svgRef}
            width={w}
            height={h}
            style={{ display: "block", cursor: "crosshair" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            aria-hidden="true"
          >

            {/* Grid lines */}
            {TICKS.map((t) => (
              <g key={t}>
                {t > 0 && (
                  <>
                    <line x1={sx(0)} y1={sy(t)} x2={sx(100)} y2={sy(t)} stroke="#e5e7eb" strokeWidth="1" />
                    <line x1={sx(t)} y1={sy(100)} x2={sx(t)} y2={sy(0)} stroke="#e5e7eb" strokeWidth="1" />
                  </>
                )}
                <text x={PL - 7} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#9ca3af">
                  {t}%
                </text>
                <text x={sx(t)} y={PT + PH + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
                  {t}%
                </text>
              </g>
            ))}

            {/* Axes */}
            <line x1={sx(0)} y1={sy(0)} x2={sx(100)} y2={sy(0)} stroke="#e5e7eb" strokeWidth="1" />
            <line x1={sx(0)} y1={sy(0)} x2={sx(0)} y2={sy(100)} stroke="#e5e7eb" strokeWidth="1" />

            {/* Diagonal reference — even distribution */}
            <line
              x1={sx(0)} y1={sy(0)} x2={sx(100)} y2={sy(100)}
              stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="5,4"
            />
            <text
              x={sx(38)} y={sy(38) + 11}
              textAnchor="middle" fontSize="9.5" fill="#9ca3af"
              transform={`rotate(-42, ${sx(38)}, ${sy(38) + 11})`}
            >
              {pick("균등 분포", "even distribution")}
            </text>

            {/* Pareto curve */}
            <path
              d={curvePath}
              fill="none"
              stroke="#1e40af"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Fixed annotation — hidden while hovering */}
            {!hoverPt && ann && (
              <AnnotationBox
                px={sx(ann.sku_pct)}
                py={sy(ann.demand_pct)}
                sku_pct={ann.sku_pct}
                demand_pct={ann.demand_pct}
                isHover={false}
              />
            )}

            {/* Hover annotation */}
            {hoverPt && (
              <AnnotationBox
                px={hoverPt.px}
                py={hoverPt.py}
                sku_pct={hoverPt.sku_pct}
                demand_pct={hoverPt.demand_pct}
                isHover={true}
              />
            )}

            {/* Axis titles */}
            <text x={sx(50)} y={h - 6} textAnchor="middle" fontSize="10.5" fill="#6b7280">
              {pick("% SKU (수요 기준 내림차순 정렬)", "% of SKUs (sorted by demand, highest first)")}
            </text>
            <text
              x={10}
              y={sy(50)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="10.5"
              fill="#6b7280"
              transform={`rotate(-90, 10, ${sy(50)})`}
            >
              {pick("% 수요", "% of demand")}
            </text>
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
