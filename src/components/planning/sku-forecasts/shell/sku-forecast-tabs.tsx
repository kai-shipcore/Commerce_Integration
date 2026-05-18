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
      <TabsList className="planning-panel h-auto rounded-xl border bg-white p-1">
        <TabsTrigger value="sales">Sales Analysis</TabsTrigger>
        <TabsTrigger value="inventory">Inventory &amp; Inbound</TabsTrigger>
        <TabsTrigger value="purchase">Purchase Recommendation</TabsTrigger>
      </TabsList>

      <TabsContent value="sales">{sales}</TabsContent>
      <TabsContent value="inventory">{inventory}</TabsContent>
      <TabsContent value="purchase">{purchase}</TabsContent>
    </Tabs>
  );
}
