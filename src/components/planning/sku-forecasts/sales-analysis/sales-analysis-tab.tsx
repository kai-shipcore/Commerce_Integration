import type { ReactNode } from "react";
import { getWeightedAverage, type MockSku } from "@/features/planning/mock-data";

export function SalesAnalysisTab({ sku }: { sku: MockSku }) {
  const weightedAverage = getWeightedAverage(sku.linkSales);

  return (
    <div className="space-y-3">
      <SectionLabel>Sales trend (90 days)</SectionLabel>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
      <div className="planning-panel rounded-xl border p-4">
        <h3 className="text-lg font-semibold">Sales Trend</h3>
        <div className="mt-4 flex h-40 items-end gap-2">
          {sku.linkSales.map((value, index) => (
            <div
              key={`${value}-${index}`}
              className="flex-1 rounded-t bg-[#1a5cdb]"
              style={{ height: `${Math.max(value, 8)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="planning-panel rounded-xl border p-4">
          <h3 className="text-lg font-semibold">Channel Sales</h3>
          <div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm">
            {["7D", "15D", "30D", "60D", "90D"].map((label, index) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-semibold">{sku.linkSales[index]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="planning-panel rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Weighted Average</div>
          <div className="mt-2 text-3xl font-semibold">{weightedAverage.toFixed(2)}/d</div>
        </div>
      </div>
    </div>
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
