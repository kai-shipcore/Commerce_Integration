"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DemandRow } from "@/types/demand-planning";
import { formatNumber } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

export function SalesAnalysisTab({ sku, language }: { sku: DemandRow; language: SkuForecastLanguage }) {
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const totalSales = [
    { label: "7D", value: sku.west_7d + sku.east_7d },
    { label: "15D", value: sku.west_15d + sku.east_15d },
    { label: "30D", value: sku.west_30d + sku.east_30d },
    { label: "60D", value: sku.west_60d + sku.east_60d },
    { label: "90D", value: sku.west_90d + sku.east_90d },
  ];

  return (
    <div className="space-y-3">
      <SectionLabel>{pick(language, "판매 현황", "Sales status")}</SectionLabel>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="planning-panel rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{pick(language, "판매 추이", "Sales Trend")}</h3>
            <div className="flex rounded-md border">
              <button
                type="button"
                onClick={() => setChartType("line")}
                className={`rounded-l-md px-3 py-1 text-xs font-semibold ${
                  chartType === "line"
                    ? "bg-[#1a5cdb] text-white dark:bg-blue-600"
                    : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
                }`}
              >
                {pick(language, "선", "Line")}
              </button>
              <button
                type="button"
                onClick={() => setChartType("bar")}
                className={`rounded-r-md px-3 py-1 text-xs font-semibold ${
                  chartType === "bar"
                    ? "bg-[#1a5cdb] text-white dark:bg-blue-600"
                    : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
                }`}
              >
                {pick(language, "막대", "Bar")}
              </button>
            </div>
          </div>
          <div className="mt-4 h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "line" ? (
                <LineChart data={totalSales} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} width={48} />
                  <Tooltip content={<SalesTrendTooltip language={language} />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#3b82f6" }}
                    activeDot={{ r: 5, fill: "#3b82f6" }}
                  />
                </LineChart>
              ) : (
                <BarChart data={totalSales} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} width={48} />
                  <Tooltip content={<SalesTrendTooltip language={language} />} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-3">
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
