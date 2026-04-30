"use client";

/**
 * Code Guide:
 * This page renders the skus / [id] screen in the Next.js App Router.
 * Data comes from sc_products + sc_inventory_snapshot + sc_sku_mappings via /api/skus/[id].
 */
import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SalesHistoryChart } from "@/components/forecast/sales-history-chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, AlertCircle, ChevronDown, ChevronRight, BarChart3, ArrowLeft } from "lucide-react";

const SALES_PERIODS = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All time" },
];

interface InventoryByWarehouse {
  warehouse: string;
  onHand: number;
  available: number;
  backorder: number;
  reserved: number;
}

interface WebSku {
  channelSku: string;
  channel: string;
}

interface SKUDetail {
  id: string;
  masterSkuCode: string;
  name: string;
  category: string | null;
  status: string | null;
  inventory: {
    onHand: number;
    available: number;
    backorder: number;
    reserved: number;
  };
  inventoryByWarehouse: InventoryByWarehouse[];
  webSkus: WebSku[];
  salesCount: number;
}

interface SalesDataPoint {
  date: string;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
}

export default function SKUDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [sku, setSKU] = useState<SKUDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [webSkusExpanded, setWebSkusExpanded] = useState(false);
  const [salesHistory, setSalesHistory] = useState<SalesDataPoint[]>([]);
  const [salesPeriod, setSalesPeriod] = useState("30");
  const [salesLoading, setSalesLoading] = useState(false);

  const fetchSKU = useCallback(() => {
    setLoading(true);
    fetch(`/api/skus/${id}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) setSKU(result.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchSKU();
  }, [fetchSKU]);

  const fetchSalesHistory = useCallback(async () => {
    setSalesLoading(true);
    try {
      const params = new URLSearchParams({ masterSkuCode: id, groupBy: "day" });
      if (salesPeriod !== "all") {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(salesPeriod, 10));
        params.set("startDate", startDate.toISOString());
      }
      const response = await fetch(`/api/sales?${params.toString()}`);
      const result = await response.json();
      if (result.success && result.data) setSalesHistory(result.data);
    } catch (error) {
      console.error("Error fetching sales history:", error);
    } finally {
      setSalesLoading(false);
    }
  }, [id, salesPeriod]);

  useEffect(() => {
    fetchSalesHistory();
  }, [fetchSalesHistory]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading SKU details...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!sku) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">SKU not found</p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-fit -ml-2 text-muted-foreground"
              onClick={() => router.push("/skus")}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Products
            </Button>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{sku.name}</h1>
              <Badge variant="outline" className="font-mono">
                {sku.masterSkuCode}
              </Badge>
              {sku.category && (
                <Badge variant="secondary">{sku.category}</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.available.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Units available to sell</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">On Hand</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.onHand.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Reserved {sku.inventory.reserved.toLocaleString()}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Backorder</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.backorder.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Units on backorder</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sales Records</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.salesCount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Total recorded transactions</p>
            </CardContent>
          </Card>
        </div>

        {/* Inventory by Warehouse */}
        <Card>
          <CardHeader>
            <CardTitle>Inventory by Warehouse</CardTitle>
            <CardDescription>
              Stock levels per warehouse from the latest inventory snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sku.inventoryByWarehouse.length > 0 ? (
              <div className="space-y-3">
                {sku.inventoryByWarehouse.map((row) => (
                  <div
                    key={row.warehouse}
                    className="grid gap-2 rounded-md border p-3 md:grid-cols-5"
                  >
                    <div>
                      <p className="text-sm font-medium font-mono">{row.warehouse}</p>
                      <p className="text-xs text-muted-foreground">Warehouse</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Available</p>
                      <p className="font-medium">{row.available.toLocaleString()}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">On Hand</p>
                      <p className="font-medium">{row.onHand.toLocaleString()}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Reserved</p>
                      <p className="font-medium">{row.reserved.toLocaleString()}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Backorder</p>
                      <p className="font-medium">{row.backorder.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No inventory snapshot data found for this SKU.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Sales History */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Sales History
                </CardTitle>
                <CardDescription>
                  {salesHistory.length > 0
                    ? `Showing ${salesHistory.length} days of sales data`
                    : "No sales data available for this period"}
                </CardDescription>
              </div>
              <Select value={salesPeriod} onValueChange={setSalesPeriod}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALES_PERIODS.map((period) => (
                    <SelectItem key={period.value} value={period.value}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <div className="flex h-[300px] items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-muted-foreground">Loading sales data...</p>
                </div>
              </div>
            ) : salesHistory.length > 0 ? (
              <SalesHistoryChart data={salesHistory} title="" />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">No sales data</p>
                <p className="text-sm text-muted-foreground">
                  No sales recorded for this product in the selected period
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Web SKUs */}
        {sku.webSkus.length > 0 && (
          <Card>
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => setWebSkusExpanded(!webSkusExpanded)}
            >
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {webSkusExpanded ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                  Web SKUs ({sku.webSkus.length})
                </span>
              </CardTitle>
            </CardHeader>
            {webSkusExpanded && (
              <CardContent>
                <div className="space-y-2">
                  {sku.webSkus.map((webSku) => (
                    <div
                      key={webSku.channelSku}
                      className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
                    >
                      <span className="font-mono text-sm">{webSku.channelSku}</span>
                      <Badge variant="outline" className="text-xs">
                        {webSku.channel}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
