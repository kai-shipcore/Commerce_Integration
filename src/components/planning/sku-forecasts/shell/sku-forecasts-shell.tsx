"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { useDemandPlanningData } from "@/features/planning/demand-planning-data";
import type { DemandRow } from "@/types/demand-planning";
import { InventoryInboundTab } from "../inventory-inbound/inventory-inbound-tab";
import { PurchaseRecommendationTab } from "../purchase-recommendation/purchase-recommendation-tab";
import { SalesAnalysisTab } from "../sales-analysis/sales-analysis-tab";
import { SkuBrowserPanel } from "./sku-browser-panel";
import { SkuForecastTabs } from "./sku-forecast-tabs";
import { SkuHeader } from "./sku-header";
import { SkuKpiStrip } from "./sku-kpi-strip";
import {
  DEFAULT_TARGET_INVENTORY_DAYS,
  defaultMasterMeta,
  forecastProductKeyForRow,
  hasRecentSales,
  productKeyForRow,
  type ProductKey,
  type SkuMasterMeta,
} from "../types";
import { pick, productLabel, type SkuForecastLanguage } from "../language";
import { apiPath } from "@/lib/api-path";

const LANGUAGE_STORAGE_KEY = "sku-forecasts-language";
const TARGET_INVENTORY_DAYS_STORAGE_KEY = "sku-forecasts-target-inventory-days";
const INCLUDE_DRAFT_CONTAINERS_STORAGE_KEY = "sku-forecasts-include-draft-containers";
const SALES_ONLY_STORAGE_KEY = "sku-forecasts-sales-only";
const MIN_TARGET_INVENTORY_DAYS = 1;
const MAX_TARGET_INVENTORY_DAYS = 365;

type SkuMasterResponse = {
  success: boolean;
  data?: SkuMasterMeta;
  error?: string;
};

export function SkuForecastsShell() {
  const [product, setProduct] = useState<ProductKey>("fm");
  const [search, setSearch] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState<string>("");
  const [language, setLanguage] = useState<SkuForecastLanguage>("en");
  const [targetInventoryDays, setTargetInventoryDays] = useState(DEFAULT_TARGET_INVENTORY_DAYS);
  const [includeDraftContainers, setIncludeDraftContainers] = useState(false);
  const [salesOnly, setSalesOnly] = useState(true);
  const [masterBySku, setMasterBySku] = useState<Record<string, SkuMasterMeta>>({});
  const [loadedCounts, setLoadedCounts] = useState<Record<ProductKey, number | null>>({ sc: null, cc: null, fm: null });
  const masterLoadingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "ko" || stored === "en") {
      queueMicrotask(() => setLanguage(stored));
    }
    const storedTargetDays = normalizeTargetInventoryDays(window.localStorage.getItem(TARGET_INVENTORY_DAYS_STORAGE_KEY));
    if (storedTargetDays !== null) {
      queueMicrotask(() => setTargetInventoryDays(storedTargetDays));
    }
    if (window.localStorage.getItem(INCLUDE_DRAFT_CONTAINERS_STORAGE_KEY) === "1") {
      queueMicrotask(() => setIncludeDraftContainers(true));
    }
    if (window.localStorage.getItem(SALES_ONLY_STORAGE_KEY) === "0") {
      queueMicrotask(() => setSalesOnly(false));
    }
  }, []);

  function changeLanguage(nextLanguage: SkuForecastLanguage) {
    setLanguage(nextLanguage);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }

  function changeTargetInventoryDays(nextValue: string) {
    const nextDays = normalizeTargetInventoryDays(nextValue) ?? DEFAULT_TARGET_INVENTORY_DAYS;
    setTargetInventoryDays(nextDays);
    window.localStorage.setItem(TARGET_INVENTORY_DAYS_STORAGE_KEY, String(nextDays));
  }

  function changeIncludeDraftContainers(nextValue: boolean) {
    setIncludeDraftContainers(nextValue);
    window.localStorage.setItem(INCLUDE_DRAFT_CONTAINERS_STORAGE_KEY, nextValue ? "1" : "0");
  }

  function changeSalesOnly(nextValue: boolean) {
    setSalesOnly(nextValue);
    window.localStorage.setItem(SALES_ONLY_STORAGE_KEY, nextValue ? "1" : "0");
  }

  const {
    data,
    loading,
    error,
    reload,
  } = useDemandPlanningData("link", undefined, includeDraftContainers, product);

  const rowsByProduct = useMemo(() => {
    const grouped: Record<ProductKey, DemandRow[]> = { sc: [], cc: [], fm: [] };
    for (const row of data.rows) {
      if (salesOnly && !hasRecentSales(row)) continue;
      const productKey = forecastProductKeyForRow(row);
      if (!productKey) continue;
      grouped[productKey].push(row);
    }
    for (const key of Object.keys(grouped) as ProductKey[]) {
      grouped[key].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    }
    return grouped;
  }, [data.rows, salesOnly]);

  useEffect(() => {
    if (loading) return;
    const count = rowsByProduct[product].length;
    queueMicrotask(() => {
      setLoadedCounts((current) => (
        current[product] === count ? current : { ...current, [product]: count }
      ));
    });
  }, [loading, product, rowsByProduct]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rowsByProduct[product];
    return rowsByProduct[product].filter((row) =>
      row.sku.toLowerCase().includes(q) ||
      (row.containers_list ?? "").toLowerCase().includes(q) ||
      row.sales_status.toLowerCase().includes(q)
    );
  }, [product, rowsByProduct, search]);

  const selectedRow = useMemo(
    () => {
      const visibleSelected = visibleRows.find((row) => row.sku === selectedSkuId);
      return visibleSelected ?? visibleRows[0] ?? null;
    },
    [selectedSkuId, visibleRows],
  );

  useEffect(() => {
    if (!selectedRow || masterBySku[selectedRow.sku] || masterLoadingRef.current.has(selectedRow.sku)) return;
    const sku = selectedRow.sku;
    masterLoadingRef.current.add(sku);
    fetch(apiPath(`/api/planning/sku-master?masterSku=${encodeURIComponent(sku)}`))
      .then((res) => res.json() as Promise<SkuMasterResponse>)
      .then((json) => {
        if (json.success && json.data) {
          setMasterBySku((current) => ({ ...current, [sku]: json.data as SkuMasterMeta }));
        }
      })
      .catch(() => {
        setMasterBySku((current) => ({ ...current, [sku]: defaultMasterMeta(selectedRow) }));
      })
      .finally(() => {
        masterLoadingRef.current.delete(sku);
      });
  }, [masterBySku, selectedRow]);

  const selectedMaster = selectedRow
    ? masterBySku[selectedRow.sku] ?? defaultMasterMeta(selectedRow)
    : null;

  if (loading && data.rows.length === 0) {
    return (
      <div className="flex h-[calc(100vh-9rem)] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {pick(language, "SKU ê³„íš ë°ì´í„°ë¥¼ ë¶ˆëŸ¬ì˜¤ëŠ” ì¤‘...", "Loading SKU planning data...")}
      </div>
    );
  }

  return (
    <section className="flex h-[calc(100vh-7.5rem)] min-h-[680px] flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <TrendingUp className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-xl font-semibold">{pick(language, "SKU ê³„íš", "SKU Planning")}</h1>
            <div className="mt-1 text-xs text-muted-foreground">
              {data.last_sync
                ? `${pick(language, "ë™ê¸°í™”", "Synced")} ${data.last_sync.slice(0, 16).replace("T", " ")}`
                : pick(language, "ë™ê¸°í™”ë˜ì§€ ì•ŠìŒ", "Not synced")}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex h-9 overflow-hidden rounded-md border bg-white dark:border-zinc-600 dark:bg-zinc-800">
            {[
              { value: true, label: pick(language, "Sales ìžˆëŠ” SKU", "Sales SKUs") },
              { value: false, label: pick(language, "ì „ì²´ SKU", "All SKUs") },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => changeSalesOnly(option.value)}
                className={`px-3 text-xs font-semibold ${
                  salesOnly === option.value
                    ? "bg-[#1A1917] text-white dark:bg-white dark:text-[#1A1917]"
                    : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex h-9 overflow-hidden rounded-md border bg-white dark:border-zinc-600 dark:bg-zinc-800">
            {[
              { value: false, label: pick(language, "Active ì»¨í…Œì´ë„ˆ", "Active Containers") },
              { value: true, label: pick(language, "Draft í¬í•¨", "Active + Draft") },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => changeIncludeDraftContainers(option.value)}
                className={`px-3 text-xs font-semibold ${
                  includeDraftContainers === option.value
                    ? "bg-[#1A1917] text-white dark:bg-white dark:text-[#1A1917]"
                    : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-xs font-semibold text-[#1A1917] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
            <span className="whitespace-nowrap">{pick(language, "ëª©í‘œ ìž¬ê³ ì¼", "Target days")}</span>
            <input
              type="number"
              min={MIN_TARGET_INVENTORY_DAYS}
              max={MAX_TARGET_INVENTORY_DAYS}
              value={targetInventoryDays}
              onChange={(event) => changeTargetInventoryDays(event.target.value)}
              className="h-7 w-14 rounded border bg-background px-2 text-right font-mono text-xs outline-none focus:border-[#1a5cdb] dark:border-zinc-600"
            />
          </label>
          <div className="flex h-9 overflow-hidden rounded-md border bg-white dark:border-zinc-600 dark:bg-zinc-800">
            {(["ko", "en"] as SkuForecastLanguage[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => changeLanguage(option)}
                className={`px-3 text-xs font-semibold ${
                  language === option
                    ? "bg-[#1A1917] text-white dark:bg-white dark:text-[#1A1917]"
                    : "text-muted-foreground hover:bg-[#f0eee9] dark:hover:bg-zinc-700"
                }`}
              >
                {option === "ko" ? "í•œ" : "EN"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm font-semibold text-[#1A1917] disabled:cursor-default disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {pick(language, "ë™ê¸°í™”", "Sync")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[580px_minmax(0,1fr)]">
        <SkuBrowserPanel
          product={product}
          productCounts={{ ...loadedCounts, [product]: rowsByProduct[product].length }}
          onProductChange={(nextProduct) => {
            setProduct(nextProduct);
            setSearch("");
          }}
          search={search}
          onSearchChange={setSearch}
          rows={visibleRows}
          selectedSkuId={selectedRow?.sku ?? ""}
          onSelectSku={setSelectedSkuId}
          language={language}
          targetInventoryDays={targetInventoryDays}
        />

        <div className="min-w-0 overflow-y-auto pr-1">
          {selectedRow && selectedMaster ? (
            <div className="space-y-3">
              <SkuHeader sku={selectedRow} master={selectedMaster} productLabel={productLabel(language, productKeyForRow(selectedRow))} language={language} />
              <SkuKpiStrip sku={selectedRow} master={selectedMaster} language={language} includeDraftContainers={includeDraftContainers} />
              <SkuForecastTabs
                language={language}
                sales={<SalesAnalysisTab sku={selectedRow} language={language} />}
                inventory={<InventoryInboundTab sku={selectedRow} language={language} targetInventoryDays={targetInventoryDays} includeDraftContainers={includeDraftContainers} />}
                purchase={<PurchaseRecommendationTab sku={selectedRow} master={selectedMaster} language={language} targetInventoryDays={targetInventoryDays} includeDraftContainers={includeDraftContainers} />}
              />
            </div>
          ) : (
            <div className="planning-panel flex h-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {pick(language, "SKUë¥¼ ì„ íƒí•˜ì„¸ìš”", "Select a SKU")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function normalizeTargetInventoryDays(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(MIN_TARGET_INVENTORY_DAYS, Math.min(MAX_TARGET_INVENTORY_DAYS, Math.floor(parsed)));
}
