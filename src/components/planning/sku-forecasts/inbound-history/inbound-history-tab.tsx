"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DemandRow } from "@/types/demand-planning";
import { formatNumber } from "../types";
import { pick, type SkuForecastLanguage } from "../language";
import { apiPath, withBasePath } from "@/lib/api-path";

type InboundHistoryRow = {
  itemId: number;
  containerId: number;
  containerNumber: string;
  status: string;
  eta: string | null;
  statusChangedAt: string | null;
  stockInCompletedAt: string | null;
  inboundQty: number;
  cbm: number;
  sourceTypes: string[];
  remainingReferences: string[];
  remainingQty: number;
  mistakeReferences: string[];
  mistakeQty: number;
  itemUpdatedAt: string | null;
  changeHistory: string | null;
};

export function InboundHistoryTab({
  sku,
  language,
}: {
  sku: DemandRow;
  language: SkuForecastLanguage;
}) {
  const [state, setState] = useState<{ sku: string; rows: InboundHistoryRow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath(`/api/planning/sku-forecasts/inbound-history?masterSku=${encodeURIComponent(sku.sku)}`))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ success: boolean; data?: InboundHistoryRow[] }>;
      })
      .then((result) => {
        if (!cancelled) setState({ sku: sku.sku, rows: result.success ? result.data ?? [] : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ sku: sku.sku, rows: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [sku.sku]);

  const rows = useMemo(() => (state?.sku === sku.sku ? state.rows : []), [sku.sku, state]);
  const loading = state?.sku !== sku.sku;
  const summary = useMemo(() => {
    const currentInbound = rows
      .filter((row) => row.status === "shipped" || row.status === "packing_received")
      .reduce((sum, row) => sum + row.inboundQty, 0);
    const completedQty = rows
      .filter((row) => row.status === "complete")
      .reduce((sum, row) => sum + row.inboundQty, 0);
    const remainingQty = rows.reduce((sum, row) => sum + row.remainingQty, 0);
    const mistakeQty = rows.reduce((sum, row) => sum + row.mistakeQty, 0);

    return { currentInbound, completedQty, remainingQty, mistakeQty };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {pick(language, "입고 이력", "Inbound History")}
        </div>
        <span className="text-xs text-muted-foreground">
          {loading ? pick(language, "불러오는 중...", "Loading...") : `${formatNumber(rows.length)} ${pick(language, "건", "records")}`}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <HistorySummaryCard label={pick(language, "현재 입고", "Current inbound")} value={`${formatNumber(summary.currentInbound)} units`} />
        <HistorySummaryCard label={pick(language, "완료 이력", "Completed history")} value={`${formatNumber(summary.completedQty)} units`} />
        <HistorySummaryCard label="Remaining" value={`${formatNumber(summary.remainingQty)} units`} />
        <HistorySummaryCard label="Mistake" value={`${formatNumber(summary.mistakeQty)} units`} />
      </div>

      <div className="planning-panel overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[180px_120px_120px_1fr_120px_48px_170px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          <div>{pick(language, "컨테이너", "Container")}</div>
          <div>{pick(language, "상태", "Status")}</div>
          <div>ETA</div>
          <div />
          <div className="text-right">{pick(language, "수량", "Qty")}</div>
          <div />
          <div>{pick(language, "완료/변경일", "Done / changed")}</div>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {pick(language, "입고 이력을 불러오는 중...", "Loading inbound history...")}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {pick(language, "입고 이력이 없습니다.", "No inbound history.")}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.itemId}
              className="grid grid-cols-[180px_120px_120px_1fr_120px_48px_170px] items-center border-t border-[#e2dfd8] px-3 py-2 text-sm"
            >
              <Link
                href={withBasePath(`/planning/container-planning?containerId=${encodeURIComponent(String(row.containerId))}&sku=${encodeURIComponent(sku.sku)}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-xs font-semibold text-[#1a5cdb] hover:underline"
              >
                {row.containerNumber}
              </Link>
              <div>
                <StatusBadge status={row.status} language={language} />
              </div>
              <div className="font-mono text-xs">{row.eta ?? "-"}</div>
              <div />
              <div className="text-right font-mono font-semibold">{formatNumber(row.inboundQty)}</div>
              <div />
              <div className="font-mono text-xs text-muted-foreground">
                {formatDateTime(row.stockInCompletedAt ?? row.statusChangedAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistorySummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="planning-panel rounded-lg border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function StatusBadge({ status, language }: { status: string; language: SkuForecastLanguage }) {
  const label = statusLabel(status, language);
  const color =
    status === "complete"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "draft"
        ? "bg-pink-50 text-pink-700 border-pink-200"
        : status === "packing_received"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-amber-50 text-amber-700 border-amber-200";

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${color}`}>{label}</span>;
}

function statusLabel(status: string, language: SkuForecastLanguage) {
  if (status === "draft") return "Draft";
  if (status === "shipped") return pick(language, "패킹", "Packing");
  if (status === "packing_received") return pick(language, "선적", "Shipped");
  if (status === "complete") return "Complete";
  return status || "-";
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 16).replace("T", " ");
}
