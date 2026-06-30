import { NextResponse } from "next/server";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const test = searchParams.get("test") === "true" ? "&test=true" : "";
  try {
    const upstream = await fetch(`${FORECAST_API}/backtest-cycles?_=1${test}`, {
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
