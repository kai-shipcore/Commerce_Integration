"use client";

import { useState } from "react";
import { RunForecast } from "./run-forecast";
import { SegmentationOverview } from "./segmentation-overview";
import { ForecastPerformance } from "./forecast-performance";

interface LastRun {
  run_date: string | null;
  horizon_weeks: number | null;
}

export function DemandForecastContent({ initialLastRun }: { initialLastRun: LastRun | null }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <RunForecast initialLastRun={initialLastRun} onDone={() => setRefreshKey((k) => k + 1)} />
      <SegmentationOverview refreshKey={refreshKey} />
      <ForecastPerformance refreshKey={refreshKey} />
    </>
  );
}
