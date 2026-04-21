"use client";

/**
 * Code Guide:
 * Analytics screen component.
 * It focuses on one analytics widget or chart and turns API data into a visual summary for operators.
 */
import { useState, useEffect, useCallback } from "react";
import { DateRange } from "react-day-picker";
import { subDays, subMonths, subYears, format } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Loader2 } from "lucide-react";

type Period = "7d" | "30d" | "90d" | "6m" | "1y" | "ytd" | "custom";
type ViewMode = "revenue" | "quantity";
type ChartType = "line" | "bar";

interface TrendData {
  date: string;
  quantity: number;
  revenue: number;
}

interface SalesTrendsProps {
  className?: string;
}

const PERIOD_OPTIONS = [
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "6m", label: "Last 6 Months" },
  { value: "1y", label: "Last Year" },
  { value: "ytd", label: "Year to Date" },
  { value: "custom", label: "Custom Range" },
];

function getDateRangeForPeriod(period: Period): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;

  switch (period) {
    case "7d":
      start = subDays(end, 7);
      break;
    case "30d":
      start = subDays(end, 30);
      break;
    case "90d":
      start = subDays(end, 90);
      break;
    case "6m":
      start = subMonths(end, 6);
      break;
    case "1y":
      start = subYears(end, 1);
      break;
    case "ytd":
      start = new Date(end.getFullYear(), 0, 1);
      break;
    default:
      start = subDays(end, 30);
  }

  return { start, end };
}

export function SalesTrends({ className }: SalesTrendsProps) {
  const [period, setPeriod] = useState<Period>("30d");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("revenue");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [data, setData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalQuantity: 0,
    avgDailyRevenue: 0,
    avgDailyQuantity: 0,
  });

  const fetchTrendData = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/analytics/dashboard";

      if (period === "custom" && customDateRange?.from && customDateRange?.to) {
        const startDate = format(customDateRange.from, "yyyy-MM-dd");
        const endDate = format(customDateRange.to, "yyyy-MM-dd");
        url += `?startDate=${startDate}&endDate=${endDate}`;
      } else if (period !== "custom") {
        const { start, end } = getDateRangeForPeriod(period);
        const startDate = format(start, "yyyy-MM-dd");
        const endDate = format(end, "yyyy-MM-dd");
        url += `?startDate=${startDate}&endDate=${endDate}`;
      } else {
        // Custom selected but no dates yet - use default 30 days
        url += "?period=30d";
      }

      const res = await fetch(url);
      const result = await res.json();
      if (result.success && result.data.sales?.trend) {
        const trendData = result.data.sales.trend;
        setData(trendData);

        // Calculate summary
        const totalRevenue = trendData.reduce(
          (sum: number, d: TrendData) => sum + d.revenue,
          0
        );
        const totalQuantity = trendData.reduce(
          (sum: number, d: TrendData) => sum + d.quantity,
          0
        );
        setSummary({
          totalRevenue,
          totalQuantity,
          avgDailyRevenue: trendData.length > 0 ? totalRevenue / trendData.length : 0,
          avgDailyQuantity: trendData.length > 0 ? totalQuantity / trendData.length : 0,
        });
      }
    } catch (err) {
      console.error("Error fetching trend data:", err);
    } finally {
      setLoading(false);
    }
  }, [period, customDateRange]);

  useEffect(() => {
    fetchTrendData();
  }, [fetchTrendData]);

  const handlePeriodChange = (value: string) => {
    setPeriod(value as Period);
    if (value !== "custom") {
      setCustomDateRange(undefined);
    }
  };

  const handleCustomDateChange = (range: DateRange | undefined) => {
    setCustomDateRange(range);
  };

  // Format data for chart
  const chartData = data.map((d) => ({
    ...d,
    dateLabel: new Date(d.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    fullDate: d.date,
  }));

  const dataKey = viewMode === "revenue" ? "revenue" : "quantity";

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-base">Sales Trends</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {/* Period Selector */}
                <Select value={period} onValueChange={handlePeriodChange}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* View Mode Toggle */}
                <div className="flex rounded-md border">
                  <Button
                    variant={viewMode === "revenue" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-r-none"
                    onClick={() => setViewMode("revenue")}
                  >
                    Revenue
                  </Button>
                  <Button
                    variant={viewMode === "quantity" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-l-none"
                    onClick={() => setViewMode("quantity")}
                  >
                    Quantity
                  </Button>
                </div>

                {/* Chart Type Toggle */}
                <div className="flex rounded-md border">
                  <Button
                    variant={chartType === "line" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-r-none"
                    onClick={() => setChartType("line")}
                  >
                    Line
                  </Button>
                  <Button
                    variant={chartType === "bar" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-l-none"
                    onClick={() => setChartType("bar")}
                  >
                    Bar
                  </Button>
                </div>
              </div>
            </div>

            {/* Custom Date Range Picker */}
            {period === "custom" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Date Range:</span>
                <DateRangePicker
                  dateRange={customDateRange}
                  onDateRangeChange={handleCustomDateChange}
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">
                ${summary.totalRevenue.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Total Revenue</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">
                {summary.totalQuantity.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Units Sold</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">
                ${Math.round(summary.avgDailyRevenue).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Avg Daily Revenue</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">
                {Math.round(summary.avgDailyQuantity).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Avg Daily Units</p>
            </div>
          </div>

          {/* Chart */}
          {loading ? (
            <div className="h-[350px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[350px] flex items-center justify-center text-muted-foreground">
              No sales data available for this period
            </div>
          ) : (
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "line" ? (
                  <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                      width={60}
                      tickFormatter={(value) =>
                        viewMode === "revenue"
                          ? `$${(value / 1000).toFixed(0)}k`
                          : value.toLocaleString()
                      }
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                              <p className="text-sm font-medium mb-1">
                                {new Date(d.fullDate).toLocaleDateString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </p>
                              <div className="space-y-1 text-sm">
                                <p>
                                  <span className="text-muted-foreground">Revenue: </span>
                                  <span className="font-medium">
                                    ${d.revenue.toLocaleString()}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Quantity: </span>
                                  <span className="font-medium">
                                    {d.quantity.toLocaleString()} units
                                  </span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={dataKey}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#3b82f6" }}
                      activeDot={{ r: 5, fill: "#3b82f6" }}
                      connectNulls
                    />
                  </LineChart>
                ) : (
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                      width={60}
                      tickFormatter={(value) =>
                        viewMode === "revenue"
                          ? `$${(value / 1000).toFixed(0)}k`
                          : value.toLocaleString()
                      }
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                              <p className="text-sm font-medium mb-1">
                                {new Date(d.fullDate).toLocaleDateString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </p>
                              <div className="space-y-1 text-sm">
                                <p>
                                  <span className="text-muted-foreground">Revenue: </span>
                                  <span className="font-medium">
                                    ${d.revenue.toLocaleString()}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Quantity: </span>
                                  <span className="font-medium">
                                    {d.quantity.toLocaleString()} units
                                  </span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar
                      dataKey={dataKey}
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">
                {viewMode === "revenue" ? "Daily Revenue" : "Daily Units Sold"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
