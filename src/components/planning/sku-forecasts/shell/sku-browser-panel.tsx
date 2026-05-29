import type { DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber, getUrgency, productLabels, type ProductKey } from "../types";

interface SkuBrowserPanelProps {
  product: ProductKey;
  productCounts: Record<ProductKey, number>;
  onProductChange: (product: ProductKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  rows: DemandRow[];
  selectedSkuId: string;
  onSelectSku: (skuId: string) => void;
}

const urgencyStyles = {
  critical: "border-red-200 bg-red-50 text-red-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function SkuBrowserPanel({
  product,
  productCounts,
  onProductChange,
  search,
  onSearchChange,
  rows,
  selectedSkuId,
  onSelectSku,
}: SkuBrowserPanelProps) {
  return (
    <aside className="planning-panel flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="grid grid-cols-3 border-b">
        {(Object.keys(productLabels) as ProductKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`px-2 py-3 text-xs font-semibold ${
              product === key ? "bg-[#ebf0fd] text-[#1a4db0]" : "text-muted-foreground hover:bg-[#f0eee9]"
            }`}
            onClick={() => onProductChange(key)}
          >
            {productLabels[key]}
            <span className="ml-1 font-mono text-[10px]">{formatNumber(productCounts[key])}</span>
          </button>
        ))}
      </div>
      <div className="border-b p-3">
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search master SKU..."
          className="h-9 w-full rounded-md border bg-[#f0eee9] px-3 text-sm outline-none focus:border-[#1a5cdb]"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No SKUs</div>
        ) : (
          rows.map((row) => {
            const selected = selectedSkuId === row.sku;
            const urgency = getUrgency(row);
            const days = daysUntil(row.sod);
            return (
              <button
                key={row.sku}
                type="button"
                onClick={() => onSelectSku(row.sku)}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  selected ? "border-[#1a5cdb] bg-[#ebf0fd]" : "bg-background hover:bg-[#f0eee9]"
                }`}
              >
                <div className="break-all font-mono text-xs font-semibold">{row.sku}</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Stock {formatNumber(row.total_stock)}</span>
                  <span className="ml-auto">Avg {formatNumber(row.total_avg_curr, 2)}/d</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${urgencyStyles[urgency]}`}>
                    {urgency === "critical" ? "Critical" : urgency === "watch" ? "Watch" : "Healthy"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {days === null ? "SOD -" : `${days}d`}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
