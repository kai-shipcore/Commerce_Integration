"use client";

/**
 * Code Guide:
 * SKU management component.
 * This file supports SKU listing, editing, bulk actions, or master-SKU workflows in the catalog screens.
 */
import { useState, useEffect, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Database, CheckCircle2, XCircle } from "lucide-react";

interface BackfillStats {
  skus: {
    withoutMasterSku: number;
    withMasterSku: number;
    total: number;
  };
  salesRecords: {
    withoutMasterSku: number;
    withMasterSku: number;
    total: number;
  };
}

interface BackfillResult {
  skusUpdated: number;
  skusWithMasterSku: number;
  salesRecordsUpdated: number;
  errors: string[];
}

export function MasterSkuBackfillBanner() {
  const [stats, setStats] = useState<BackfillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const hasTriggered = useRef(false);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/skus/backfill-master");
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        return data.stats;
      }
    } catch (err) {
      console.error("Failed to fetch backfill stats:", err);
    } finally {
      setLoading(false);
    }
    return null;
  };

  const runBackfill = async () => {
    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/skus/backfill-master", {
        method: "POST",
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.results);
        setComplete(true);
        // Auto-hide after 5 seconds
        setTimeout(() => setComplete(false), 5000);
      } else {
        setError(data.error || "Backfill failed");
      }
    } catch (err: any) {
      setError(err.message || "Backfill failed");
    } finally {
      setRunning(false);
    }
  };

  // Check stats and auto-trigger backfill if needed
  useEffect(() => {
    const checkAndRun = async () => {
      const currentStats = await fetchStats();

      // Auto-trigger backfill if there are records needing it (only once per mount)
      if (
        currentStats &&
        !hasTriggered.current &&
        (currentStats.skus.withoutMasterSku > 0 || currentStats.salesRecords.withoutMasterSku > 0)
      ) {
        hasTriggered.current = true;
        runBackfill();
      }
    };

    checkAndRun();
  }, []);

  // Don't show if loading or nothing happening
  if (loading && !running) return null;

  // Show success message briefly
  if (complete && result) {
    return (
      <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription>
          <span className="text-green-800 dark:text-green-200">
            Master SKU mapping complete! Mapped {result.skusWithMasterSku} SKUs and {result.salesRecordsUpdated} sales records.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  // Show error
  if (error) {
    const isSchemaError = error.includes("schema") || error.includes("size_chart_dev");
    return (
      <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
        <XCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription>
          <span className="text-amber-800 dark:text-amber-200">
            {isSchemaError
              ? "Master SKU lookup not available. The database function is in a different schema."
              : `Master SKU backfill failed: ${error}`}
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  // Show running state
  if (running) {
    const skuCount = stats?.skus.withoutMasterSku || 0;
    const salesCount = stats?.salesRecords.withoutMasterSku || 0;

    return (
      <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
        <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
        <AlertDescription>
          <span className="text-blue-800 dark:text-blue-200">
            Mapping master SKUs... ({skuCount.toLocaleString()} SKUs, {salesCount.toLocaleString()} sales records)
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
