/**
 * Code Guide:
 * POST /api/planning/demand-trend — Proxies the FastAPI /planning/demand-trend endpoint.
 *
 * Weekly actuals and forward forecast summed across a set of SKUs, for the
 * portfolio chart on the action list.
 *
 * POST rather than GET because the body carries the SKU list the page's filters
 * produced, which runs to hundreds of identifiers and past what a query string
 * carries reliably. The shared proxy helper is GET-only, so this route forwards
 * the body itself while keeping the same base URL, token header and error shape.
 */

import { NextResponse, type NextRequest } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${FORECAST_API}/planning/demand-trend`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "",
      },
      signal: AbortSignal.timeout(30_000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Forecast server error (${upstream.status})`, detail: text },
        { status: upstream.status },
      );
    }
    return NextResponse.json(JSON.parse(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach forecast server", detail: message },
      { status: 503 },
    );
  }
}
