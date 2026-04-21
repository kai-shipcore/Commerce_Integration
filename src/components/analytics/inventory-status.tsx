"use client";

/**
 * Code Guide:
 * Analytics screen component.
 * It focuses on one analytics widget or chart and turns API data into a visual summary for operators.
 */
import { useState, useEffect } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, AlertTriangle, Package, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

interface LowStockSKU {
  id: string;
  skuCode: string;
  name: string;
  currentStock: number;
  reorderPoint: number;
}

interface InventoryData {
  lowStockSKUs: LowStockSKU[];
  overview: {
    totalSKUs: number;
    lowStockCount: number;
  };
}

export function InventoryStatus() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [allSkus, setAllSkus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch dashboard data for low stock info
        const dashboardRes = await fetch("/api/analytics/dashboard");
        const dashboardData = await dashboardRes.json();

        // Fetch all SKUs for inventory distribution
        const skusRes = await fetch("/api/skus?limit=100");
        const skusData = await skusRes.json();

        if (dashboardData.success) {
          setData({
            lowStockSKUs: dashboardData.data.lowStockSKUs,
            overview: dashboardData.data.overview,
          });
        }

        if (skusData.success) {
          setAllSkus(skusData.data);
        }
      } catch (err) {
        console.error("Error fetching inventory data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Failed to load inventory data
        </CardContent>
      </Card>
    );
  }

  // Calculate stock level distribution
  const stockDistribution = {
    outOfStock: allSkus.filter((s) => s.currentStock === 0).length,
    lowStock: allSkus.filter(
      (s) => s.currentStock > 0 && s.reorderPoint && s.currentStock <= s.reorderPoint
    ).length,
    adequate: allSkus.filter(
      (s) =>
        s.currentStock > 0 &&
        (!s.reorderPoint || s.currentStock > s.reorderPoint) &&
        s.currentStock <= (s.reorderPoint || 50) * 3
    ).length,
    wellStocked: allSkus.filter(
      (s) => s.currentStock > (s.reorderPoint || 50) * 3
    ).length,
  };

  const pieData = [
    { name: "Out of Stock", value: stockDistribution.outOfStock, color: "#ef4444" },
    { name: "Low Stock", value: stockDistribution.lowStock, color: "#f59e0b" },
    { name: "Adequate", value: stockDistribution.adequate, color: "#3b82f6" },
    { name: "Well Stocked", value: stockDistribution.wellStocked, color: "#22c55e" },
  ].filter((d) => d.value > 0);

  // Prepare bar chart data for low stock items
  const lowStockChartData = data.lowStockSKUs.slice(0, 10).map((sku) => ({
    name: sku.skuCode,
    current: sku.currentStock,
    reorderPoint: sku.reorderPoint,
    fullName: sku.name,
    deficit: Math.max(0, sku.reorderPoint - sku.currentStock),
  }));

  // Calculate days until stockout (simplified estimate)
  const estimateDaysUntilStockout = (sku: LowStockSKU) => {
    // This is a simplified estimate - in reality you'd use sales velocity
    const avgDailySales = 2; // Placeholder - would come from actual sales data
    if (avgDailySales <= 0) return Infinity;
    return Math.floor(sku.currentStock / avgDailySales);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total SKUs</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.overview.totalSKUs}</div>
            <p className="text-xs text-muted-foreground">In inventory system</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {data.overview.lowStockCount}
            </div>
            <p className="text-xs text-muted-foreground">Below reorder point</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stockDistribution.outOfStock}
            </div>
            <p className="text-xs text-muted-foreground">Zero inventory</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Well Stocked</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stockDistribution.wellStocked + stockDistribution.adequate}
            </div>
            <p className="text-xs text-muted-foreground">Healthy inventory levels</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Stock Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock Level Distribution</CardTitle>
            <CardDescription>Overview of inventory health across all SKUs</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No inventory data available
              </div>
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                              <p className="text-sm font-medium">{d.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {d.value} SKUs
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Low Stock Items</CardTitle>
            <CardDescription>Current stock vs reorder point</CardDescription>
          </CardHeader>
          <CardContent>
            {lowStockChartData.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No low stock items
              </div>
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={lowStockChartData}
                    layout="vertical"
                    margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      horizontal={true}
                      vertical={false}
                    />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      width={70}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                              <p className="text-sm font-medium">{d.fullName}</p>
                              <div className="space-y-1 text-sm mt-1">
                                <p>
                                  <span className="text-muted-foreground">Current: </span>
                                  {d.current} units
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Reorder Point: </span>
                                  {d.reorderPoint} units
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Deficit: </span>
                                  <span className="text-red-500">{d.deficit} units</span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="current" name="Current Stock" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="reorderPoint" name="Reorder Point" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Low Stock Alerts
          </CardTitle>
          <CardDescription>
            SKUs that need reordering based on current stock levels
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.lowStockSKUs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg font-medium">All inventory levels are healthy</p>
              <p className="text-sm text-muted-foreground">
                No SKUs are currently below their reorder point
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Reorder Point</TableHead>
                  <TableHead className="text-right">Deficit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lowStockSKUs.map((sku) => {
                  const deficit = sku.reorderPoint - sku.currentStock;
                  const isOutOfStock = sku.currentStock === 0;
                  const isCritical = sku.currentStock < sku.reorderPoint * 0.5;

                  return (
                    <TableRow key={sku.id}>
                      <TableCell>
                        <div>
                          <Link
                            href={`/skus/${sku.id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {sku.skuCode}
                          </Link>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {sku.name}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            isOutOfStock
                              ? "text-red-600 font-bold"
                              : isCritical
                              ? "text-yellow-600 font-medium"
                              : ""
                          }
                        >
                          {sku.currentStock}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {sku.reorderPoint}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-red-600">-{deficit}</span>
                      </TableCell>
                      <TableCell>
                        {isOutOfStock ? (
                          <Badge variant="destructive">Out of Stock</Badge>
                        ) : isCritical ? (
                          <Badge variant="destructive">Critical</Badge>
                        ) : (
                          <Badge variant="secondary">Low</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                          Reorder {Math.max(deficit, sku.reorderPoint)} units
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
