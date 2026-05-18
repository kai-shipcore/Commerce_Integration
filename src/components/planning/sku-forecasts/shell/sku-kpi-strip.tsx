import { type MockSku } from "@/features/planning/mock-data";

export function SkuKpiStrip({ sku }: { sku: MockSku }) {
  const items = [
    { label: "On Hand", value: sku.stock, sub: sku.stockSub },
    { label: "Daily Average", value: sku.linkDaily.toFixed(2), sub: `Custom ${sku.customDaily.toFixed(2)}/d` },
    { label: "Days of Supply", value: `${sku.life}d`, sub: "Target 90d" },
    { label: "Projected SOD", value: sku.sod, sub: sku.life < 60 ? "Needs attention" : "Healthy" },
    { label: "Pre-Order", value: sku.preorder, sub: "Sample data" },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="planning-panel rounded-xl border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-2 text-2xl font-semibold">{item.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}
