"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber } from "../types";
import { pick, type SkuForecastLanguage } from "../language";
import { apiPath } from "@/lib/api-path";

type InboundContainer = {
  id: number;
  name: string;
  eta: string | null;
  status: string;
  inbound_qty: number;
  cbm: number;
};

export function InventoryInboundTab({
  sku,
  language,
  targetInventoryDays,
  includeDraftContainers,
  highlightedContainerId,
  highlightedContainerName,
}: {
  sku: DemandRow;
  language: SkuForecastLanguage;
  targetInventoryDays: number;
  includeDraftContainers: boolean;
  highlightedContainerId?: string;
  highlightedContainerName?: string;
}) {
  const [inboundState, setInboundState] = useState<{ sku: string; includeDrafts: boolean; rows: InboundContainer[] } | null>(null);
  const highlightedContainerRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const draftSuffix = includeDraftContainers ? "&includeDrafts=1" : "";
    fetch(apiPath(`/api/planning/sku-forecasts/inbound?masterSku=${encodeURIComponent(sku.sku)}${draftSuffix}`))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ success: boolean; data?: InboundContainer[] }>;
      })
      .then((result) => {
        if (!cancelled) {
          setInboundState({
            sku: sku.sku,
            includeDrafts: includeDraftContainers,
            rows: result.success ? result.data ?? [] : [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInboundState({ sku: sku.sku, includeDrafts: includeDraftContainers, rows: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [includeDraftContainers, sku.sku]);

  const inboundRows = inboundState?.sku === sku.sku && inboundState.includeDrafts === includeDraftContainers ? inboundState.rows : [];
  const loading = inboundState?.sku !== sku.sku || inboundState.includeDrafts !== includeDraftContainers;
  const inboundQty = sku.total_inbound_qty ?? 0;
  const projected = sku.total_stock + inboundQty + Math.min(sku.back, 0);
  const targetStock = Math.ceil(sku.total_avg_curr * targetInventoryDays);
  const coveragePercent = targetStock > 0 ? (projected / targetStock) * 100 : 0;
  const progressPercent = Math.min(Math.max(coveragePercent, 3), 100);
  const days = daysUntil(sku.sod);
  const draftQty = inboundRows
    .filter((container) => container.status === "draft")
    .reduce((sum, container) => sum + container.inbound_qty, 0);
  const inboundRowsTotal = inboundRows.reduce((sum, container) => sum + container.inbound_qty, 0);

  useEffect(() => {
    if (loading || !highlightedContainerRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      highlightedContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedContainerId, highlightedContainerName, loading]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {pick(language, "재고 및 입고", "Inventory and inbound")}
        </div>
        {includeDraftContainers ? (
          <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {pick(language, "Draft 포함", "Draft included")}
            {draftQty > 0 ? ` +${formatNumber(draftQty)}` : ""}
          </div>
        ) : null}
      </div>

      <div className="planning-panel rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Summary label={pick(language, "West 재고", "West Stock")} value={sku.west_stock} />
          <Summary label={pick(language, "East 재고", "East Stock")} value={sku.east_stock} />
          <Summary label={pick(language, "백오더", "Backorder")} value={sku.back} danger={sku.back < 0} />
          <Summary label="SOD" value={sku.sod ?? "-"} sub={days === null ? undefined : `${days}${pick(language, "일", " days")}`} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{pick(language, "예상 재고 확보율", "Projected Inventory Coverage")}</span>
          <span className="font-mono font-semibold text-foreground">
            {pick(language, `${targetInventoryDays}일 목표의 `, "")}{formatNumber(coveragePercent, 1)}%{pick(language, "", ` of ${targetInventoryDays}-day target`)}
          </span>
        </div>
        <div className="planning-muted mt-2 h-6 overflow-hidden rounded-full border">
          <div className="h-full bg-[#1a5cdb]" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-1 text-right font-mono text-xs text-muted-foreground">
          {pick(language, "예상", "Projected")} {formatNumber(projected)} / {pick(language, "목표", "Target")} {formatNumber(targetStock)} {pick(language, "개", "units")}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="planning-panel rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{pick(language, "입고 예정 컨테이너", "Expected Inbound Containers")}</h3>
            <span className="text-xs font-semibold text-foreground">
              {loading
                ? pick(language, "불러오는 중...", "Loading...")
                : pick(language, `총 ${formatNumber(inboundRowsTotal)} units`, `Total ${formatNumber(inboundRowsTotal)} units`)}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {loading && inboundRows.length === 0 ? (
              <div className="rounded-md border bg-[#f8f7f4] p-4 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">{pick(language, "컨테이너 상세를 불러오는 중...", "Loading container details...")}</div>
            ) : inboundRows.length === 0 ? (
              <div className="rounded-md border bg-[#f8f7f4] p-4 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">
                {includeDraftContainers ? pick(language, "입고 컨테이너가 없습니다.", "No inbound containers.") : pick(language, "활성 입고 컨테이너가 없습니다.", "No active inbound containers.")}
              </div>
            ) : (
              inboundRows.map((container) => {
                const isDraft = container.status === "draft";
                const isHighlighted =
                  (highlightedContainerId !== undefined && String(container.id) === highlightedContainerId) ||
                  (highlightedContainerName !== undefined && container.name.toLowerCase() === highlightedContainerName.toLowerCase());
                const className = `group grid gap-2 rounded-md border p-3 text-sm text-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1238a0] dark:hover:border-blue-500 dark:hover:bg-blue-950/50 dark:hover:text-blue-100 md:grid-cols-[1fr_90px_100px_90px] ${
                  isHighlighted
                    ? "border-[#1a5cdb] bg-blue-100 ring-2 ring-[#1a5cdb] ring-offset-1 dark:border-blue-400 dark:bg-blue-950/60 dark:ring-blue-400"
                    : isDraft ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20" : ""
                }`;
                return (
                  <Link
                    key={container.name}
                    ref={isHighlighted ? highlightedContainerRef : undefined}
                    href={`/planning/container-planning?containerId=${encodeURIComponent(String(container.id))}`}
                    className={className}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate font-semibold">{container.name}</div>
                        {isHighlighted ? <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{pick(language, "이전 화면", "From Timeline")}</span> : null}
                        {isDraft ? <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">Draft</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground group-hover:text-current">{container.status ?? pick(language, "상태 미상", "status unknown")}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground group-hover:text-current">ETA</div>
                      <div className="font-mono">{container.eta ?? "-"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground group-hover:text-current">{pick(language, "수량", "Qty")}</div>
                      <div className="font-mono font-semibold">{formatNumber(container.inbound_qty)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground group-hover:text-current">CBM</div>
                      <div className="font-mono">{formatNumber(container.cbm, 2)}</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <SummaryCard label={pick(language, "현재 재고", "Current Stock")} value={sku.total_stock} />
          <SummaryCard label={includeDraftContainers ? pick(language, "입고 예정 (Draft 포함)", "Expected Inbound incl. Draft") : pick(language, "입고 예정", "Expected Inbound")} value={inboundQty} prefix="+" />
          <SummaryCard label={pick(language, "예상 재고", "Projected Stock")} value={projected} />
          <SummaryCard label={pick(language, "잔여 / 오류", "Remaining / Mistake")} value={`${formatNumber(sku.remaining)} / ${formatNumber(sku.mistake)}`} />
        </div>
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  sub,
  danger = false,
}: {
  label: string;
  value: number | string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border bg-[#f8f7f4] p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${danger ? "text-red-700" : ""}`}>
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  prefix = "",
}: {
  label: string;
  value: number | string;
  prefix?: string;
}) {
  return (
    <div className="planning-panel rounded-lg border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold">
        {typeof value === "number" ? `${prefix}${formatNumber(value)}` : value}
      </div>
    </div>
  );
}
