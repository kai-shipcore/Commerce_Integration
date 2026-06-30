import prisma from "@/lib/db/prisma";
import { SegmentationOverview } from "@/components/planning/demand-forecast/segmentation-overview";
import { RunForecast } from "@/components/planning/demand-forecast/run-forecast";

async function getLastRun(): Promise<{ run_date: string | null; horizon_weeks: number | null }> {
  try {
    const rows = await prisma.$queryRaw<{ run_date: Date | null; horizon_weeks: bigint | null }[]>`
      SELECT run_date, horizon_weeks
      FROM shipcore.fc_forecast_history
      ORDER BY run_date DESC
      LIMIT 1
    `;
    if (!rows.length || !rows[0].run_date) return { run_date: null, horizon_weeks: null };
    return {
      run_date: rows[0].run_date.toISOString(),
      horizon_weeks: rows[0].horizon_weeks ? Number(rows[0].horizon_weeks) : null,
    };
  } catch {
    return { run_date: null, horizon_weeks: null };
  }
}

export default async function DemandForecastPage() {
  const lastRun = await getLastRun();
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Demand Forecast</h1>
        <p className="text-sm text-muted-foreground">
          Segmentation overview across all active SKUs
        </p>
      </div>
      <RunForecast initialLastRun={lastRun} />
      <SegmentationOverview />
    </div>
  );
}
