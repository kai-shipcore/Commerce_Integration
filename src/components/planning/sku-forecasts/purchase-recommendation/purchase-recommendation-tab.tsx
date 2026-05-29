import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, type SkuMasterMeta } from "../types";

const TARGET_DAYS = 90;

export function PurchaseRecommendationTab({
  sku,
  master,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
}) {
  const dailyAvg = sku.total_avg_curr;
  const targetQty = Math.ceil(dailyAvg * TARGET_DAYS);
  const inboundQty = sku.total_inbound_qty ?? 0;
  const projectedQty = sku.total_stock + inboundQty + Math.min(sku.back, 0);
  const rawQty = Math.max(targetQty - projectedQty, 0);
  const orderMultiple = Math.max(master.orderMultiple || master.moq || 1, 1);
  const recommendedQty = rawQty === 0 ? 0 : Math.ceil(rawQty / orderMultiple) * orderMultiple;
  const recommendedCbm = recommendedQty * master.cbmPerUnit;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Container recommendation
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className={`planning-panel rounded-lg border p-5 ${recommendedQty > 0 ? "border-[#a0c0f0] bg-[#ebf0fd] dark:border-blue-700 dark:bg-blue-900/40" : ""}`}>
          <div className="text-sm text-muted-foreground">Recommended Container Qty</div>
          <div className="mt-2 font-mono text-4xl font-bold">{formatNumber(recommendedQty)}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Multiple {formatNumber(orderMultiple)} units
          </div>
          <div className="mt-4 rounded-md border bg-white/70 p-3 text-sm dark:border-zinc-600 dark:bg-zinc-700/50">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated CBM</span>
              <span className="font-mono font-semibold">{formatNumber(recommendedCbm, 2)} m3</span>
            </div>
          </div>
        </div>

        <div className="planning-panel rounded-lg border p-5">
          <h3 className="text-sm font-semibold">Calculation</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              ["Target Days", `${TARGET_DAYS} days`],
              ["Daily Average", `${formatNumber(dailyAvg, 2)}/d`],
              ["Target Stock", formatNumber(targetQty)],
              ["Current Stock", formatNumber(sku.total_stock)],
              ["Inbound", formatNumber(inboundQty)],
              ["Backorder Impact", formatNumber(Math.min(sku.back, 0))],
              ["Projected Stock", formatNumber(projectedQty)],
              ["Raw Need", formatNumber(rawQty)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
