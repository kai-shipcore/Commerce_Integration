/**
 * Code Guide:
 * GET /api/forecast/demand-trend — Proxies the FastAPI /demand-trend endpoint.
 * Returns weekly actual demand totals, what stored runs predicted for those
 * weeks (per lead time), and the latest run's forward horizon with PI band.
 */

import { NextResponse } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productType = searchParams.get("product_type") ?? "All";

  try {
    const upstream = await fetch(
      `${FORECAST_API}/demand-trend?product_type=${encodeURIComponent(productType)}`,
      { signal: AbortSignal.timeout(30_000), headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" } },
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
