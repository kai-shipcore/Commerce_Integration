import { productLabels, type MockSku } from "@/features/planning/mock-data";

export function SkuHeader({ sku }: { sku: MockSku }) {
  return (
    <header className="planning-panel rounded-xl border p-4">
      <h2 className="font-mono text-xl font-semibold">{sku.id}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-[#a0c0f0] bg-[#ebf0fd] px-3 py-1 text-xs font-medium text-[#1a4db0]">
          {productLabels[sku.product]}
        </span>
        {sku.tags.map((tag) => (
          <span key={tag} className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>
    </header>
  );
}
