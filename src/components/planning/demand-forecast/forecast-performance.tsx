"use client";

/**
 * Code Guide:
 * Tabbed card holding the two forecast performance views:
 * - Demand vs forecast (default): actual weekly demand vs predictions on the calendar
 * - Accuracy trend: pooled WAPE per forecast run
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { DemandTrendContent } from "./demand-trend";
import { AccuracyTrendContent } from "./accuracy-trend";

type Tab = "trend" | "accuracy";

export function ForecastPerformance({ refreshKey }: { refreshKey: number }) {
  const { pick } = useI18n();
  const [tab, setTab] = useState<Tab>("trend");

  const tabClass = (t: Tab) =>
    `px-3 py-1 text-xs font-medium transition-colors ${
      tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
    }`;

  return (
    <Card className="gap-2 py-5">
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {tab === "trend"
              ? pick("수요 vs 예측", "Demand vs forecast")
              : pick("예측 정확도 추이", "Forecast accuracy over time")}
          </CardTitle>
          <div className="flex rounded-md border text-xs">
            <button type="button" onClick={() => setTab("trend")} className={`${tabClass("trend")} rounded-l-md`}>
              {pick("수요 vs 예측", "Demand vs forecast")}
            </button>
            <button type="button" onClick={() => setTab("accuracy")} className={`${tabClass("accuracy")} rounded-r-md border-l`}>
              {pick("정확도 추이", "Accuracy trend")}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {tab === "trend"
          ? <DemandTrendContent refreshKey={refreshKey} />
          : <AccuracyTrendContent refreshKey={refreshKey} />}
      </CardContent>
    </Card>
  );
}
