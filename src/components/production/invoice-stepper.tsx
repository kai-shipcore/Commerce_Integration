"use client";

import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";

export type InvoiceStatus =
  | "received"
  | "price_review"
  | "discrepancy_found"
  | "factory_confirmation"
  | "approved"
  | "signed"
  | "sent_to_factory";

const STEPS: Array<{ status: InvoiceStatus; ko: string; en: string }> = [
  { status: "price_review", ko: "미검수", en: "Pending Review" },
  { status: "factory_confirmation", ko: "보류", en: "On Hold" },
  { status: "approved", ko: "검수완료", en: "Reviewed" },
];

const STEP_INDEX: Record<InvoiceStatus, number> = Object.fromEntries(
  STEPS.map((step, index) => [step.status, index]),
) as Partial<Record<InvoiceStatus, number>> as Record<InvoiceStatus, number>;

function normalizeStatus(status: InvoiceStatus): InvoiceStatus {
  if (status === "factory_confirmation") return "factory_confirmation";
  if (status === "approved" || status === "signed" || status === "sent_to_factory") return "approved";
  return "price_review";
}

export function InvoiceStepper({ status, compact = false }: { status: InvoiceStatus; compact?: boolean }) {
  const { pick } = useI18n();
  const currentIndex = STEP_INDEX[normalizeStatus(status)];

  return (
    <div className={`flex w-full items-start ${compact ? "min-w-[260px] max-w-[360px]" : ""}`}>
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <div key={step.status} className="flex flex-1 flex-col items-center last:flex-none">
            <div className="flex w-full items-center">
              <div
                className={`flex shrink-0 items-center justify-center rounded-full border-2 font-bold transition-colors ${
                  compact ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-[11px]"
                } ${
                  isDone
                    ? "border-[#22a666] bg-[#22a666] text-white"
                    : isCurrent
                      ? "border-[#1a5cdb] bg-[#1a5cdb] text-white"
                      : "border-[#d8d6ce] bg-white text-[#9b9189]"
                }`}
              >
                {isDone ? <Check className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} /> : index + 1}
              </div>
              {index < STEPS.length - 1 ? (
                <div className={`h-[2px] flex-1 ${isDone ? "bg-[#22a666]" : "bg-[#d8d6ce]"}`} />
              ) : null}
            </div>
            <span
              className={`mt-1 max-w-[88px] text-center font-medium leading-tight ${
                compact ? "text-[10px]" : "text-[10.5px]"
              } ${
                isCurrent ? "text-[#1a5cdb]" : isDone ? "text-[#22a666]" : "text-[#9b9189]"
              }`}
            >
              {pick(step.ko, step.en)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
