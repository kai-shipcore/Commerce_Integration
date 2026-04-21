/**
 * Code Guide:
 * This page renders the dashboard screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */

import { Suspense } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { SalesTrend } from "@/components/dashboard/sales-trend";
import { TopSellers } from "@/components/dashboard/top-sellers";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your multi-channel commerce operations
          </p>
        </div>

        {/* Stats Cards */}
        <Suspense fallback={<StatsLoadingSkeleton />}>
          <DashboardStats />
        </Suspense>

        {/* Charts and Lists */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Sales Trend */}
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <SalesTrend />
          </Suspense>

          {/* Top Sellers */}
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <TopSellers />
          </Suspense>
        </div>

        {/* Recent Activity */}
        <Suspense fallback={<ChartLoadingSkeleton />}>
          <RecentActivity />
        </Suspense>
      </div>
    </AppLayout>
  );
}

function StatsLoadingSkeleton() {
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

function ChartLoadingSkeleton() {
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
