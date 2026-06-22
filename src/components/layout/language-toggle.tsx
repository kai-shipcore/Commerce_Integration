"use client";

import { useI18n } from "@/lib/i18n/i18n-provider";
import type { AppLocale } from "@/lib/i18n/messages";

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className="flex h-8 items-center overflow-hidden rounded-md border border-slate-300/80 bg-white/45 text-xs font-semibold dark:border-slate-500 dark:bg-slate-900/30"
      role="group"
      aria-label={t("language.label")}
    >
      {(["ko", "en"] as AppLocale[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={locale === option}
          title={option === "ko" ? "한국어" : "English"}
          onClick={() => setLocale(option)}
          className={`h-full px-2 transition-colors ${
            locale === option
              ? "bg-sky-700 text-white dark:bg-white dark:text-slate-900"
              : "text-slate-600 hover:bg-white/60 dark:text-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          {option === "ko" ? "KO" : "EN"}
        </button>
      ))}
    </div>
  );
}
