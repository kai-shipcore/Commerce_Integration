import prisma from "@/lib/db/prisma";
import { DemandForecastContent } from "@/components/planning/demand-forecast/demand-forecast-content";
import { SKUGlobalSearch } from "@/components/planning/demand-forecast/sku-global-search";
import { DemandForecastPageHeader } from "@/components/planning/demand-forecast/page-headers";

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
      <div className="flex items-start justify-between gap-4">
        <DemandForecastPageHeader />
        <SKUGlobalSearch />
      </div>
      <DemandForecastContent initialLastRun={lastRun} />
    </div>
  );
}
