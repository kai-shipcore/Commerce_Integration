"use client";

import { useMemo, useState } from "react";
import { mockSkus, type ProductKey } from "@/features/planning/mock-data";
import { InventoryInboundTab } from "../inventory-inbound/inventory-inbound-tab";
import { PurchaseRecommendationTab } from "../purchase-recommendation/purchase-recommendation-tab";
import { SalesAnalysisTab } from "../sales-analysis/sales-analysis-tab";
import { SkuBrowserPanel } from "./sku-browser-panel";
import { SkuForecastTabs } from "./sku-forecast-tabs";
import { SkuHeader } from "./sku-header";
import { SkuKpiStrip } from "./sku-kpi-strip";

export function SkuForecastsShell() {
  const [product, setProduct] = useState<ProductKey>("sc");
  const [selectedSkuId, setSelectedSkuId] = useState(mockSkus[0].id);

  const visibleSkus = useMemo(
    () => mockSkus.filter((sku) => sku.product === product),
    [product]
  );
  const selectedSku =
    mockSkus.find((sku) => sku.id === selectedSkuId) ?? visibleSkus[0] ?? mockSkus[0];

  return (
    <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <SkuBrowserPanel
        product={product}
        onProductChange={(nextProduct) => {
          setProduct(nextProduct);
          const nextSku = mockSkus.find((sku) => sku.product === nextProduct);
          if (nextSku) setSelectedSkuId(nextSku.id);
        }}
        skus={visibleSkus}
        selectedSkuId={selectedSku.id}
        onSelectSku={setSelectedSkuId}
      />

      <div className="min-w-0 space-y-4">
        <SkuHeader sku={selectedSku} />
        <SkuKpiStrip sku={selectedSku} />
        <SkuForecastTabs
          sales={<SalesAnalysisTab sku={selectedSku} />}
          inventory={<InventoryInboundTab sku={selectedSku} />}
          purchase={<PurchaseRecommendationTab sku={selectedSku} />}
        />
      </div>
    </section>
  );
}
