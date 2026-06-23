"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import Link from "next/link";
import { subDays, subMonths, subYears, format } from "date-fns";
import { toast } from "sonner";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AlertTriangle, DollarSign, LayoutDashboard, Loader2, Package, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { QuickLinks, type QuickLink } from "./quick-links";
import { apiPath } from "@/lib/api-path";

// â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

// â"€â"€ Constants â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€


// â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€


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

// â"€â"€ Component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export function HomeDashboard({
  links,
  allowedHrefs,
}: {
  links: QuickLink[];
  allowedHrefs: string[];
}) {
  const { pick } = useI18n();
  const localizedQuickLinks = useMemo(
    () => links.map((link) => ({
      ...link,
      label: link.labelKo && link.labelEn ? pick(link.labelKo, link.labelEn) : link.label,
    })),
    [links, pick]
  );

  const CATEGORY_TABS = useMemo(() => [
    { key: "fm" as CategoryKey, label: pick("플로어 매트", "Floor Mat") },
    { key: "cc" as CategoryKey, label: pick("카 커버", "Car Cover") },
    { key: "sc" as CategoryKey, label: pick("시트 커버", "Seat Cover") },
  ], [pick]);

  const PERIOD_OPTIONS = useMemo(() => [
    { value: "7d" as Period,  label: pick("최근 7일", "Last 7 Days") },
    { value: "30d" as Period, label: pick("최근 30일", "Last 30 Days") },
    { value: "90d" as Period, label: pick("최근 90일", "Last 90 Days") },
    { value: "6m" as Period,  label: pick("최근 6개월", "Last 6 Months") },
    { value: "1y" as Period,  label: pick("최근 1년", "Last Year") },
    { value: "ytd" as Period, label: pick("올해 누계", "Year to Date") },
  ], [pick]);

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

  // â"€â"€ KPI fetch â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const loadKpi = useCallback((bust = false) => {
    setRefreshing(true);
    fetch(apiPath(bust ? "/api/planning/home-stats?bust=1" : "/api/planning/home-stats"))
      .then((r) => r.json())
      .then((res) => { if (res.success) setStats(res.data as HomeStats); })
      .catch(() => {})
      .finally(() => { setKpiLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadKpi(), 0);
    return () => window.clearTimeout(timer);
  }, [loadKpi]);

  // â"€â"€ Sales trend fetch â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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

      const res = await fetch(apiPath(`/api/home/sales-trend?${params}`)).then((r) => r.json());

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

  // â"€â"€ Derived â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const syncLabel = stats?.lastSync
    ? `${pick("동기화", "Synced")} ${new Date(stats.lastSync).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}`
    : null;

  const cat      = stats?.byCategory?.[activeCat];
  const dashLink = `/planning/dashboard-ag-grid?product=${activeCat}`;
  const canOpenHref = useCallback((href: string) => {
    const pathname = href.startsWith("http")
      ? new URL(href).pathname
      : href.split("?")[0];
    const canOpen = allowedHrefs.includes(pathname);
    if (!canOpen) {
      toast.error(pick("이 페이지에 접근 권한이 없습니다. 관리자에게 권한을 요청하세요.", "You do not have permission to access this page. Please contact your administrator."));
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

  // â"€â"€ Render â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-2 py-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-2">
          <LayoutDashboard className="mt-1.5 h-5 w-5" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{pick("커맨드 센터", "Command Center")}</h1>
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
          {pick("새로고침", "Refresh")}
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
              <p className="text-xs font-medium text-muted-foreground">{pick("위험", "Critical")}</p>
              <p className="mt-1 text-3xl font-bold text-red-600 dark:text-red-400">{(cat?.critical ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{pick("SOD < 30일", "SOD < 30 days")}</p>
            </Link>

            <Link href={`${dashLink}&status=warn`}
              onClick={(event) => guardLinkClick(event, `${dashLink}&status=warn`)}
              className="rounded-xl border bg-white p-4 transition-colors hover:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-amber-950/30">
              <p className="text-xs font-medium text-muted-foreground">{pick("경고", "Warning")}</p>
              <p className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">{(cat?.warning ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{pick("SOD 30–60일", "SOD 30–60 days")}</p>
            </Link>

            <Link href={`${dashLink}&status=bo`}
              onClick={(event) => guardLinkClick(event, `${dashLink}&status=bo`)}
              className="rounded-xl border bg-white p-4 transition-colors hover:bg-orange-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-orange-950/30">
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                <p className="text-xs font-medium text-muted-foreground">{pick("품절 주문", "Backorder")}</p>
              </div>
              <p className="mt-1 text-3xl font-bold text-orange-600 dark:text-orange-400">{(cat?.backorder ?? 0).toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{pick("수량", "Units")}</p>
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
            <h2 className="text-sm font-semibold">{pick("판매 추세", "Sales Trend")}</h2>
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
                    {m === "revenue" ? pick("매출", "Revenue") : pick("주문", "Orders")}
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
                <option value="area">{pick("영역", "Area")}</option>
                <option value="line">{pick("선", "Line")}</option>
                <option value="bar">{pick("막대", "Bar")}</option>
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
              {pick("해당 기간의 판매 데이터가 없습니다", "No sales data for this period")}
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

        {/* Sales summary â€" matches selected period, links to Orders page */}
        <Link
          href={ordersHref}
          onClick={(event) => guardLinkClick(event, ordersHref)}
          className="rounded-xl border bg-white p-4 transition-colors hover:bg-[#f0eee9] dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60 block"
        >
          <h2 className="mb-3 text-sm font-semibold">{pick("판매", "Sales")} &ndash; {periodLabel}</h2>

          {chartLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{pick("주문", "Orders")}</p>
                <p className="text-2xl font-bold">{(salesSummary?.totalUnits ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{pick("매출", "Revenue")}</p>
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
                  <span className="text-xs text-muted-foreground">{pick("이전 기간 대비", "vs prev period")}</span>
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
            {pick("빠른 링크", "Quick Links")}
          </h2>
          <QuickLinks links={localizedQuickLinks} onNavigate={canOpenHref} />
        </div>
      )}
    </div>
  );
}

// â"€â"€ Tooltip â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint & { dateLabel: string } }[] }) {
  const { pick } = useI18n();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover p-2.5 shadow-lg text-xs">
      <p className="mb-1 font-medium">{d.dateLabel}</p>
      <p><span className="text-muted-foreground">{pick("매출", "Revenue")}: </span><span className="font-medium">${d.revenue.toLocaleString()}</span></p>
      <p><span className="text-muted-foreground">{pick("주문", "Orders")}: </span><span className="font-medium">{d.quantity.toLocaleString()}</span></p>
    </div>
  );
}
