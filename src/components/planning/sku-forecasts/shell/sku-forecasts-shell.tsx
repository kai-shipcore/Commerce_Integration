"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
  defaultMasterMeta,
  productKeyForRow,
  productLabels,
  type ProductKey,
  type SkuMasterMeta,
} from "../types";

type SkuMasterResponse = {
  success: boolean;
  data?: SkuMasterMeta;
  error?: string;
};

export function SkuForecastsShell() {
  const [product, setProduct] = useState<ProductKey>("sc");
  const [search, setSearch] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState<string>("");
  const [masterBySku, setMasterBySku] = useState<Record<string, SkuMasterMeta>>({});
  const masterLoadingRef = useRef<Set<string>>(new Set());
  const containerAutoLoadKeyRef = useRef<string | null>(null);

  const {
    data,
    loading,
    containerDetailsLoading,
    containerDetailsLoaded,
    error,
    reload,
    loadContainerDetails,
  } = useDemandPlanningData("link");

  useEffect(() => {
    if (!data.rows.length || containerDetailsLoaded || containerDetailsLoading) return;
    const loadKey = `${data.last_sync ?? ""}|${data.rows.length}`;
    if (containerAutoLoadKeyRef.current === loadKey) return;
    containerAutoLoadKeyRef.current = loadKey;
    loadContainerDetails();
  }, [
    containerDetailsLoaded,
    containerDetailsLoading,
    data.last_sync,
    data.rows.length,
    loadContainerDetails,
  ]);

  const rowsByProduct = useMemo(() => {
    const grouped: Record<ProductKey, DemandRow[]> = { sc: [], cc: [], fm: [] };
    for (const row of data.rows) {
      grouped[productKeyForRow(row)].push(row);
    }
    for (const key of Object.keys(grouped) as ProductKey[]) {
      grouped[key].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    }
    return grouped;
  }, [data.rows]);

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
      return visibleSelected ?? visibleRows[0] ?? data.rows.find((row) => row.sku === selectedSkuId) ?? null;
    },
    [data.rows, selectedSkuId, visibleRows],
  );

  useEffect(() => {
    if (!selectedRow || masterBySku[selectedRow.sku] || masterLoadingRef.current.has(selectedRow.sku)) return;
    const sku = selectedRow.sku;
    masterLoadingRef.current.add(sku);
    fetch(`/api/planning/sku-master?masterSku=${encodeURIComponent(sku)}`)
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

  const containerStatus = containerDetailsLoading
    ? "Loading containers..."
    : containerDetailsLoaded
      ? "Containers ready"
      : "Containers pending";

  if (loading && data.rows.length === 0) {
    return (
      <div className="flex h-[calc(100vh-9rem)] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading SKU planning data...
      </div>
    );
  }

  return (
    <section className="flex h-[calc(100vh-7.5rem)] min-h-[680px] flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SKU Planning</h1>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.last_sync ? `Synced ${data.last_sync.slice(0, 16).replace("T", " ")}` : "Not synced"}
            <span className="mx-2">|</span>
            {containerStatus}
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm font-semibold text-[#1A1917] disabled:cursor-default disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Sync
        </button>
      </div>

      {error ? (
        <div className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[580px_minmax(0,1fr)]">
        <SkuBrowserPanel
          product={product}
          productCounts={{
            sc: rowsByProduct.sc.length,
            cc: rowsByProduct.cc.length,
            fm: rowsByProduct.fm.length,
          }}
          onProductChange={(nextProduct) => {
            setProduct(nextProduct);
            setSearch("");
          }}
          search={search}
          onSearchChange={setSearch}
          rows={visibleRows}
          selectedSkuId={selectedRow?.sku ?? ""}
          onSelectSku={setSelectedSkuId}
        />

        <div className="min-w-0 overflow-y-auto pr-1">
          {selectedRow && selectedMaster ? (
            <div className="space-y-3">
              <SkuHeader sku={selectedRow} master={selectedMaster} productLabel={productLabels[productKeyForRow(selectedRow)]} />
              <SkuKpiStrip sku={selectedRow} master={selectedMaster} />
              <SkuForecastTabs
                sales={<SalesAnalysisTab sku={selectedRow} />}
                inventory={
                  <InventoryInboundTab
                    sku={selectedRow}
                    containers={data.containers}
                    containerDetailsLoading={containerDetailsLoading}
                    containerDetailsLoaded={containerDetailsLoaded}
                  />
                }
                purchase={<PurchaseRecommendationTab sku={selectedRow} master={selectedMaster} />}
              />
            </div>
          ) : (
            <div className="planning-panel flex h-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
              Select a SKU
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
