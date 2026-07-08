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
  { status: "received", ko: "수신", en: "Received" },
  { status: "price_review", ko: "가격 검수", en: "Price Review" },
  { status: "discrepancy_found", ko: "오류 발견", en: "Discrepancy Found" },
  { status: "factory_confirmation", ko: "공장 확인", en: "Factory Confirmation" },
  { status: "approved", ko: "승인", en: "Approved" },
  { status: "signed", ko: "서명", en: "Signed" },
  { status: "sent_to_factory", ko: "공장 전달", en: "Sent to Factory" },
];

const STEP_INDEX: Record<InvoiceStatus, number> = Object.fromEntries(
  STEPS.map((step, index) => [step.status, index]),
) as Record<InvoiceStatus, number>;

export function InvoiceStepper({ status }: { status: InvoiceStatus }) {
  const { pick } = useI18n();
  const currentIndex = STEP_INDEX[status];

  return (
    <div className="flex w-full items-start">
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <div key={step.status} className="flex flex-1 flex-col items-center last:flex-none">
            <div className="flex w-full items-center">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors ${
                  isDone
                    ? "border-[#22a666] bg-[#22a666] text-white"
                    : isCurrent
                      ? "border-[#1a5cdb] bg-[#1a5cdb] text-white"
                      : "border-[#d8d6ce] bg-white text-[#9b9189]"
                }`}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              {index < STEPS.length - 1 ? (
                <div className={`h-[2px] flex-1 ${isDone ? "bg-[#22a666]" : "bg-[#d8d6ce]"}`} />
              ) : null}
            </div>
            <span
              className={`mt-1.5 max-w-[88px] text-center text-[10.5px] font-medium leading-tight ${
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
