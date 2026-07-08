/**
 * Code Guide:
 * GET /api/forecast/accuracy-history — Proxies the FastAPI /accuracy-history endpoint.
 * Returns pooled WAPE per stored forecast run, evaluated over the first K completed
 * weeks of each run's horizon, for every available K at once.
 */

import { NextResponse } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productType = searchParams.get("product_type") ?? "All";

  try {
    const upstream = await fetch(
      `${FORECAST_API}/accuracy-history?product_type=${encodeURIComponent(productType)}`,
      { signal: AbortSignal.timeout(30_000) },
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
