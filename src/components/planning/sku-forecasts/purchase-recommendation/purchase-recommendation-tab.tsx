import { getInboundQty, getWeightedAverage, type MockSku } from "@/features/planning/mock-data";

export function PurchaseRecommendationTab({ sku }: { sku: MockSku }) {
  const inboundQty = getInboundQty(sku.id);
  const targetQty = Math.ceil(getWeightedAverage(sku.linkSales) * 90);
  const projectedQty = sku.stock + inboundQty - sku.backorder;
  const rawQty = Math.max(targetQty - projectedQty, 0);
  const recommendedQty = rawQty === 0 ? 0 : Math.ceil(rawQty / sku.moq) * sku.moq;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Purchase recommendation
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="planning-panel rounded-xl border p-5">
        <div className="text-sm text-muted-foreground">Recommended Order Qty</div>
        <div className="mt-2 text-4xl font-bold">{recommendedQty}</div>
        <div className="mt-2 text-sm text-muted-foreground">MOQ {sku.moq} units</div>
      </div>
      <div className="planning-panel rounded-xl border p-5">
        <h3 className="text-lg font-semibold">Calculation</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[
            ["Target Stock", targetQty],
            ["Current Stock", sku.stock],
            ["Inbound", inboundQty],
            ["Backorder", sku.backorder],
            ["Projected Stock", projectedQty],
            ["Raw Need", rawQty],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
