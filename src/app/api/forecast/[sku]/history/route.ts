/**
 * Code Guide:
 * GET /api/forecast/[sku]/history — Proxies the FastAPI /history/{sku} endpoint.
 * Weekly sales history only, for SKUs without a forecast (intermittent).
 */

import { NextResponse, type NextRequest } from "next/server";

function forecastApiBase() {
  return (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;

  try {
    const upstream = await fetch(
      `${forecastApiBase()}/history/${encodeURIComponent(sku)}`,
      { signal: AbortSignal.timeout(10_000) },
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
