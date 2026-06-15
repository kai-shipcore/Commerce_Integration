"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DemandRow } from "@/types/demand-planning";
import { useSalesAnalysis, type SalesHistoryBucket } from "@/features/planning/sku-forecasts/hooks/use-sales-analysis";
import { formatNumber } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

type ChartType = "line" | "bar";
type ViewMode = "summary" | "history";
type SalesChartPoint = Record<string, string | number>;

export function SalesAnalysisTab({ sku, language }: { sku: DemandRow; language: SkuForecastLanguage }) {
  const [chartType, setChartType] = useState<ChartType>("line");
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [fromDate, setFromDate] = useState("2024-01-01");
  const [toDate, setToDate] = useState(() => localDateString(new Date()));
  const [bucket, setBucket] = useState<SalesHistoryBucket>("month");

  const history = useSalesAnalysis({
    enabled: viewMode === "history",
    sku: sku.sku,
    category: supportedSalesCategory(sku.category_code),
    from: fromDate,
    to: toDate,
    bucket,
  });

  const totalSales = [
    { label: "7D", value: sku.west_7d + sku.east_7d },
    { label: "15D", value: sku.west_15d + sku.east_15d },
    { label: "30D", value: sku.west_30d + sku.east_30d },
    { label: "60D", value: sku.west_60d + sku.east_60d },
    { label: "90D", value: sku.west_90d + sku.east_90d },
  ];
  const chartData: SalesChartPoint[] = viewMode === "history" ? history.data?.points ?? [] : totalSales;

  return (
    <div className="space-y-3">
      <SectionLabel>{pick(language, "판매 현황", "Sales status")}</SectionLabel>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="planning-panel rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{pick(language, "판매 추이", "Sales Trend")}</h3>
              {viewMode === "history" ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {fromDate} - {toDate} / {bucket}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<ViewMode>
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: "summary", label: "Default" },
                  { value: "history", label: "History" },
                ]}
              />
              <SegmentedControl<ChartType>
                value={chartType}
                onChange={setChartType}
                options={[
                  { value: "line", label: pick(language, "선", "Line") },
                  { value: "bar", label: pick(language, "막대", "Bar") },
                ]}
              />
            </div>
          </div>

          {viewMode === "history" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-[#f8f7f4] p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-8 rounded-md border bg-white px-2 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-8 rounded-md border bg-white px-2 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
              <select
                value={bucket}
                onChange={(event) => setBucket(event.target.value as SalesHistoryBucket)}
                className="h-8 rounded-md border bg-white px-2 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setFromDate("2024-01-01");
                  setToDate(localDateString(new Date()));
                  setBucket("month");
                }}
                className="h-8 rounded-md border bg-white px-2 text-xs font-semibold text-muted-foreground hover:bg-[#f0eee9] dark:border-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-700"
              >
                2024-Today
              </button>
            </div>
          ) : null}

          <div className="mt-4 h-48 w-full">
            {viewMode === "history" && history.loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading sales history...</div>
            ) : viewMode === "history" && history.error ? (
              <div className="flex h-full items-center justify-center rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
                {history.error}
              </div>
            ) : viewMode === "history" && chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No sales history for this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "line" ? (
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey={viewMode === "history" ? "date" : "label"} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} width={48} />
                    <Tooltip content={viewMode === "history" ? <HistoryTooltip /> : <SalesTrendTooltip language={language} />} />
                    {viewMode === "history" ? (
                      <>
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="west" name="West" stroke="#1a5cdb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="east" name="East" stroke="#22a666" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="total" name="Total" stroke="#b56a00" strokeWidth={2} dot={false} />
                      </>
                    ) : (
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#3b82f6" }}
                        activeDot={{ r: 5, fill: "#3b82f6" }}
                      />
                    )}
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey={viewMode === "history" ? "date" : "label"} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} width={48} />
                    <Tooltip content={viewMode === "history" ? <HistoryTooltip /> : <SalesTrendTooltip language={language} />} />
                    {viewMode === "history" ? (
                      <>
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="west" name="West" fill="#1a5cdb" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="east" name="East" fill="#22a666" radius={[3, 3, 0, 0]} />
                      </>
                    ) : (
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    )}
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {viewMode === "history" ? (
            <HistorySummary
              loading={history.loading}
              west={history.data?.totals.west ?? 0}
              east={history.data?.totals.east ?? 0}
              total={history.data?.totals.total ?? 0}
              periods={countTotalPeriods(fromDate, toDate, bucket)}
              bucket={history.data?.bucket ?? bucket}
            />
          ) : (
            <>
              <MetricTable
                title={pick(language, "West 판매", "West Sales")}
                rows={[
                  ["7D", sku.west_7d],
                  ["15D", sku.west_15d],
                  ["30D", sku.west_30d],
                  ["60D", sku.west_60d],
                  ["90D", sku.west_90d],
                ]}
              />
              <MetricTable
                title={pick(language, "East 판매", "East Sales")}
                rows={[
                  ["7D", sku.east_7d],
                  ["15D", sku.east_15d],
                  ["30D", sku.east_30d],
                  ["60D", sku.east_60d],
                  ["90D", sku.east_90d],
                ]}
              />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <AverageCard title={pick(language, "이전 평균", "Previous Avg.")} value={sku.total_avg_prev} />
        <AverageCard title={pick(language, "실제 평균", "Real Avg.")} value={sku.total_avg_real} />
        <AverageCard title={pick(language, "현재 평균", "Current Avg.")} value={sku.total_avg_curr} highlight />
      </div>
    </div>
  );
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function supportedSalesCategory(category: DemandRow["category_code"]): "SC" | "CC" | "FM" | undefined {
  return category === "SC" || category === "CC" || category === "FM" ? category : undefined;
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-md border">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-xs font-semibold ${
            index === 0 ? "rounded-l-md" : ""
          } ${
            index === options.length - 1 ? "rounded-r-md" : ""
          } ${
            value === option.value
              ? "bg-[#1a5cdb] text-white dark:bg-blue-600"
              : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SalesTrendTooltip({
  active,
  payload,
  label,
  language,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string;
  language: SkuForecastLanguage;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">
        {formatNumber(Number(payload[0].value ?? 0))} {pick(language, "판매", "Sales")}
      </div>
    </div>
  );
}

function HistoryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex min-w-32 items-center justify-between gap-4 text-sm">
            <span className="font-medium" style={{ color: entry.color }}>{entry.name}</span>
            <span className="font-mono font-semibold">{formatNumber(Number(entry.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricTable({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="planning-panel rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 grid grid-cols-5 gap-2 text-center text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border bg-[#f8f7f4] p-2 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono font-semibold">{formatNumber(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function countTotalPeriods(from: string, to: string, bucket: SalesHistoryBucket): number {
  const f = new Date(from);
  const t = new Date(to);
  if (bucket === "day") {
    return Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  }
  if (bucket === "week") {
    return Math.max(1, Math.round((t.getTime() - f.getTime()) / (7 * 86400000)) + 1);
  }
  // month
  return Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1);
}

function HistorySummary({
  loading,
  west,
  east,
  total,
  periods,
  bucket,
}: {
  loading: boolean;
  west: number;
  east: number;
  total: number;
  periods: number;
  bucket: SalesHistoryBucket;
}) {
  const average = periods > 0 ? total / periods : 0;
  const averageLabel = bucket === "day" ? "Avg / day" : bucket === "week" ? "Avg / week" : "Avg / month";

  return (
    <div className="planning-panel rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Selected Range</h3>
      <div className="mt-3 grid gap-2 text-sm">
        <SummaryRow label="West" value={loading ? "..." : formatNumber(west)} />
        <SummaryRow label="East" value={loading ? "..." : formatNumber(east)} />
        <SummaryRow label="Total" value={loading ? "..." : formatNumber(total)} strong />
        <SummaryRow label={averageLabel} value={loading ? "..." : formatNumber(average, 1)} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-[#f8f7f4] px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${strong ? "text-base font-bold" : "font-semibold"}`}>{value}</span>
    </div>
  );
}

function AverageCard({ title, value, highlight = false }: { title: string; value: number; highlight?: boolean }) {
  return (
    <div className={`planning-panel rounded-lg border p-4 ${highlight ? "border-[#a0c0f0] bg-[#ebf0fd] dark:border-blue-700 dark:bg-blue-900/40" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 font-mono text-2xl font-semibold">{formatNumber(value, 2)}/d</div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  );
}
