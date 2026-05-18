"use client";

import { useMemo, useState } from "react";
import { mockSkus, productLabels, type ProductKey } from "@/features/planning/mock-data";

export function SkuMasterPage() {
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductKey | "all">("all");

  const visibleSkus = useMemo(
    () =>
      mockSkus.filter(
        (sku) =>
          (product === "all" || sku.product === product) &&
          sku.id.toLowerCase().includes(query.toLowerCase())
      ),
    [product, query]
  );

  return (
    <section className="space-y-4">
      <header className="planning-panel flex flex-col gap-4 rounded-xl border p-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SKU Master</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sample master data for CBM, MOQ, and case quantity management.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SKU..."
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
          <select
            value={product}
            onChange={(event) => setProduct(event.target.value as ProductKey | "all")}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All Products</option>
            {(Object.keys(productLabels) as ProductKey[]).map((key) => (
              <option key={key} value={key}>
                {productLabels[key]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total SKUs", mockSkus.length],
          ["Visible Rows", visibleSkus.length],
          ["Product Types", 3],
          ["Low Stock", mockSkus.filter((sku) => sku.life <= 30).length],
        ].map(([label, value]) => (
          <div key={label} className="planning-panel rounded-xl border p-4">
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="planning-panel overflow-hidden rounded-xl border">
        <div className="planning-muted grid grid-cols-7 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Product</span>
          <span>Master SKU</span>
          <span>CBM / Unit</span>
          <span>MOQ</span>
          <span>Case Qty</span>
          <span>Stock</span>
          <span>Velocity</span>
        </div>
        {visibleSkus.map((sku) => (
          <div key={sku.id} className="grid grid-cols-7 border-b px-4 py-3 text-sm last:border-b-0">
            <span>{productLabels[sku.product]}</span>
            <span>{sku.id}</span>
            <span>{sku.cbmUnit}</span>
            <span>{sku.moq}</span>
            <span>{sku.caseQty}</span>
            <span>{sku.stock}</span>
            <span>{sku.velocity}</span>
          </div>
        ))}
        <div className="planning-muted flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
          <span>{visibleSkus.length} rows</span>
          <span>Inline editing can be added here</span>
        </div>
      </div>
    </section>
  );
}
