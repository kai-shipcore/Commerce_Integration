"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { subDays, subMonths, subYears, format } from "date-fns";
import { toast } from "sonner";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AlertTriangle, DollarSign, LayoutDashboard, Loader2, Package, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { QuickLinks, type QuickLink } from "./quick-links";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatStats { critical: number; warning: number; backorder: number }
interface HomeStats {
  byCategory: { fm: CatStats; cc: CatStats; sc: CatStats };
  lastSync: string | null;
}

interface TrendPoint { date: string; quantity: number; revenue: number }
interface SalesSummary { totalUnits: number; totalRevenue: number; growthPct: number | null }

type CategoryKey = "fm" | "cc" | "sc";
type Period = "7d" | "30d" | "90d" | "6m" | "1y" | "ytd";
type ViewMode = "revenue" | "orders";
type ChartType = "area" | "line" | "bar";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_TABS: { key: CategoryKey; label: string }[] = [
  { key: "fm", label: "Floor Mat" },
  { key: "cc", label: "Car Cover" },
  { key: "sc", label: "Seat Cover" },
];

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d",  label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "6m",  label: "Last 6 Months" },
  { value: "1y",  label: "Last Year" },
  { value: "ytd", label: "Year to Date" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────


function getDateRange(period: Period) {
  const end = new Date();
  const start =
    period === "7d"  ? subDays(end, 6)    :  // today-6 ~ today = 7 days (matches Orders page last7)
    period === "30d" ? subDays(end, 29)   :  // today-29 ~ today = 30 days (matches Orders page last30)
    period === "90d" ? subDays(end, 89)   :
    period === "6m"  ? subMonths(end, 6)  :
    period === "1y"  ? subYears(end, 1)   :
    new Date(end.getFullYear(), 0, 1);
  return { start, end };
}

function getPrevDateRange(period: Period) {
  const { start: cStart, end: cEnd } = getDateRange(period);
  const diff = cEnd.getTime() - cStart.getTime();
  return { start: new Date(cStart.getTime() - diff), end: cStart };
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HomeDashboard({
  links,
  allowedHrefs,
}: {
  links: QuickLink[];
  allowedHrefs: string[];
}) {
  // Planning KPIs
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat, setActiveCat] = useState<CategoryKey>("fm");

  // Sales chart
  const [period, setPeriod] = useState<Period>("7d");
  const [viewMode, setViewMode] = useState<ViewMode>("revenue");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [ordersHref, setOrdersHref] = useState("/orders?preset=last7");

  // ── KPI fetch ───────────────────────────────────────────────────────────────
  const loadKpi = useCallback((bust = false) => {
    setRefreshing(true);
    fetch(bust ? "/api/planning/home-stats?bust=1" : "/api/planning/home-stats")
      .then((r) => r.json())
      .then((res) => { if (res.success) setStats(res.data as HomeStats); })
      .catch(() => {})
      .finally(() => { setKpiLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadKpi(), 0);
    return () => window.clearTimeout(timer);
  }, [loadKpi]);

  // ── Sales trend fetch ───────────────────────────────────────────────────────
  const fetchTrend = useCallback(async (p: Period) => {
    setChartLoading(true);
    try {
      const { start, end } = getDateRange(p);
      const { start: pStart, end: pEnd } = getPrevDateRange(p);
      const fmt = (d: Date) => format(d, "yyyy-MM-dd");
      const startFmt = fmt(start);
      const endFmt   = fmt(end);

      // Build the orders link using matching preset keys (no custom date parsing)
      const presetMap: Record<Period, string> = {
        "7d":  "last7",
        "30d": "last30",
        "90d": "last90",
        "6m":  "last6m",
        "1y":  "last1y",
        "ytd": "ytd",
      };
      setOrdersHref(`/orders?preset=${presetMap[p]}`);

      const params = new URLSearchParams({
        startDate:     startFmt,
        endDate:       endFmt,
        prevStartDate: fmt(pStart),
        prevEndDate:   fmt(pEnd),
      });

      const res = await fetch(`/api/home/sales-trend?${params}`).then((r) => r.json());

      if (res.success) {
        setTrendData(res.data.trend ?? []);
        setSalesSummary({
          totalUnits:   res.data.total?.quantity ?? 0,
          totalRevenue: res.data.total?.revenue  ?? 0,
          growthPct:    res.data.growthPct       ?? null,
        });
      } else {
        setTrendData([]);
        setSalesSummary(null);
      }
    } catch {
      setTrendData([]);
      setSalesSummary(null);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchTrend(period), 0);
    return () => window.clearTimeout(timer);
  }, [period, fetchTrend]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const syncLabel = stats?.lastSync
    ? `Synced ${new Date(stats.lastSync).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}`
    : null;

  const cat      = stats?.byCategory?.[activeCat];
  const dashLink = `/planning/dashboard-ag-grid?product=${activeCat}`;
  const canOpenHref = useCallback((href: string) => {
    const pathname = href.startsWith("http")
      ? new URL(href).pathname
      : href.split("?")[0];
    const canOpen = allowedHrefs.includes(pathname);
    if (!canOpen) {
      toast.error("이 페이지에 접근 권한이 없습니다. 관리자에게 권한을 요청하세요.");
    }
    return canOpen;
  }, [allowedHrefs]);

  const guardLinkClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (canOpenHref(href)) return;
    event.preventDefault();
    event.stopPropagation();
  }, [canOpenHref]);

  const chartData = trendData.map((d) => ({
    ...d,
    dateLabel: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
  const dataKey = viewMode === "revenue" ? "revenue" : "quantity";
  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-2 py-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-2">
          <LayoutDashboard className="mt-1.5 h-5 w-5" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
            {syncLabel && <p className="mt-0.5 text-xs text-muted-foreground">{syncLabel}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadKpi(true)}
          disabled={refreshing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-3 text-xs font-medium text-[#1A1917] disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex h-9 w-fit overflow-hidden rounded-md border bg-white dark:border-zinc-600 dark:bg-zinc-800">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveCat(tab.key)}
            className={`px-4 text-sm font-medium transition-colors ${
              activeCat === tab.key
                ? "bg-[#1A1917] text-white dark:bg-white dark:text-[#1A1917]"
                : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kpiLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-8 w-12" />
              <Skeleton className="mt-1 h-3 w-20" />
            </div>
          ))
        ) : (
          <>
            <Link href={`${dashLink}&status=crit`}
              onClick={(event) => guardLinkClick(event, `${dashLink}&status=crit`)}
              className="rounded-xl border bg-white p-4 transition-colors hover:bg-red-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-red-950/30">
              <p className="text-xs font-medium text-muted-foreground">Critical</p>
              <p className="mt-1 text-3xl font-bold text-red-600 dark:text-red-400">{(cat?.critical ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">SOD &lt; 30 days</p>
            </Link>

            <Link href={`${dashLink}&status=warn`}
              onClick={(event) => guardLinkClick(event, `${dashLink}&status=warn`)}
              className="rounded-xl border bg-white p-4 transition-colors hover:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-amber-950/30">
              <p className="text-xs font-medium text-muted-foreground">Warning</p>
              <p className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">{(cat?.warning ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">SOD 30–60 days</p>
            </Link>

            <Link href={`${dashLink}&status=bo`}
              onClick={(event) => guardLinkClick(event, `${dashLink}&status=bo`)}
              className="rounded-xl border bg-white p-4 transition-colors hover:bg-orange-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-orange-950/30">
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                <p className="text-xs font-medium text-muted-foreground">Backorder</p>
              </div>
              <p className="mt-1 text-3xl font-bold text-orange-600 dark:text-orange-400">{(cat?.backorder ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">SKUs</p>
            </Link>
          </>
        )}
      </div>

      {/* Sales section */}
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">

        {/* Chart */}
        <div className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          {/* Chart toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Sales Trend</h2>
            <div className="flex flex-wrap items-center gap-2">
              {/* Period */}
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="h-7 rounded border border-[#C2BFB5] bg-white px-2 text-xs text-[#1A1917] outline-none focus:border-[#1a5cdb] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {/* View mode */}
              <div className="flex h-8 overflow-hidden rounded-lg border border-[#C2BFB5] bg-[#f5f4f0] p-0.5 dark:border-zinc-600 dark:bg-zinc-900">
                {(["revenue", "orders"] as ViewMode[]).map((m) => {
                  const active = viewMode === m;
                  const Icon = m === "revenue" ? DollarSign : Package;
                  return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-[#1A1917] text-white shadow-sm dark:bg-white dark:text-[#1A1917]"
                        : "text-muted-foreground hover:bg-white dark:hover:bg-zinc-800"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {m === "revenue" ? "Revenue" : "Orders"}
                  </button>
                  );
                })}
              </div>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className="h-8 rounded-lg border border-[#C2BFB5] bg-white px-2.5 text-xs font-semibold text-[#1A1917] outline-none focus:border-[#1a5cdb] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                aria-label="Chart type"
              >
                <option value="area">Area</option>
                <option value="line">Line</option>
                <option value="bar">Bar</option>
              </select>
            </div>
          </div>

          {/* Chart body */}
          {chartLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No sales data for this period
            </div>
          ) : (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "area" ? (
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="homeSalesTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false}
                      tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={52}
                      tickFormatter={(v) => viewMode === "revenue" ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={2}
                      fill="url(#homeSalesTrendFill)" fillOpacity={1} activeDot={{ r: 4 }} connectNulls />
                  </AreaChart>
                ) : chartType === "line" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false}
                      tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={52}
                      tickFormatter={(v) => viewMode === "revenue" ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={2}
                      dot={{ r: 2, fill: "#3b82f6" }} activeDot={{ r: 4 }} connectNulls />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false}
                      tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={52}
                      tickFormatter={(v) => viewMode === "revenue" ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey={dataKey} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Sales summary — matches selected period, links to Orders page */}
        <Link
          href={ordersHref}
          onClick={(event) => guardLinkClick(event, ordersHref)}
          className="rounded-xl border bg-white p-4 transition-colors hover:bg-[#f0eee9] dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60 block"
        >
          <h2 className="mb-3 text-sm font-semibold">Sales — {periodLabel}</h2>

          {chartLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Orders</p>
                <p className="text-2xl font-bold">{(salesSummary?.totalUnits ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="text-lg font-semibold">
                  ${(salesSummary?.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>
              {salesSummary?.growthPct !== null && salesSummary?.growthPct !== undefined && (
                <div className="flex items-center gap-1">
                  {salesSummary.growthPct >= 0
                    ? <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                    : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                  <span className={`text-sm font-medium ${salesSummary.growthPct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {salesSummary.growthPct > 0 ? "+" : ""}{salesSummary.growthPct}%
                  </span>
                  <span className="text-xs text-muted-foreground">vs prev period</span>
                </div>
              )}
            </div>
          )}
        </Link>
      </div>

      {/* Quick Links */}
      {links.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Quick Links
          </h2>
          <QuickLinks links={links} onNavigate={canOpenHref} />
        </div>
      )}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint & { dateLabel: string } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover p-2.5 shadow-lg text-xs">
      <p className="mb-1 font-medium">{d.dateLabel}</p>
      <p><span className="text-muted-foreground">Revenue: </span><span className="font-medium">${d.revenue.toLocaleString()}</span></p>
      <p><span className="text-muted-foreground">Orders: </span><span className="font-medium">{d.quantity.toLocaleString()}</span></p>
    </div>
  );
}
