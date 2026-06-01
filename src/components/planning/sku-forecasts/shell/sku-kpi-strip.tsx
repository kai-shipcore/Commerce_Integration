import type { DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber, type SkuMasterMeta } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

export function SkuKpiStrip({ sku, master, language }: { sku: DemandRow; master: SkuMasterMeta; language: SkuForecastLanguage }) {
  const days = daysUntil(sku.sod);
  const inbound = sku.total_inbound_qty ?? 0;
  const projected = sku.total_stock + inbound + Math.min(sku.back, 0);
  const items = [
    { label: pick(language, "현재 재고", "Current Stock"), value: formatNumber(sku.total_stock), sub: `West ${formatNumber(sku.west_stock)} / East ${formatNumber(sku.east_stock)}` },
    { label: pick(language, "일평균 판매", "Daily Average"), value: formatNumber(sku.total_avg_curr, 2), sub: `30D ${formatNumber(sku.total_30d)} ${pick(language, "개", "units")}` },
    { label: pick(language, "재고 유지일", "Inv. Life"), value: days === null ? "-" : `${days}d`, sub: pick(language, "예상 SOD 기준", "Based on projected SOD") },
    { label: pick(language, "입고", "Inbound"), value: formatNumber(inbound), sub: sku.next_eta ? `${pick(language, "다음 ETA", "Next ETA")} ${sku.next_eta}` : pick(language, "활성 입고 없음", "No active inbound") },
    { label: pick(language, "예상 재고", "Projected"), value: formatNumber(projected), sub: `CBM/${pick(language, "개", "unit")} ${formatNumber(master.cbmPerUnit, 4)}` },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="planning-panel rounded-lg border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold">{item.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}
