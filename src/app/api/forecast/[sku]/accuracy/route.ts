/**
 * Code Guide:
 * GET /api/forecast/[sku]/accuracy
 * Returns per-week forecast vs actual for the OLDEST forecast run that has completed weeks,
 * plus aggregate accuracy metrics (MAE, MAPE, PI coverage).
 * Controller layer only: delegates to ForecastMetricsService.
 */

import { NextResponse } from "next/server";
import { ForecastMetricsService } from "@/lib/forecast-metrics/service";

export async function GET(_req: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;

  try {
    const data = await ForecastMetricsService.getAccuracy(sku);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
