"use client";

/**
 * Code Guide:
 * Analytics screen component.
 * It focuses on one analytics widget or chart and turns API data into a visual summary for operators.
 */
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
} from "lucide-react";
import Link from "next/link";

interface DashboardData {
  overview: {
    totalSKUs: number;
    totalCollections: number;
    totalActiveIntegrations: number;
    lowStockCount: number;
  };
  sales: {
    last30Days: {
      totalQuantity: number;
      totalRevenue: number;
      orderCount: number;
    };
    last7Days: {
      totalQuantity: number;
      totalRevenue: number;
      orderCount: number;
    };
    growthPercentage: number;
    trend: Array<{ date: string; quantity: number; revenue: number }>;
  };
  topSelling: Array<{
    sku: {
      id: string;
      skuCode: string;
      name: string;
      imageUrl: string | null;
      currentStock: number;
    };
    totalQuantity: number;
    totalRevenue: number;
    orderCount: number;
  }>;
  lowStockSKUs: Array<{
    id: string;
    skuCode: string;
    name: string;
    currentStock: number;
    reorderPoint: number;
  }>;
}

export function AnalyticsOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/analytics/dashboard");
        const result = await res.json();
        if (result.success) {
          setData(result.data);
        }
      } catch (err) {
        console.error("Error fetching analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return <OverviewSkeleton />;
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Failed to load analytics data
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      title: "Revenue (30d)",
      value: `$${data.sales.last30Days.totalRevenue.toLocaleString()}`,
      icon: DollarSign,
      description: `${data.sales.last30Days.orderCount} orders`,
    },
    {
      title: "Units Sold (30d)",
      value: data.sales.last30Days.totalQuantity.toLocaleString(),
      icon: ShoppingCart,
      description: `${data.sales.last7Days.totalQuantity.toLocaleString()} in last 7 days`,
    },
    {
      title: "Growth Rate",
      value: `${data.sales.growthPercentage > 0 ? "+" : ""}${data.sales.growthPercentage}%`,
      icon: data.sales.growthPercentage >= 0 ? TrendingUp : TrendingDown,
      description: "7-day vs 30-day avg",
      trend: data.sales.growthPercentage >= 0 ? "up" : "down",
    },
    {
      title: "Low Stock Alerts",
      value: data.overview.lowStockCount.toString(),
      icon: AlertTriangle,
      description: "SKUs below reorder point",
      alert: data.overview.lowStockCount > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon
                  className={`h-4 w-4 ${
                    stat.alert
                      ? "text-destructive"
                      : stat.trend === "up"
                      ? "text-green-500"
                      : stat.trend === "down"
                      ? "text-red-500"
                      : "text-muted-foreground"
                  }`}
                />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    stat.trend === "up"
                      ? "text-green-600"
                      : stat.trend === "down"
                      ? "text-red-600"
                      : ""
                  }`}
                >
                  {stat.value}
                </div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Mini Sales Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales Trend (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniTrendChart data={data.sales.trend.slice(-7)} />
          </CardContent>
        </Card>

        {/* Top Sellers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Sellers (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.topSelling.slice(0, 5).map((item, index) => (
                <div key={item.sku.id} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/skus/${item.sku.id}`}
                      className="text-sm font-medium hover:underline truncate block"
                    >
                      {item.sku.name}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {item.sku.skuCode}
                      </Badge>
                      <span>{item.totalQuantity.toLocaleString()} units</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      ${item.totalRevenue.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {data.topSelling.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sales data available
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{data.overview.totalSKUs}</p>
                <p className="text-sm text-muted-foreground">Total SKUs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{data.overview.totalActiveIntegrations}</p>
                <p className="text-sm text-muted-foreground">Active Integrations</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <ShoppingCart className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{data.overview.totalCollections}</p>
                <p className="text-sm text-muted-foreground">Collections</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniTrendChart({
  data,
}: {
  data: Array<{ date: string; quantity: number; revenue: number }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No sales data available
      </p>
    );
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue));

  // Deduplicate by date (aggregate if duplicates exist)
  const deduped = data.reduce((acc, day) => {
    const existing = acc.find((d) => d.date === day.date);
    if (existing) {
      existing.quantity += day.quantity;
      existing.revenue += day.revenue;
    } else {
      acc.push({ ...day });
    }
    return acc;
  }, [] as typeof data);

  return (
    <div className="space-y-3">
      {deduped.map((day, index) => {
        const percentage = maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0;
        const date = new Date(day.date).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        return (
          <div key={`${day.date}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{date}</span>
              <span className="font-medium">
                {day.quantity} units &bull; ${day.revenue.toLocaleString()}
              </span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-20 bg-muted animate-pulse rounded mb-2" />
              <div className="h-3 w-32 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardContent className="py-12">
            <div className="h-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-12">
            <div className="h-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
