"use client";

/**
 * Code Guide:
 * Dashboard-specific presentation component.
 * It displays one slice of operational data that is fetched from the dashboard analytics API.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Plug, DollarSign, TrendingUp } from "lucide-react";

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
    growthPercentage: number;
  };
}

export function DashboardStats() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/dashboard")
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setData(result.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !data || !data.overview) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 animate-pulse bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-32 animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const overview = data.overview;

  const stats = [
    {
      title: "Total SKUs",
      value: (overview.totalSKUs || 0).toLocaleString(),
      icon: Package,
      description: "Active products",
    },
    {
      title: "Active Integrations",
      value: (overview.totalActiveIntegrations || 0).toLocaleString(),
      icon: Plug,
      description: `${(overview.totalCollections || 0).toLocaleString()} collections`,
    },
    {
      title: "Revenue (30d)",
      value: `$${(data.sales.last30Days.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      description: `${(data.sales.last30Days.totalQuantity || 0).toLocaleString()} units sold`,
    },
    {
      title: "Growth Rate",
      value: `${data.sales.growthPercentage > 0 ? "+" : ""}${data.sales.growthPercentage}%`,
      icon: TrendingUp,
      description: `${(overview.lowStockCount || 0).toLocaleString()} low-stock SKUs`,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
