"use client";

import { offsetContainerDate } from "@/lib/planning/container-schedule-dates";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface ContainerDateValues {
  estLoadingDate: string;
  etdNgbDate: string;
  etaLaxLgbDate: string;
  etaDate: string;
}

export function ContainerDateFieldsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ContainerDateValues;
  onChange: (value: ContainerDateValues) => void;
  disabled?: boolean;
}) {
  const { pick } = useI18n();

  const fields: Array<{
    key: keyof ContainerDateValues;
    ko: string;
    en: string;
    change?: (date: string) => ContainerDateValues;
  }> = [
    { key: "estLoadingDate", ko: "예상 선적일", en: "Est. Loading" },
    {
      key: "etdNgbDate",
      ko: "ETD NGB",
      en: "ETD NGB",
      change: (date) => ({ ...value, etdNgbDate: date, estLoadingDate: date ? offsetContainerDate(date, -7) : "" }),
    },
    {
      key: "etaLaxLgbDate",
      ko: "ETA LAX/LGB",
      en: "ETA LAX/LGB",
      change: (date) => ({ ...value, etaLaxLgbDate: date, etaDate: date ? offsetContainerDate(date, 7) : "" }),
    },
    { key: "etaDate", ko: "창고 입고일 (ETA)", en: "Warehouse (ETA)" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {fields.map((field) => (
        <label key={field.key} className="rounded-lg border border-[#d8d6ce] bg-[#fafaf7] px-3 py-2 focus-within:border-[#1a5cdb] focus-within:ring-1 focus-within:ring-[#1a5cdb]/15">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {pick(field.ko, field.en)}
          </span>
          <input
            type="date"
            value={value[field.key]}
            disabled={disabled}
            onChange={(event) => onChange(field.change
              ? field.change(event.target.value)
              : { ...value, [field.key]: event.target.value })}
            className="mt-1 h-7 w-full bg-transparent font-mono text-[11px] font-semibold text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      ))}
    </div>
  );
}
