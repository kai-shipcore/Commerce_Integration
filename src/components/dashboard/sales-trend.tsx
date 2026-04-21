"use client";

/**
 * Code Guide:
 * Dashboard-specific presentation component.
 * It displays one slice of operational data that is fetched from the dashboard analytics API.
 */
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DollarSign, Package } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SalesTrendData {
  date: string;
  quantity: number;
  revenue: number;
}

const PERIOD_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

type ViewMode = "quantity" | "revenue";

export function SalesTrend() {
  const [data, setData] = useState<SalesTrendData[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("7d");
  const [viewMode, setViewMode] = useState<ViewMode>("quantity");

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/analytics/dashboard?period=${period}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          const trendData = result.data.sales?.trend || result.data.salesTrend || [];
          setData(trendData);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-6 w-48 animate-pulse bg-muted rounded" />
        </CardHeader>
        <CardContent>
          <div className="h-80 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // Format date for X-axis based on period
  const formatXAxis = (dateStr: string) => {
    const date = new Date(dateStr);
    if (period === "7d") {
      return date.toLocaleDateString(undefined, { weekday: "short" });
    }
    if (period === "30d") {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // Format tooltip date
  const formatTooltipDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: period === "all" || period === "ytd" ? "numeric" : undefined,
    });
  };

  // Calculate totals for summary
  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalQuantity = data.reduce((sum, d) => sum + d.quantity, 0);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-medium mb-1">{formatTooltipDate(label)}</p>
          {viewMode === "quantity" ? (
            <>
              <p className="text-primary font-medium">
                {dataPoint.quantity.toLocaleString()} units
              </p>
              <p className="text-muted-foreground">
                ${dataPoint.revenue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </>
          ) : (
            <>
              <p className="text-primary font-medium">
                ${dataPoint.revenue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-muted-foreground">
                {dataPoint.quantity.toLocaleString()} units
              </p>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>Sales Trend</CardTitle>
          {data.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {totalQuantity.toLocaleString()} units • ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-lg border bg-muted p-1 gap-1">
            <Button
              variant={viewMode === "quantity" ? "default" : "ghost"}
              size="sm"
              className={`h-7 px-3 text-xs gap-1.5 ${
                viewMode === "quantity"
                  ? "shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("quantity")}
            >
              <Package className="h-3.5 w-3.5" />
              Units
            </Button>
            <Button
              variant={viewMode === "revenue" ? "default" : "ghost"}
              size="sm"
              className={`h-7 px-3 text-xs gap-1.5 ${
                viewMode === "revenue"
                  ? "shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("revenue")}
            >
              <DollarSign className="h-3.5 w-3.5" />
              Revenue
            </Button>
          </div>
          {/* Period Selector */}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground">
            No sales data for this period
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatXAxis}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  interval={data.length > 14 ? Math.floor(data.length / 7) : 0}
                  className="text-muted-foreground"
                />
                <YAxis
                  tickFormatter={(value) =>
                    viewMode === "revenue"
                      ? `$${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`
                      : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString()
                  }
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  className="text-muted-foreground"
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey={viewMode}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorMetric)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
