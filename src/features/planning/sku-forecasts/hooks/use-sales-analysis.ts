import { useEffect, useState } from "react";
import { apiPath } from "@/lib/api-path";

export type SalesHistoryBucket = "day" | "week" | "month";

export type SalesHistoryPoint = {
  date: string;
  west: number;
  east: number;
  total: number;
};

export type SalesHistoryData = {
  sku: string;
  category: "SC" | "CC" | "FM";
  bucket: SalesHistoryBucket;
  from: string;
  to: string;
  points: SalesHistoryPoint[];
  totals: {
    west: number;
    east: number;
    total: number;
  };
};

type UseSalesAnalysisParams = {
  enabled: boolean;
  sku: string;
  category?: "SC" | "CC" | "FM";
  from: string;
  to: string;
  bucket: SalesHistoryBucket;
};

export function useSalesAnalysis({ enabled, sku, category, from, to, bucket }: UseSalesAnalysisParams) {
  const [data, setData] = useState<SalesHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !sku || !from || !to) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      sku,
      from,
      to,
      bucket,
    });
    if (category) params.set("category", category);

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });

    fetch(apiPath(`/api/planning/sku-forecasts/sales-history?${params.toString()}`), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ success: boolean; data?: SalesHistoryData; error?: string }>;
      })
      .then((json) => {
        if (!json.success || !json.data) throw new Error(json.error ?? "Failed to load sales history");
        setData(json.data);
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load sales history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [bucket, category, enabled, from, sku, to]);

  return { data, loading, error };
}
