import { NextResponse } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ segment: string; jobId: string }> },
) {
  const { jobId } = await params;

  try {
    const upstream = await fetch(`${FORECAST_API}/cancel-simulation/${jobId}`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" },
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.detail ?? "Cancel failed" }, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
