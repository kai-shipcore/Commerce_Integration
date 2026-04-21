"use client";

/**
 * Code Guide:
 * Dashboard-specific presentation component.
 * It displays one slice of operational data that is fetched from the dashboard analytics API.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, ShoppingCart } from "lucide-react";

interface Activity {
  type: string;
  skuCode: string;
  skuName: string;
  createdAt: string;
  details: string;
}

export function RecentActivity() {
  const [data, setData] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/dashboard")
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setData(result.data.recentActivity.slice(0, 10));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-6 w-48 animate-pulse bg-muted rounded" />
        </CardHeader>
        <CardContent>
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "sku":
        return Package;
      case "sale":
        return ShoppingCart;
      default:
        return Package;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "sku":
        return "bg-green-500/10 text-green-500";
      case "sale":
        return "bg-purple-500/10 text-purple-500";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No recent activity
            </p>
          ) : (
            data.map((activity, index) => {
              const Icon = getIcon(activity.type);
              const timeAgo = new Date(activity.createdAt).toLocaleString();

              return (
                <div key={index} className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${getTypeColor(activity.type)}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {activity.skuName}
                      </p>
                      <Badge variant="outline" className="text-xs">
                        {activity.skuCode}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {activity.details}
                    </p>
                    <p className="text-xs text-muted-foreground">{timeAgo}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
