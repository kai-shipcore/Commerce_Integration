"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiPath } from "@/lib/api-path";
import { messages, type AppLocale, type MessageKey } from "./messages";

const LOCALE_PREFERENCE_KEY = "app.locale";
const LOCALE_STORAGE_KEY = "demandpilot-locale";

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey) => string;
  pick: (ko: string, en: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: unknown): value is AppLocale {
  return value === "ko" || value === "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("en");

  const applyLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
      ?? window.localStorage.getItem("sku-forecasts-language");
    if (isLocale(storedLocale)) {
      queueMicrotask(() => {
        if (!cancelled) applyLocale(storedLocale);
      });
    }

    fetch(apiPath("/api/user/preferences"), { cache: "no-store" })
      .then((response) => response.json() as Promise<{ success?: boolean; data?: Record<string, unknown> }>)
      .then((result) => {
        const savedLocale = result.data?.[LOCALE_PREFERENCE_KEY];
        if (!cancelled && isLocale(savedLocale)) applyLocale(savedLocale);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) document.documentElement.lang = document.documentElement.lang || "en";
      });

    return () => {
      cancelled = true;
    };
  }, [applyLocale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    applyLocale(nextLocale);
    void fetch(apiPath("/api/user/preferences"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: { [LOCALE_PREFERENCE_KEY]: nextLocale } }),
    }).catch(() => {});
  }, [applyLocale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => messages[locale][key],
    pick: (ko, en) => locale === "ko" ? ko : en,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
