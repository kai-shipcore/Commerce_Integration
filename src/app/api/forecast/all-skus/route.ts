/**
 * Code Guide:
 * GET /api/forecast/all-skus — Proxies the FastAPI /all-skus endpoint.
 * Cross-segment SKU directory: demand, momentum, segment classification,
 * and the latest run's forward forecast total per SKU.
 */

import { NextResponse } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weeks = searchParams.get("weeks") ?? "10";
  const productType = searchParams.get("product_type") ?? "All";

  try {
    const upstream = await fetch(
      `${FORECAST_API}/all-skus?weeks=${encodeURIComponent(weeks)}&product_type=${encodeURIComponent(productType)}`,
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
