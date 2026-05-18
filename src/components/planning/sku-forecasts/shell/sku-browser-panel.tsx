import { productLabels, type MockSku, type ProductKey } from "@/features/planning/mock-data";

interface SkuBrowserPanelProps {
  product: ProductKey;
  onProductChange: (product: ProductKey) => void;
  skus: MockSku[];
  selectedSkuId: string;
  onSelectSku: (skuId: string) => void;
}

export function SkuBrowserPanel({
  product,
  onProductChange,
  skus,
  selectedSkuId,
  onSelectSku,
}: SkuBrowserPanelProps) {
  return (
    <aside className="planning-panel overflow-hidden rounded-xl border">
      <div className="grid grid-cols-3 border-b">
        {(Object.keys(productLabels) as ProductKey[]).map((key) => (
          <button
            key={key}
            className={`px-2 py-3 text-xs font-semibold ${
              product === key ? "bg-[#ebf0fd] text-[#1a4db0]" : "text-muted-foreground"
            }`}
            onClick={() => onProductChange(key)}
          >
            {productLabels[key]}
          </button>
        ))}
      </div>
      <div className="border-b p-3">
        <div className="rounded-md border bg-[#f0eee9] px-3 py-2 text-sm text-muted-foreground">
          Search master SKU...
        </div>
      </div>
      <div className="space-y-2 p-3">
        {skus.map((sku) => (
          <button
            key={sku.id}
            onClick={() => onSelectSku(sku.id)}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              selectedSkuId === sku.id
                ? "border-[#1a5cdb] bg-[#ebf0fd]"
                : "bg-background hover:bg-[#f0eee9]"
            }`}
          >
            <div className="text-xs font-semibold">{sku.id}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Stock {sku.stock}</span>
              <span>{sku.life} days</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
