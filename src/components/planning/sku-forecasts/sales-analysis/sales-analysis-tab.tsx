import type { ReactNode } from "react";
import type { DemandRow } from "@/types/demand-planning";
import { formatNumber } from "../types";

export function SalesAnalysisTab({ sku }: { sku: DemandRow }) {
  const totalSales = [
    { label: "7D", value: sku.west_7d + sku.east_7d },
    { label: "15D", value: sku.west_15d + sku.east_15d },
    { label: "30D", value: sku.total_30d },
    { label: "60D", value: sku.west_60d + sku.east_60d },
    { label: "90D", value: sku.west_90d + sku.east_90d },
  ];
  const maxSales = Math.max(...totalSales.map((item) => item.value), 1);

  return (
    <div className="space-y-3">
      <SectionLabel>Sales status</SectionLabel>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="planning-panel rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Sales Trend</h3>
          <div className="mt-4 flex h-48 items-end gap-3">
            {totalSales.map((item) => (
              <div key={item.label} className="flex h-full flex-1 flex-col items-center gap-2">
                <div className="font-mono text-xs font-semibold text-[#1a4db0] dark:text-blue-400">
                  {formatNumber(item.value)}
                </div>
                <div className="flex min-h-0 w-full flex-1 items-end rounded-t bg-[#eef2f8] dark:bg-zinc-700">
                  <div
                    className="w-full rounded-t bg-[#1a5cdb] dark:bg-blue-500"
                    style={{ height: `${Math.max((item.value / maxSales) * 100, 4)}%` }}
                  />
                </div>
                <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <MetricTable
            title="West Sales"
            rows={[
              ["7D", sku.west_7d],
              ["15D", sku.west_15d],
              ["30D", sku.west_30d],
              ["60D", sku.west_60d],
              ["90D", sku.west_90d],
            ]}
          />
          <MetricTable
            title="East Sales"
            rows={[
              ["7D", sku.east_7d],
              ["15D", sku.east_15d],
              ["30D", sku.east_30d],
              ["60D", sku.east_60d],
              ["90D", sku.east_90d],
            ]}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <AverageCard title="Previous Avg." value={sku.total_avg_prev} />
        <AverageCard title="Real Avg." value={sku.total_avg_real} />
        <AverageCard title="Current Avg." value={sku.total_avg_curr} highlight />
      </div>
    </div>
  );
}

function MetricTable({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="planning-panel rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 grid grid-cols-5 gap-2 text-center text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border bg-[#f8f7f4] p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono font-semibold">{formatNumber(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AverageCard({ title, value, highlight = false }: { title: string; value: number; highlight?: boolean }) {
  return (
    <div className={`planning-panel rounded-lg border p-4 ${highlight ? "border-[#a0c0f0] bg-[#ebf0fd] dark:border-blue-700 dark:bg-blue-900/40" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 font-mono text-2xl font-semibold">{formatNumber(value, 2)}/d</div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  );
}
