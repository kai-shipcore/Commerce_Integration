"use client";

/**
 * Code Guide:
 * Dashboard-specific presentation component.
 * It displays one slice of operational data that is fetched from the dashboard analytics API.
 */
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TopSeller {
  sku: {
    id: string;
    skuCode: string;
    name: string;
    currentStock: number;
  };
  totalQuantity: number;
  totalRevenue: string;
  orderCount: number;
}

const PERIOD_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

export function TopSellers() {
  const [data, setData] = useState<TopSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/analytics/dashboard?period=${period}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setData(result.data.topSelling.slice(0, 5));
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
          <div className="h-64 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Top Sellers</CardTitle>
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
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground">
            No sales data for this period
          </div>
        ) : (
        <div className="space-y-4">
          {data.map((item, index) => (
            <Link
              key={item.sku.id}
              href={`/skus/${item.sku.id}`}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="w-6 h-6 flex items-center justify-center p-0">
                  {index + 1}
                </Badge>
                <div>
                  <p className="font-medium">{item.sku.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.sku.skuCode}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  ${parseFloat(item.totalRevenue).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {item.totalQuantity} units
                </p>
              </div>
            </Link>
          ))}
        </div>
        )}
      </CardContent>
    </Card>
  );
}
