import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, getUrgency, type SkuMasterMeta } from "../types";
import { pick, type SkuForecastLanguage } from "../language";

export function SkuHeader({
  sku,
  master,
  productLabel,
  language,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
  productLabel: string;
  language: SkuForecastLanguage;
}) {
  const urgency = getUrgency(sku);
  const salesStatus = language === "ko"
    ? { Original: "일반", Custom: "커스텀", Hold: "보류" }[sku.sales_status]
    : sku.sales_status;
  const urgencyClass =
    urgency === "critical"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
      : urgency === "watch"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";

  return (
    <header className="planning-panel rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all font-mono text-xl font-semibold">{sku.sku}</h2>
          {master.productName ? (
            <div className="mt-1 text-sm text-muted-foreground">{master.productName}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className="rounded-full border border-[#a0c0f0] bg-[#ebf0fd] px-3 py-1 text-xs font-medium text-[#1a4db0] dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {productLabel}
          </span>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            {salesStatus}
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${urgencyClass}`}>
            {urgency === "critical"
              ? pick(language, "긴급", "Critical")
              : urgency === "watch"
                ? pick(language, "주의", "Watch")
                : pick(language, "정상", "Healthy")}
          </span>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
        <div>MOQ <span className="font-mono font-semibold text-foreground">{formatNumber(master.moq)}</span></div>
        <div>{pick(language, "케이스", "Case")} <span className="font-mono font-semibold text-foreground">{formatNumber(master.caseQty)}</span></div>
        <div>CBM <span className="font-mono font-semibold text-foreground">{formatNumber(master.cbmPerUnit, 4)}</span></div>
        <div>{pick(language, "다음 ETA", "Next ETA")} <span className="font-mono font-semibold text-foreground">{sku.next_eta ?? "-"}</span></div>
      </div>
    </header>
  );
}
