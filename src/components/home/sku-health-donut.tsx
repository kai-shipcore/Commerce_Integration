"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface StockDistribution {
  d0_30: number;
  d30_60: number;
  d60_180: number;
  d180plus: number;
}

interface Props {
  distribution: StockDistribution;
  loading?: boolean;
}

const SEGMENTS = [
  { key: "d0_30"   as const, labelKo: "위험 (≤ 30일)",    labelEn: "Critical (≤30d)",  color: "#dc2626" },
  { key: "d30_60"  as const, labelKo: "품절 예상 (31~60일)", labelEn: "At Risk (31–60d)", color: "#d97706" },
  { key: "d60_180" as const, labelKo: "정상 (61~180일)",   labelEn: "Healthy (61–180d)", color: "#22c55e" },
  { key: "d180plus"as const, labelKo: "과잉 재고 (181일+)", labelEn: "Overstock (181d+)", color: "#2563eb" },
];

export function SkuHealthDonut({ distribution, loading }: Props) {
  const { pick } = useI18n();

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="h-[200px] w-[200px] animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  const data = SEGMENTS.map((seg) => ({
    name:  pick(seg.labelKo, seg.labelEn),
    value: distribution[seg.key],
    color: seg.color,
  }));

  return (
    <div className="flex h-full flex-col">
      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {pick("데이터 없음", "No data")}
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={72}
                outerRadius={106}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [(value as number).toLocaleString()]}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>

          <div className="mt-2 space-y-1.5">
            {SEGMENTS.map((seg) => {
              const value = distribution[seg.key];
              const pct   = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <div key={seg.key} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
                  <span className="flex-1 text-muted-foreground">{pick(seg.labelKo, seg.labelEn)}</span>
                  <span className="tabular-nums font-medium">{value.toLocaleString()}</span>
                  <span className="w-9 text-right tabular-nums text-muted-foreground">({pct}%)</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
