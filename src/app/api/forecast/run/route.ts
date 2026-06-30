import { NextResponse } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const horizon = searchParams.get("horizon") ?? "13";

  try {
    const upstream = await fetch(`${FORECAST_API}/run-forecast?horizon=${horizon}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
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
