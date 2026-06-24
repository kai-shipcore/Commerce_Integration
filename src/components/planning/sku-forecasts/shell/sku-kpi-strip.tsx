import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, type SkuMasterMeta } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

export function SkuKpiStrip({
  sku,
  master,
  language,
  includeDraftContainers,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
  language: SkuForecastLanguage;
  includeDraftContainers: boolean;
}) {
  const inbound = sku.total_inbound_qty ?? 0;
  const projected = sku.total_stock + inbound + Math.min(sku.back, 0);
  const stockOnlyDays = sku.total_avg_curr > 0 ? sku.total_stock / sku.total_avg_curr : null;
  const projectedDays = sku.total_avg_curr > 0 ? projected / sku.total_avg_curr : null;
  const projectedSod = projectedDays === null ? null : addDays(new Date(), Math.ceil(projectedDays));
  // sku.sod is current-stock-only and now uses the same total_avg_curr shown in Daily Average.
  const currentOnlySod = sku.sod ?? null;
  const backorder = sku.back ?? 0;
  const inboundSub = includeDraftContainers
    ? pick(language, "Draft 포함", "Draft included")
    : sku.next_eta
      ? `${pick(language, "다음 ETA", "Next ETA")} ${sku.next_eta}`
      : pick(language, "활성 입고 없음", "No active inbound");

  const currentStockLabel = pick(language, "현재 재고", "Current Stock");
  const items = [
    { label: currentStockLabel, value: formatNumber(sku.total_stock), sub: `West ${formatNumber(sku.west_stock)} / East ${formatNumber(sku.east_stock)}` },
    { label: pick(language, "입고 예정", "Expected Inbound"), value: formatNumber(inbound), sub: inboundSub },
    { label: pick(language, "예상 재고", "Projected"), value: formatNumber(projected), sub: `CBM/${pick(language, "개", "unit")} ${formatNumber(master.cbmPerUnit, 4)}` },
    { label: pick(language, "일평균 판매", "Daily Average"), value: formatNumber(sku.total_avg_curr, 2), sub: `30D ${formatNumber(sku.total_30d)} ${pick(language, "개", "units")}` },
    {
      label: pick(language, "재고 유지일", "Inv. Life"),
      value: projectedDays === null ? "-" : `${formatNumber(projectedDays, 1)}d`,
      sub: projectedSod
        ? `${pick(language, "예상 소진일", "Projected SOD")} ${projectedSod}`
        : pick(language, "판매 속도 없음", "No sales velocity"),
    },
  ];

  const invLifeLabel = pick(language, "재고 유지일", "Inv. Life");
  const showCurrentOnly = inbound > 0 && stockOnlyDays !== null && currentOnlySod !== null;
  const currentOnlyUrgent = stockOnlyDays !== null && stockOnlyDays < 60;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => {
        const isInvLife = item.label === invLifeLabel;
        const isCurrentStock = item.label === currentStockLabel;
        return (
          <div key={item.label} className="planning-panel flex flex-col rounded-lg border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold">{item.value}</div>
            <div className="mt-1 flex-1 text-xs text-muted-foreground">{item.sub}</div>
            {isCurrentStock ? (
              <div className={`mt-2 border-t pt-1.5 text-xs font-medium ${
                backorder < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
              }`}>
                {pick(language, "백오더", "Backorder")}: {formatNumber(backorder)}
              </div>
            ) : isInvLife && showCurrentOnly ? (
              <div className={`mt-2 border-t pt-1.5 text-xs font-medium ${
                (stockOnlyDays ?? 999) < 30
                  ? "text-red-600 dark:text-red-400"
                  : currentOnlyUrgent
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              }`}>
                {currentOnlyUrgent ? "⚠ " : ""}
                {pick(language, "현재 재고만", "Stock only")}: {formatNumber(stockOnlyDays!, 1)}d ({currentOnlySod})
              </div>
            ) : isInvLife ? (
              <div className="mt-2 border-t pt-1.5 text-xs text-transparent select-none">-</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}
