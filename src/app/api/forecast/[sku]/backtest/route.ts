/**
 * Code Guide:
 * GET /api/forecast/[sku]/backtest
 * Proxies to the FastAPI /backtest/{sku_id} endpoint.
 * Returns: { predictions, actuals_context, mae, mape, coverage, model_used, bucket,
 *            history_length, training_weeks, completed_weeks }
 * Query params forwarded: cutoff, horizon, history_weeks, model
 */

import { NextResponse, type NextRequest } from "next/server";

function forecastApiBase() {
  return (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

export const dynamic = "force-dynamic";
export const maxDuration = 90; // backtest can take up to ~60s for large SKUs

export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const search = req.nextUrl.searchParams.toString();

  try {
    const upstream = await fetch(
      `${forecastApiBase()}/backtest/${encodeURIComponent(sku)}${search ? `?${search}` : ""}`,
      { signal: AbortSignal.timeout(85_000), headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" } },
    );

    const body = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Forecast server error (${upstream.status})`, detail: body },
        { status: upstream.status },
      );
    }

    return NextResponse.json(JSON.parse(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach forecast server", detail: message },
      { status: 503 },
    );
  }
}
