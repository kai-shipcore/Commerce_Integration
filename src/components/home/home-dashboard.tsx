"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { subDays, subMonths, subYears, format } from "date-fns";
import { toast } from "sonner";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  AlertTriangle, Clock, DollarSign, LayoutDashboard, Loader2,
  Package, RefreshCw, ShoppingCart, TrendingDown, TrendingUp, Truck,
} from "lucide-react";
import { QuickLinks, type QuickLink } from "./quick-links";
import { SkuHealthDonut, type StockDistribution } from "./sku-health-donut";
import { CriticalSkuList, type TopCriticalSku } from "./critical-sku-list";
import { DelayedContainerTable, type DelayedContainer } from "./delayed-container-table";
import { InboundContainerTable, type InboundContainer } from "./inbound-container-table";
import { apiPath } from "@/lib/api-path";

// ── Types ────────────────────────────────────────────────────────────────────

interface CatKpiDeltas {
  criticalSku: number;
  expectedOos: number;
  overstockSku: number;
  urgentPo: number;
}

interface CatKpis {
  criticalSku: number;
  expectedOos: number;
  overstockSku: number;
  urgentPo: number;
  deltas: CatKpiDeltas;
}

interface CategoryFull {
  kpis: CatKpis;
  stockDistribution: StockDistribution;
  topCritical: TopCriticalSku[];
}

interface HomeStats {
  byCategoryFull: {
    fm: CategoryFull;
    cc: CategoryFull;
    sc: CategoryFull;
  };
  delayedContainerList: DelayedContainer[];
  inboundContainers: InboundContainer[];
  kpis: { delayedContainers: number };
  lastSync: string | null;
}

interface TrendPoint { date: string; quantity: number; revenue: number }
interface SalesSummary { totalUnits: number; totalRevenue: number; growthPct: number | null }

type CategoryKey = "sc" | "cc" | "fm";
type Period    = "7d" | "30d" | "90d" | "6m" | "1y" | "ytd";
type ViewMode  = "revenue" | "orders";
type ChartType = "area" | "line" | "bar";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDateRange(period: Period) {
  const end = new Date();
  const start =
    period === "7d"  ? subDays(end, 6)   :
    period === "30d" ? subDays(end, 29)  :
    period === "90d" ? subDays(end, 89)  :
    period === "6m"  ? subMonths(end, 6) :
    period === "1y"  ? subYears(end, 1)  :
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

function deltaLabel(n: number): { text: string; positive: boolean } | null {
  if (n === 0) return null;
  return { text: `${n > 0 ? "↑" : "↓"} ${Math.abs(n)}`, positive: n < 0 };
}

// ── Component ────────────────────────────────────────────────────────────────

export function HomeDashboard({
  links,
  allowedHrefs,
}: {
  links: QuickLink[];
  allowedHrefs: string[];
}) {
  const { pick } = useI18n();
  const router = useRouter();

  const localizedQuickLinks = useMemo(
    () => links.map((link) => ({
      ...link,
      label: link.labelKo && link.labelEn ? pick(link.labelKo, link.labelEn) : link.label,
    })),
    [links, pick]
  );

  // SC → CC → FM order; default SC
  const CATEGORY_TABS = useMemo(() => [
    { key: "sc" as CategoryKey, label: pick("시트 커버", "Seat Cover") },
    { key: "cc" as CategoryKey, label: pick("카 커버",   "Car Cover") },
    { key: "fm" as CategoryKey, label: pick("플로어 매트", "Floor Mat") },
  ], [pick]);

  const PERIOD_OPTIONS = useMemo(() => [
    { value: "7d"  as Period, label: pick("최근 7일",   "Last 7 Days") },
    { value: "30d" as Period, label: pick("최근 30일",  "Last 30 Days") },
    { value: "90d" as Period, label: pick("최근 90일",  "Last 90 Days") },
    { value: "6m"  as Period, label: pick("최근 6개월", "Last 6 Months") },
    { value: "1y"  as Period, label: pick("최근 1년",   "Last Year") },
    { value: "ytd" as Period, label: pick("올해 누계",  "Year to Date") },
  ], [pick]);

  // Planning KPIs
  const [stats, setStats]       = useState<HomeStats | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat, setActiveCat]   = useState<CategoryKey>("sc");

  // Sales chart
  const [period, setPeriod]       = useState<Period>("7d");
  const [viewMode, setViewMode]   = useState<ViewMode>("revenue");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [ordersHref, setOrdersHref]     = useState("/orders?preset=last7");

  // ── KPI fetch ──────────────────────────────────────────────────────────────
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

  // ── Sales trend fetch ──────────────────────────────────────────────────────
  const fetchTrend = useCallback(async (p: Period) => {
    setChartLoading(true);
    try {
      const { start, end }       = getDateRange(p);
      const { start: pStart, end: pEnd } = getPrevDateRange(p);
      const fmt = (d: Date) => format(d, "yyyy-MM-dd");
      const presetMap: Record<Period, string> = {
        "7d": "last7", "30d": "last30", "90d": "last90",
        "6m": "last6m", "1y": "last1y", "ytd": "ytd",
      };
      setOrdersHref(`/orders?preset=${presetMap[p]}`);
      const params = new URLSearchParams({
        startDate: fmt(start), endDate: fmt(end),
        prevStartDate: fmt(pStart), prevEndDate: fmt(pEnd),
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

  // ── Derived per-category data ──────────────────────────────────────────────
  const syncLabel = stats?.lastSync
    ? `${pick("동기화", "Synced")} ${new Date(stats.lastSync).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles", month: "numeric", day: "numeric",
        year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      })}`
    : null;

  const catData         = stats?.byCategoryFull?.[activeCat];
  const catKpis         = catData?.kpis;
  const distribution    = catData?.stockDistribution ?? { d0_30: 0, d30_60: 0, d60_180: 0, d180plus: 0 };
  const topCritical     = catData?.topCritical       ?? [];
  const delayedContainerList = stats?.delayedContainerList ?? [];
  const inboundContainers    = stats?.inboundContainers    ?? [];
  const delayedContainersCount = stats?.kpis.delayedContainers ?? 0;

  const dashLink = `/planning/dashboard-ag-grid?product=${activeCat}`;

  const canOpenHref = useCallback((href: string) => {
    const pathname = href.startsWith("http") ? new URL(href).pathname : href.split("?")[0];
    const canOpen  = allowedHrefs.includes(pathname);
    if (!canOpen) {
      toast.error(pick(
        "이 페이지에 접근 권한이 없습니다. 관리자에게 권한을 요청하세요.",
        "You do not have permission to access this page. Please contact your administrator."
      ));
    }
    return canOpen;
  }, [allowedHrefs, pick]);

  const guardLinkClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (canOpenHref(href)) return;
    event.preventDefault();
    event.stopPropagation();
  }, [canOpenHref]);

  const chartData   = trendData.map((d) => ({
    ...d,
    dateLabel: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
  const dataKey     = viewMode === "revenue" ? "revenue" : "quantity";
  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period;

  // KPI card definitions — 4 per-category + 1 global (delayed containers)
  const KPI_CARDS = [
    {
      key: "criticalSku",
      labelKo: "위험 SKU",      labelEn: "Critical SKUs",
      subKo:   "SOD ≤ 30일",    subEn:   "SOD ≤ 30 days",
      icon: AlertTriangle,
      color:   "text-red-600 dark:text-red-400",
      hoverBg: "hover:bg-red-50 dark:hover:bg-red-950/30",
      href:    `${dashLink}&status=crit`,
      value:   catKpis?.criticalSku  ?? 0,
      delta:   catKpis?.deltas.criticalSku  ?? 0,
    },
    {
      key: "expectedOos",
      labelKo: "품절 예상",      labelEn: "Expected OOS",
      subKo:   "SOD 31 ~ 60일", subEn:   "SOD 31–60d",
      icon: Clock,
      color:   "text-amber-600 dark:text-amber-400",
      hoverBg: "hover:bg-amber-50 dark:hover:bg-amber-950/30",
      href:    `${dashLink}&status=warn`,
      value:   catKpis?.expectedOos  ?? 0,
      delta:   catKpis?.deltas.expectedOos  ?? 0,
    },
    {
      key: "overstockSku",
      labelKo: "과잉 재고",    labelEn: "Overstock",
      subKo:   "SOD > 180일", subEn:   "SOD > 180d",
      icon: Package,
      color:   "text-blue-600 dark:text-blue-400",
      hoverBg: "hover:bg-blue-50 dark:hover:bg-blue-950/30",
      href:    `${dashLink}&status=over`,
      value:   catKpis?.overstockSku ?? 0,
      delta:   catKpis?.deltas.overstockSku ?? 0,
    },
    {
      key: "urgentPo",
      labelKo: "긴급 발주",        labelEn: "Urgent PO",
      subKo:   "입고 없이 위험",   subEn:   "Critical, no inbound",
      icon: ShoppingCart,
      color:   "text-orange-600 dark:text-orange-400",
      hoverBg: "hover:bg-orange-50 dark:hover:bg-orange-950/30",
      href:    `${dashLink}&status=crit&inbound=false`,
      value:   catKpis?.urgentPo    ?? 0,
      delta:   catKpis?.deltas.urgentPo    ?? 0,
    },
    {
      key: "delayedContainers",
      labelKo: "지연 컨테이너",  labelEn: "Delayed Cont.",
      subKo:   "ETA 경과",       subEn:   "Past ETA",
      icon: Truck,
      color:   "text-purple-600 dark:text-purple-400",
      hoverBg: "hover:bg-purple-50 dark:hover:bg-purple-950/30",
      href:    "/planning/container-timeline",
      value:   delayedContainersCount,
      delta:   0,
    },
  ] as const;

  // ── Render ─────────────────────────────────────────────────────────────────
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

      {/* ── Category tabs ── */}
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

      {/* ── 5 KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpiLoading
          ? [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="h-8 w-12" />
                <Skeleton className="mt-2 h-3 w-20" />
              </div>
            ))
          : KPI_CARDS.map((card) => {
              const Icon = card.icon;
              const dl   = deltaLabel(card.delta);
              return (
                <Link
                  key={card.key}
                  href={card.href}
                  onClick={(e) => guardLinkClick(e, card.href)}
                  className={`rounded-xl border bg-white p-4 transition-colors dark:border-zinc-700 dark:bg-zinc-800 ${card.hoverBg}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">{pick(card.labelKo, card.labelEn)}</p>
                    <Icon className={`h-3.5 w-3.5 ${card.color}`} />
                  </div>
                  <p className={`mt-1.5 text-3xl font-bold ${card.color}`}>{card.value.toLocaleString()}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{pick(card.subKo, card.subEn)}</p>
                  {dl && (
                    <p className={`mt-1.5 text-[10px] font-medium ${dl.positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                      {pick(`전일 대비 ${dl.text}`, `vs prev ${dl.text}`)}
                    </p>
                  )}
                </Link>
              );
            })}
      </div>

      {/* ── 3-Panel Grid ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr]">

        {/* Left — Top 5 Critical SKUs (per category) */}
        <div className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {pick("위험 SKU TOP 10", "Top 10 Critical SKUs")}
            </h2>
            <Link
              href="/planning/sku-forecasts?filter=critical"
              onClick={(e) => guardLinkClick(e, "/planning/sku-forecasts")}
              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            >
              {pick("전체 보기 →", "View all →")}
            </Link>
          </div>
          <CriticalSkuList
            items={topCritical}
            loading={kpiLoading}
          />
        </div>

        {/* Center — Inbound Containers (upcoming, ETA asc) */}
        <div className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{pick("입고 예정 컨테이너", "Inbound Containers")}</h2>
            <Link
              href="/planning/container-timeline"
              onClick={(e) => guardLinkClick(e, "/planning/container-timeline")}
              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            >
              {pick("전체 보기 →", "View all →")}
            </Link>
          </div>
          <InboundContainerTable items={inboundContainers} loading={kpiLoading} />
        </div>

        {/* Right — Stock Distribution Donut (per category) */}
        <div className="rounded-xl border bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold">{pick("재고 분포", "Stock Health")}</h2>
          <SkuHealthDonut distribution={distribution} loading={kpiLoading} dashLink={dashLink} />
        </div>
      </div>

      {/* ── Sales section ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">

        {/* Chart */}
        <div
          className="rounded-xl border bg-white p-4 transition-colors cursor-pointer hover:bg-[#f0eee9] dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60"
          onClick={() => { if (canOpenHref("/orders")) router.push(ordersHref); }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{pick("판매 추세", "Sales Trend")}</h2>
            <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="h-7 rounded border border-[#C2BFB5] bg-white px-2 text-xs text-[#1A1917] outline-none focus:border-[#1a5cdb] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="flex h-8 overflow-hidden rounded-lg border border-[#C2BFB5] bg-[#f5f4f0] p-0.5 dark:border-zinc-600 dark:bg-zinc-900">
                {(["revenue", "orders"] as ViewMode[]).map((m) => {
                  const active = viewMode === m;
                  const Icon   = m === "revenue" ? DollarSign : Package;
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
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={52}
                      tickFormatter={(v) => viewMode === "revenue" ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={2}
                      fill="url(#homeSalesTrendFill)" fillOpacity={1} activeDot={{ r: 4 }} connectNulls />
                  </AreaChart>
                ) : chartType === "line" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={52}
                      tickFormatter={(v) => viewMode === "revenue" ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={2}
                      dot={{ r: 2, fill: "#3b82f6" }} activeDot={{ r: 4 }} connectNulls />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
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

        {/* Sales summary */}
        <Link
          href={ordersHref}
          onClick={(e) => guardLinkClick(e, ordersHref)}
          className="block rounded-xl border bg-white p-4 transition-colors hover:bg-[#f0eee9] dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60"
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

// ── Chart Tooltip ─────────────────────────────────────────────────────────────

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
