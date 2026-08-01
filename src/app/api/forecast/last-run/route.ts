import { NextResponse } from "next/server";
import { ForecastMetricsService } from "@/lib/forecast-metrics/service";

export async function GET() {
  try {
    const data = await ForecastMetricsService.getLastRun();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ run_date: null, horizon_weeks: null, error: String(err) });
  }
}
