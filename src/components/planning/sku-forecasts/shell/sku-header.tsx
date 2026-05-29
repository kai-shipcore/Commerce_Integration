import type { DemandRow } from "@/types/demand-planning";
import { formatNumber, getUrgency, type SkuMasterMeta } from "../types";

export function SkuHeader({
  sku,
  master,
  productLabel,
}: {
  sku: DemandRow;
  master: SkuMasterMeta;
  productLabel: string;
}) {
  const urgency = getUrgency(sku);
  const urgencyClass =
    urgency === "critical"
      ? "border-red-200 bg-red-50 text-red-700"
      : urgency === "watch"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

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
          <span className="rounded-full border border-[#a0c0f0] bg-[#ebf0fd] px-3 py-1 text-xs font-medium text-[#1a4db0]">
            {productLabel}
          </span>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            {sku.sales_status}
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${urgencyClass}`}>
            {urgency === "critical" ? "Critical" : urgency === "watch" ? "Watch" : "Healthy"}
          </span>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
        <div>MOQ <span className="font-mono font-semibold text-foreground">{formatNumber(master.moq)}</span></div>
        <div>Case <span className="font-mono font-semibold text-foreground">{formatNumber(master.caseQty)}</span></div>
        <div>CBM <span className="font-mono font-semibold text-foreground">{formatNumber(master.cbmPerUnit, 4)}</span></div>
        <div>Next ETA <span className="font-mono font-semibold text-foreground">{sku.next_eta ?? "-"}</span></div>
      </div>
    </header>
  );
}
