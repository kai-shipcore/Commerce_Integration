/**
 * Code Guide:
 * Health of the forecast service, for the status indicator on planning pages.
 *
 * Returns `running` for the existing callers plus readiness detail, because a
 * server that is up with no data is the failure that actually happens and a
 * liveness bit cannot describe it.
 */

import { NextResponse } from "next/server";
import { forecastHealth } from "@/lib/forecast-server";

export async function GET() {
  const health = await forecastHealth();
  // `running` stays top-level and unchanged: run-forecast.tsx reads it.
  return NextResponse.json(health);
}
