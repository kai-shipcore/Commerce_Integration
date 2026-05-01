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
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CHANNEL_COLORS = {
  shopify: "hsl(var(--chart-1))",
  amazon:  "hsl(var(--chart-2))",
  ebay:    "hsl(var(--chart-3))",
  walmart: "hsl(var(--chart-4))",
} as const;

const CHANNELS = ["shopify", "amazon", "ebay", "walmart"] as const;

interface SalesDataPoint {
  date: string;
  shopify: number;
  amazon: number;
  ebay: number;
  walmart: number;
  total: number;
  totalRevenue: number;
  orderCount: number;
}

interface SalesHistoryChartProps {
  data: SalesDataPoint[];
  title?: string;
}

export function SalesHistoryChart({ data, title = "Sales History" }: SalesHistoryChartProps) {
  const chartData = data.map((point) => ({
    date: new Date(point.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    fullDate: point.date,
    shopify: point.shopify,
    amazon:  point.amazon,
    ebay:    point.ebay,
    walmart: point.walmart,
    total:   point.total,
    revenue: point.totalRevenue,
    orders:  point.orderCount,
  }));

  const totalQuantity = data.reduce((sum, p) => sum + p.total, 0);
  const totalRevenue  = data.reduce((sum, p) => sum + p.totalRevenue, 0);
  const avgDaily      = data.length > 0 ? Math.round(totalQuantity / data.length) : 0;

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
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                      <p className="text-sm font-medium mb-2">
                        {new Date(d.fullDate).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      <div className="space-y-1 text-sm">
                        {CHANNELS.map((ch) =>
                          d[ch] > 0 ? (
                            <p key={ch} className="flex justify-between gap-4">
                              <span className="text-muted-foreground capitalize">{ch}</span>
                              <span className="font-medium">{d[ch]} units</span>
                            </p>
                          ) : null
                        )}
                        <p className="flex justify-between gap-4 border-t pt-1 mt-1">
                          <span className="text-muted-foreground">Total</span>
                          <span className="font-medium">{d.total} units</span>
                        </p>
                        <p className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Revenue</span>
                          <span className="font-medium">
                            ${d.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="shopify" stackId="ch" fill={CHANNEL_COLORS.shopify} radius={[0, 0, 0, 0]} />
              <Bar dataKey="amazon"  stackId="ch" fill={CHANNEL_COLORS.amazon}  radius={[0, 0, 0, 0]} />
              <Bar dataKey="ebay"    stackId="ch" fill={CHANNEL_COLORS.ebay}    radius={[0, 0, 0, 0]} />
              <Bar dataKey="walmart" stackId="ch" fill={CHANNEL_COLORS.walmart} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-center gap-6 mt-4 text-sm">
          {CHANNELS.map((ch) => (
            <div key={ch} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch] }} />
              <span className="text-muted-foreground capitalize">{ch}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
