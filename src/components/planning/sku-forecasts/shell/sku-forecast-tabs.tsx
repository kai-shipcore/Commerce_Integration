"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SkuForecastTabsProps {
  sales: ReactNode;
  inventory: ReactNode;
  purchase: ReactNode;
}

export function SkuForecastTabs({
  sales,
  inventory,
  purchase,
}: SkuForecastTabsProps) {
  return (
    <Tabs defaultValue="sales" className="space-y-4">
      <TabsList className="planning-panel h-auto rounded-xl border bg-white dark:bg-zinc-900 dark:border-zinc-700 p-1 gap-0.5">
        <TabsTrigger
          value="sales"
          className="rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-[#1A1917] data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-[#5A5750] data-[state=inactive]:hover:text-[#1A1917] dark:data-[state=active]:bg-white dark:data-[state=active]:text-[#1A1917] dark:data-[state=inactive]:text-zinc-400 dark:data-[state=inactive]:hover:text-white"
        >
          Sales Analysis
        </TabsTrigger>
        <TabsTrigger
          value="inventory"
          className="rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-[#1A1917] data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-[#5A5750] data-[state=inactive]:hover:text-[#1A1917] dark:data-[state=active]:bg-white dark:data-[state=active]:text-[#1A1917] dark:data-[state=inactive]:text-zinc-400 dark:data-[state=inactive]:hover:text-white"
        >
          Inventory &amp; Inbound
        </TabsTrigger>
        <TabsTrigger
          value="purchase"
          className="rounded-lg px-4 py-1.5 text-sm font-medium data-[state=active]:bg-[#1A1917] data-[state=active]:text-white data-[state=active]:shadow-none data-[state=inactive]:text-[#5A5750] data-[state=inactive]:hover:text-[#1A1917] dark:data-[state=active]:bg-white dark:data-[state=active]:text-[#1A1917] dark:data-[state=inactive]:text-zinc-400 dark:data-[state=inactive]:hover:text-white"
        >
          Container Recommendation
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sales">{sales}</TabsContent>
      <TabsContent value="inventory">{inventory}</TabsContent>
      <TabsContent value="purchase">{purchase}</TabsContent>
    </Tabs>
  );
}
