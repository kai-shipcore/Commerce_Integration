import type { DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber, type SkuMasterMeta } from "../types";

export function SkuKpiStrip({ sku, master }: { sku: DemandRow; master: SkuMasterMeta }) {
  const days = daysUntil(sku.sod);
  const inbound = sku.total_inbound_qty ?? 0;
  const projected = sku.total_stock + inbound + Math.min(sku.back, 0);
  const items = [
    { label: "Current Stock", value: formatNumber(sku.total_stock), sub: `West ${formatNumber(sku.west_stock)} / East ${formatNumber(sku.east_stock)}` },
    { label: "Daily Average", value: formatNumber(sku.total_avg_curr, 2), sub: `30D ${formatNumber(sku.total_30d)} units` },
    { label: "Inv. Life", value: days === null ? "-" : `${days}d`, sub: "Based on projected SOD" },
    { label: "Inbound", value: formatNumber(inbound), sub: sku.next_eta ? `Next ETA ${sku.next_eta}` : "No active inbound" },
    { label: "Projected", value: formatNumber(projected), sub: `CBM/unit ${formatNumber(master.cbmPerUnit, 4)}` },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="planning-panel rounded-lg border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold">{item.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}
