"use client";

/**
 * Code Guide:
 * Sales chart UI component.
 * This component visualizes historical sales activity for a single SKU.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SalesDataPoint {
  date: string;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
}

interface SalesHistoryChartProps {
  data: SalesDataPoint[];
  title?: string;
}

export function SalesHistoryChart({ data, title = "Sales History" }: SalesHistoryChartProps) {
  // Transform data for Recharts
  const chartData = data.map((point) => ({
    date: new Date(point.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    fullDate: point.date,
    quantity: point.totalQuantity,
    revenue: point.totalRevenue,
    orders: point.orderCount,
  }));

  // Calculate totals for summary
  const totalQuantity = data.reduce((sum, p) => sum + p.totalQuantity, 0);
  const totalRevenue = data.reduce((sum, p) => sum + p.totalRevenue, 0);
  const avgDaily = data.length > 0 ? Math.round(totalQuantity / data.length) : 0;

  if (data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-medium">{totalQuantity.toLocaleString()} units</span>
            </div>
            <div>
              <span className="text-muted-foreground">Revenue: </span>
              <span className="font-medium">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg/day: </span>
              <span className="font-medium">{avgDaily.toLocaleString()} units</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                width={50}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                        <p className="text-sm font-medium mb-1">
                          {new Date(data.fullDate).toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-muted-foreground">Quantity: </span>
                            <span className="font-medium">{data.quantity} units</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Revenue: </span>
                            <span className="font-medium">
                              ${data.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Orders: </span>
                            <span className="font-medium">{data.orders}</span>
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar
                dataKey="quantity"
                fill="url(#colorSales)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(var(--chart-1))" }} />
            <span className="text-muted-foreground">Units Sold</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
