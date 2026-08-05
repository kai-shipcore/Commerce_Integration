"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pick, type SkuForecastLanguage } from "../language";

export type SkuForecastTab = "sales" | "inventory" | "history" | "purchase" | "forecast";

interface SkuForecastTabsProps {
  sales: ReactNode;
  inventory: ReactNode;
  history: ReactNode;
  purchase: ReactNode;
  language: SkuForecastLanguage;
  defaultTab?: SkuForecastTab;
}

const triggerClassName =
  "rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-[#1A1917] data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-[#5A5750] data-[state=inactive]:hover:text-[#1A1917] dark:data-[state=active]:bg-white dark:data-[state=active]:text-[#1A1917] dark:data-[state=inactive]:text-zinc-400 dark:data-[state=inactive]:hover:text-white";

export function SkuForecastTabs({
  sales,
  inventory,
  history,
  purchase,
  language,
  defaultTab = "sales",
}: SkuForecastTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SkuForecastTab>(defaultTab);

  function changeTab(nextValue: string) {
    const nextTab = parseSkuForecastTab(nextValue);
    setActiveTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "sales") {
      params.delete("tab");
    } else {
      params.set("tab", nextTab);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
      <TabsList className="planning-panel h-auto rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-700 p-1 gap-0.5">
        <TabsTrigger value="sales" className={triggerClassName}>
          {pick(language, "판매 분석", "Sales Analysis")}
        </TabsTrigger>
        <TabsTrigger value="inventory" className={triggerClassName}>
          {pick(language, "재고 및 입고", "Inventory & Inbound")}
        </TabsTrigger>
        <TabsTrigger value="history" className={triggerClassName}>
          {pick(language, "입고 이력", "Inbound History")}
        </TabsTrigger>
        <TabsTrigger value="purchase" className={triggerClassName}>
          {pick(language, "발주 추천", "Order Recommendation")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sales">{sales}</TabsContent>
      <TabsContent value="inventory">{inventory}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
      <TabsContent value="purchase">{purchase}</TabsContent>
    </Tabs>
  );
}

/** `?tab=forecast` resolves to Sales rather than 404ing.
 *
 *  The Demand Forecast tab was removed in August 2026: it drew the legacy
 *  statsforecast pipeline's per-SKU forecast, which is a different model on
 *  different tables from the one the Action List and Forecast Validation report
 *  on, and the same SKU read differently depending on which screen you opened.
 *  The per-SKU view of the served model lives at /planning/action-list/[sku].
 *
 *  "forecast" stays in the union and in this parser because links to it exist,
 *  in bookmarks and in anything that built a URL by hand. Dropping it from the
 *  parser makes those land on a tab strip with nothing selected. */
function parseSkuForecastTab(value: string): SkuForecastTab {
  if (
    value === "inventory" ||
    value === "history" ||
    value === "purchase"
  ) return value;
  return "sales";
}
