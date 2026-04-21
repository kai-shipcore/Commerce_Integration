"use client";

/**
 * Code Guide:
 * This page renders the skus / [id] screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SKUFormDialog } from "@/components/sku/sku-form-dialog";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { SalesHistoryChart } from "@/components/forecast/sales-history-chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, DollarSign, AlertCircle, Edit, Trash2, ChevronDown, ChevronRight, BarChart3 } from "lucide-react";

const SALES_PERIODS = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All time" },
];

interface RelatedWebSku {
  id: string;
  skuCode: string;
  salesCount: number;
}

interface SKUDetail {
  id: string;
  skuCode: string;
  masterSkuCode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  currentStock: number;
  inventory: {
    onHand: number;
    reserved: number;
    allocated: number;
    backorder: number;
    inbound: number;
    available: number;
  };
  inventoryBalances: {
    id: string;
    onHandQty: number;
    reservedQty: number;
    allocatedQty: number;
    backorderQty: number;
    inboundQty: number;
    availableQty: number;
    location: {
      id: string;
      code: string;
      name: string;
      isDefault: boolean;
    };
  }[];
  reorderPoint: number | null;
  unitCost: string | null;
  retailPrice: string | null;
  relatedWebSkus: RelatedWebSku[];
  _count: {
    salesRecords: number;
  };
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
        if (result.success) {
          setSKU(result.data);
        }
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
      const params = new URLSearchParams({
        skuId: id,
        groupBy: "day",
      });

      if (salesPeriod !== "all") {
        const days = parseInt(salesPeriod, 10);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        params.set("startDate", startDate.toISOString());
      }

      const response = await fetch(`/api/sales?${params.toString()}`);
      const result = await response.json();

      if (result.success && result.data) {
        setSalesHistory(result.data);
      }
    } catch (error) {
      console.error("Error fetching sales history:", error);
    } finally {
      setSalesLoading(false);
    }
  }, [id, salesPeriod]);

  useEffect(() => {
    fetchSalesHistory();
  }, [fetchSalesHistory]);

  const handleDelete = async () => {
    const response = await fetch(`/api/skus/${id}`, { method: "DELETE" });
    const result = await response.json();

    if (result.success) {
      router.push("/skus");
    } else {
      throw new Error(result.error);
    }
  };

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

  const needsReorder =
    sku.reorderPoint && sku.inventory.available <= sku.reorderPoint;

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{sku.name}</h1>
              <Badge variant="outline" className="font-mono">
                {sku.masterSkuCode || sku.skuCode}
              </Badge>
              {needsReorder && <Badge variant="destructive">Low Stock</Badge>}
            </div>
            {sku.description && (
              <p className="mt-2 text-muted-foreground">{sku.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SKUFormDialog
              editData={{
                id: sku.id,
                skuCode: sku.skuCode,
                name: sku.name,
                description: sku.description || "",
                category: sku.category || "",
                currentStock: sku.inventory.onHand,
                reorderPoint: sku.reorderPoint || 0,
                unitCost: parseFloat(sku.unitCost || "0"),
                retailPrice: parseFloat(sku.retailPrice || "0"),
              }}
              onSuccess={fetchSKU}
              trigger={
                <Button variant="outline">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              }
            />
            <DeleteDialog
              title="Delete SKU"
              description={`Are you sure you want to delete "${sku.name}"? This action cannot be undone and will also delete all associated sales records and inventory data.`}
              onConfirm={handleDelete}
              trigger={
                <Button variant="outline">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              }
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.available}</div>
              {sku.reorderPoint && (
                <p className="text-xs text-muted-foreground">
                  Reorder at {sku.reorderPoint}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">On Hand</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.onHand}</div>
              <p className="text-xs text-muted-foreground">
                Reserved {sku.inventory.reserved} | Allocated {sku.inventory.allocated}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Backorder</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku.inventory.backorder}</div>
              <p className="text-xs text-muted-foreground">
                Inbound {sku.inventory.inbound}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Retail Price</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {sku.retailPrice ? `$${parseFloat(sku.retailPrice).toFixed(2)}` : "-"}
              </div>
              {sku.unitCost && (
                <p className="text-xs text-muted-foreground">
                  Cost: ${parseFloat(sku.unitCost).toFixed(2)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sales Records</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sku._count.salesRecords}</div>
              <p className="text-xs text-muted-foreground">
                Recorded transactions for this SKU
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Product Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <dt className="text-sm font-medium text-muted-foreground">Master SKU</dt>
              <dd className="text-sm font-mono">
                {sku.masterSkuCode || <span className="text-muted-foreground">-</span>}
              </dd>
              {sku.category && (
                <>
                  <dt className="text-sm font-medium text-muted-foreground">Category</dt>
                  <dd className="text-sm">{sku.category}</dd>
                </>
              )}
              <dt className="text-sm font-medium text-muted-foreground">Inventory Summary</dt>
              <dd className="text-sm">
                OH {sku.inventory.onHand} / AV {sku.inventory.available} / RSV {sku.inventory.reserved} / BO {sku.inventory.backorder}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory by Location</CardTitle>
            <CardDescription>
              Operational inventory is tracked per location and rolled up into the SKU totals above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sku.inventoryBalances.length > 0 ? (
              <div className="space-y-3">
                {sku.inventoryBalances.map((balance) => (
                  <div
                    key={balance.id}
                    className="grid gap-2 rounded-md border p-3 md:grid-cols-6"
                  >
                    <div>
                      <p className="text-sm font-medium">{balance.location.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {balance.location.code}
                        {balance.location.isDefault ? " (default)" : ""}
                      </p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Available</p>
                      <p className="font-medium">{balance.availableQty}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">On hand</p>
                      <p className="font-medium">{balance.onHandQty}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Reserved</p>
                      <p className="font-medium">{balance.reservedQty}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Backorder</p>
                      <p className="font-medium">{balance.backorderQty}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground">Inbound</p>
                      <p className="font-medium">{balance.inboundQty}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No location-level inventory balances found for this SKU.
              </p>
            )}
          </CardContent>
        </Card>

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
                  No sales have been recorded for this product in the selected period
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {sku.relatedWebSkus && sku.relatedWebSkus.length > 0 && (
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
                  Web SKUs ({sku.relatedWebSkus.length})
                </span>
              </CardTitle>
            </CardHeader>
            {webSkusExpanded && (
              <CardContent>
                <div className="space-y-2">
                  {sku.relatedWebSkus.map((webSku) => (
                    <div
                      key={webSku.id}
                      className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
                    >
                      <span className="font-mono text-sm">{webSku.skuCode}</span>
                      <span className="text-sm text-muted-foreground">
                        {webSku.salesCount} sales
                      </span>
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
