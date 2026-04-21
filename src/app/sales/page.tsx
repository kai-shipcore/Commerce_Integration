"use client";

/**
 * Code Guide:
 * This page renders the sales screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SalesFormDialog } from "@/components/sales/sales-form-dialog";
import { SalesImportDialog } from "@/components/sales/import-dialog";
import { ShoppingCart, Calendar } from "lucide-react";

interface SalesRecord {
  id: string;
  sku: {
    skuCode: string;
    name: string;
  };
  integration: {
    id: string;
    name: string;
  } | null;
  platform: string;
  orderId: string;
  saleDate: string;
  quantity: number;
  totalAmount: string;
  fulfilled: boolean;
}

interface IntegrationOption {
  id: string;
  platform: string;
  name: string;
}

export default function SalesPage() {
  const [sales, setSales] = useState<SalesRecord[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<string>("all");
  const [storeId, setStoreId] = useState<string>("all");

  const fetchIntegrations = useCallback(() => {
    fetch("/api/integrations")
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setIntegrations(result.data);
        }
      })
      .catch(() => undefined);
  }, []);

  const fetchSales = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (platform !== "all") params.set("platform", platform);
    if (storeId !== "all") params.set("integrationId", storeId);
    params.set("limit", "50");

    fetch(`/api/sales?${params}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setSales(result.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [platform, storeId]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const visibleIntegrations =
    platform === "all"
      ? integrations
      : integrations.filter((integration) => integration.platform === platform);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sales</h1>
            <p className="text-muted-foreground">
              Track sales across all platforms
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SalesImportDialog onImportComplete={fetchSales} />
            <SalesFormDialog onSuccess={fetchSales} />
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <Select
            value={platform}
            onValueChange={(value) => {
              setPlatform(value);
              setStoreId("all");
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="shopify">Shopify</SelectItem>
              <SelectItem value="walmart">Walmart</SelectItem>
              <SelectItem value="ebay">eBay</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {visibleIntegrations.map((integration) => (
                <SelectItem key={integration.id} value={integration.id}>
                  {integration.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sales Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                  <p className="text-muted-foreground">Loading sales...</p>
                </div>
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium">No sales found</p>
                <p className="text-sm text-muted-foreground">
                  Sales data will appear here
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {new Date(sale.saleDate).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{sale.sku.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {sale.sku.skuCode}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {sale.platform}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {sale.integration?.name || "-"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {sale.orderId}
                      </TableCell>
                      <TableCell className="text-right">
                        {sale.quantity}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${parseFloat(sale.totalAmount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={sale.fulfilled ? "default" : "secondary"}
                        >
                          {sale.fulfilled ? "Fulfilled" : "Pending"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
