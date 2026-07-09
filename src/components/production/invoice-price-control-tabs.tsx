"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, ReceiptText } from "lucide-react";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { PriceHistoryPage } from "@/components/production/price-history-page";
import { InvoiceReviewPage } from "@/components/production/invoice-review-page";

type Tab = "invoice-review" | "price-history";

export function InvoicePriceControlTabs() {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (searchParams.get("tab") === "price-history" ? "price-history" : "invoice-review"));
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
  const initialSku = searchParams.get("sku") ?? undefined;
  const initialCurrentOnly = searchParams.get("currentOnly") === "false" ? false : undefined;
  const canCreateInvoice = ready && can("invoice-price-control", "create");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "invoice-review", label: pick("Invoice 검수", "Invoice Review") },
    { id: "price-history", label: "Price History" },
  ];

  return (
    <section className="relative left-1/2 flex h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] min-h-0 -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4">
        <div className="flex items-start gap-2">
          <ReceiptText className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("Invoice·가격 검수", "Invoice & Price Control")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {pick(
                "Invoice 검수와 공장별 Price List 이력을 관리합니다.",
                "Manage invoice review and factory price list history."
              )}
            </p>
          </div>
        </div>
        {tab === "invoice-review" ? (
          <button
            type="button"
            disabled={!canCreateInvoice}
            onClick={() => setInvoiceCreateOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#174fbf] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {pick("Invoice 추가", "Add Invoice")}
          </button>
        ) : null}
      </header>

      <div className="flex border-b border-[#e2dfd8] bg-white px-5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-5 py-3 text-[12px] font-semibold transition-colors ${
              tab === item.id
                ? "border-[#1a5cdb] text-[#1a5cdb]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "invoice-review" ? (
          <InvoiceReviewPage createFormOpen={invoiceCreateOpen} onCreateFormOpenChange={setInvoiceCreateOpen} />
        ) : (
          <PriceHistoryPage initialSku={initialSku} initialCurrentOnly={initialCurrentOnly} />
        )}
      </div>
    </section>
  );
}
