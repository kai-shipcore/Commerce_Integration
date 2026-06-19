"use client";

import { useState } from "react";
import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, recommendedContainerQty, salesVelocityTrend, type SkuMasterMeta } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

export function PurchaseRecommendationTab({
  sku,
  master,
  language,
  targetInventoryDays,
  includeDraftContainers,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
  language: SkuForecastLanguage;
  targetInventoryDays: number;
  includeDraftContainers: boolean;
}) {
  const dailyAvg = sku.total_avg_curr;
  const targetQty = Math.ceil(dailyAvg * targetInventoryDays);
  const inboundQty = sku.total_inbound_qty ?? 0;
  const projectedQty = sku.total_stock + inboundQty + Math.min(sku.back, 0);
  const rawQty = Math.max(targetQty - projectedQty, 0);
  const orderMultiple = Math.max(master.orderMultiple || master.moq || 1, 1);
  const recommendedQty = recommendedContainerQty(sku, orderMultiple, targetInventoryDays);
  const recommendedCbm = recommendedQty * master.cbmPerUnit;
  const { recentDaily, thirtyDayDaily, changePercent: velocityChange } = salesVelocityTrend(sku);

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {pick(language, "컨테이너 추천", "Container recommendation")}
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className={`planning-panel rounded-lg border p-5 ${recommendedQty > 0 ? "border-[#a0c0f0] bg-[#ebf0fd] dark:border-blue-700 dark:bg-blue-900/40" : ""}`}>
          <div className="text-sm text-muted-foreground">{pick(language, "추천 컨테이너 수량", "Recommended Container Qty")}</div>
          <div className="mt-2 font-mono text-4xl font-bold">{formatNumber(recommendedQty)}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {pick(language, "주문 배수", "Multiple")} {formatNumber(orderMultiple)} {pick(language, "개", "units")}
          </div>
          <div className="mt-4 rounded-md border bg-white/70 p-3 text-sm dark:border-zinc-600 dark:bg-zinc-700/50">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{pick(language, "예상 CBM", "Estimated CBM")}</span>
              <span className="font-mono font-semibold">{formatNumber(recommendedCbm, 2)} m3</span>
            </div>
          </div>
        </div>

        <div className="planning-panel rounded-lg border p-5">
          <h3 className="text-sm font-semibold">{pick(language, "추천 근거", "Explain Why")}</h3>
          <div className="mt-3 space-y-2 text-sm">
            <Reason>
              {pick(language, "목표 재고는", "Target stock is")} <Strong>{formatNumber(targetQty)}</Strong> {pick(language, "개입니다:", "units:")}
              {" "}<Strong>{formatNumber(dailyAvg, 2)}/d</Strong> {pick(language, "현재 판매 속도 x", "current velocity x")} <Strong>{targetInventoryDays} {pick(language, "일", "days")}</Strong>.
            </Reason>
            <Reason>
              {pick(language, "현재 재고, 입고, 백오더 영향을 반영한 예상 재고는", "Projected stock is")} <Strong>{formatNumber(projectedQty)}</Strong> {pick(language, "개입니다.", "units after current stock, inbound, and backorder impact.")}
            </Reason>
            <Reason>
              {pick(language, "필요 수량은", "Raw need is")} <Strong>{formatNumber(rawQty)}</Strong> {pick(language, "개이며, 주문 배수", "units, rounded to")}
              {" "}<Strong>{formatNumber(recommendedQty)}</Strong> {pick(language, `개로 조정됩니다. (${formatNumber(orderMultiple)}개 단위)`, `by the ${formatNumber(orderMultiple)}-unit order multiple.`)}
            </Reason>
            <Reason>
              {pick(language, "최근 7일 FBM 판매 속도는", "Recent FBM velocity is")} <Strong>{formatNumber(recentDaily, 2)}/d</Strong>{pick(language, "이며, 30일 평균은", " over 7 days versus")}
              {" "}<Strong>{formatNumber(thirtyDayDaily, 2)}/d</Strong>{pick(language, "입니다", " over 30 days")}
              {velocityChange === null
                ? "."
                : <>{pick(language, ". 변화율은 ", ", a ")}<Strong>{formatSignedPercent(velocityChange)}</Strong>{pick(language, "입니다.", " change.")}</>}
            </Reason>
          </div>
        </div>
      </div>

      <RecommendationSimulator
        key={sku.sku}
        sku={sku}
        master={master}
        recommendedQty={recommendedQty}
        language={language}
      />

      <div className="planning-panel rounded-lg border p-5">
        <h3 className="text-sm font-semibold">{pick(language, "계산 내역", "Calculation")}</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            [pick(language, "목표 일수", "Target Days"), `${targetInventoryDays} ${pick(language, "일", "days")}`],
            [pick(language, "일평균 판매", "Daily Average"), `${formatNumber(dailyAvg, 2)}/d`],
            [pick(language, "목표 재고", "Target Stock"), formatNumber(targetQty)],
            [pick(language, "현재 재고", "Current Stock"), formatNumber(sku.total_stock)],
            [includeDraftContainers ? pick(language, "입고 (Draft 포함)", "Inbound incl. Draft") : pick(language, "입고", "Inbound"), formatNumber(inboundQty)],
            [pick(language, "백오더 영향", "Backorder Impact"), formatNumber(Math.min(sku.back, 0))],
            [pick(language, "예상 재고", "Projected Stock"), formatNumber(projectedQty)],
            [pick(language, "필요 수량", "Raw Need"), formatNumber(rawQty)],
          ].map(([label, value]) => (
            <Metric key={label} label={label} value={value} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RecommendationSimulator({
  sku,
  master,
  recommendedQty,
  language,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
  recommendedQty: number;
  language: SkuForecastLanguage;
}) {
  const today = localDateString(new Date());
  const [quantity, setQuantity] = useState(String(recommendedQty));
  const [eta, setEta] = useState(sku.next_eta ?? today);
  const simulatedQty = Math.max(0, Math.floor(Number(quantity) || 0));
  const etaDays = Math.max(0, calendarDaysBetween(today, eta));
  const dailyAvg = sku.total_avg_curr;
  const demandBeforeEta = Math.ceil(dailyAvg * etaDays);
  const currentAvailable = sku.total_stock + Math.min(sku.back, 0);
  const availableBeforeEta = currentAvailable - demandBeforeEta;
  const backorderBeforeEta = Math.max(0, -availableBeforeEta);
  const existingInbound = sku.total_inbound_qty ?? 0;
  const availableAfterEta = availableBeforeEta + existingInbound + simulatedQty;
  const backorderAfterEta = Math.max(0, -availableAfterEta);
  const simulatedCbm = simulatedQty * master.cbmPerUnit;
  const expectedSod = dailyAvg > 0 && availableAfterEta > 0
    ? addCalendarDays(eta, Math.floor(availableAfterEta / dailyAvg))
    : null;

  return (
    <div className="planning-panel rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{pick(language, "What-if 시뮬레이션", "What-if Simulation")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {pick(language, "제안 컨테이너 수량 또는 ETA를 변경하면 결과가 즉시 갱신됩니다.", "Adjust a proposed container quantity or ETA. Results update immediately.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setQuantity(String(recommendedQty));
            setEta(sku.next_eta ?? today);
          }}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
        >
          {pick(language, "추천값 초기화", "Reset recommendation")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-md border p-3 text-sm">
          <span className="block text-xs text-muted-foreground">{pick(language, "제안 컨테이너 수량", "Proposed Container Qty")}</span>
          <input
            type="number"
            min={0}
            step={Math.max(master.orderMultiple || master.moq || 1, 1)}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:border-[#1a5cdb]"
          />
        </label>
        <label className="rounded-md border p-3 text-sm">
          <span className="block text-xs text-muted-foreground">{pick(language, "가정 ETA", "Assumed ETA")}</span>
          <input
            type="date"
            min={today}
            value={eta}
            onChange={(event) => setEta(event.target.value || today)}
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:border-[#1a5cdb]"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label={pick(language, "ETA 전 수요", "Demand Before ETA")} value={formatNumber(demandBeforeEta)} />
        <Metric label={pick(language, "ETA 전 백오더", "Backorder Before ETA")} value={formatNumber(backorderBeforeEta)} danger={backorderBeforeEta > 0} />
        <Metric label={pick(language, "ETA 후 백오더", "Backorder After ETA")} value={formatNumber(backorderAfterEta)} danger={backorderAfterEta > 0} />
        <Metric label={pick(language, "필요 CBM", "Required CBM")} value={`${formatNumber(simulatedCbm, 2)} m3`} />
        <Metric label={pick(language, "예상 SOD", "Expected SOD")} value={expectedSod ?? "-"} />
      </div>

      <div className="mt-4 rounded-md border bg-[#f8f7f4] p-3 text-xs text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">
        {pick(language, "현재 SOD", "Current SOD")} <Strong>{sku.sod ?? "-"}</Strong>
        <span className="mx-2">|</span>
        {pick(language, "시뮬레이션 SOD", "Simulated SOD")} <Strong>{expectedSod ?? "-"}</Strong>
        <span className="mx-2">|</span>
        {pick(language, "ETA 후 잔여", "Balance after ETA")} <Strong>{formatNumber(availableAfterEta)}</Strong> {pick(language, "개", "units")}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {pick(language, "시뮬레이션은 현재 재고, 기존 입고 합계, 현재 백오더, 현재 일평균 판매량, 가정 ETA까지의 수요를 사용합니다.", "Simulation uses current stock, existing inbound total, current backorder, current daily average, and demand until the assumed ETA.")}
      </p>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`whitespace-nowrap font-mono font-semibold ${danger ? "text-red-700 dark:text-red-300" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Reason({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-[#f8f7f4] p-3 dark:border-zinc-700 dark:bg-zinc-800">
      {children}
    </div>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-mono font-semibold text-foreground">{children}</span>;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 1)}%`;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDaysBetween(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function addCalendarDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00`);
  if (Number.isNaN(result.getTime())) return "-";
  result.setDate(result.getDate() + days);
  return localDateString(result);
}
