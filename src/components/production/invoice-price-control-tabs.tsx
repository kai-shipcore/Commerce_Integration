"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { PriceHistoryPage } from "@/components/production/price-history-page";
import { InvoiceReviewPage } from "@/components/production/invoice-review-page";

type Tab = "invoice-review" | "price-history";

export function InvoicePriceControlTabs() {
  const { pick } = useI18n();
  const [tab, setTab] = useState<Tab>("invoice-review");

  return (
    <div className="bg-[#f6f7f9]">
      <div className="mx-auto flex max-w-[1600px] items-center gap-1 px-5 pt-4">
        <div className="inline-flex rounded-md border border-[#d8d6ce] bg-[#f0eee9] p-1">
          <button
            type="button"
            onClick={() => setTab("invoice-review")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "invoice-review" ? "bg-white text-[#1a1917] shadow-sm ring-1 ring-inset ring-[#1a5cdb]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {pick("Invoice 검수", "Invoice Review")}
          </button>
          <button
            type="button"
            onClick={() => setTab("price-history")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "price-history" ? "bg-white text-[#1a1917] shadow-sm ring-1 ring-inset ring-[#1a5cdb]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {pick("Price History", "Price History")}
          </button>
        </div>
      </div>
      {tab === "invoice-review" ? <InvoiceReviewPage /> : <PriceHistoryPage />}
    </div>
  );
}
