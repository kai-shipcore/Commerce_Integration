import { NextResponse } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ segment: string }> },
) {
  await params;
  const jobId = new URL(request.url).searchParams.get("job_id") ?? "";
  if (!jobId) return NextResponse.json({ error: "job_id is required" }, { status: 400 });

  try {
    const upstream = await fetch(
      `${FORECAST_API}/segment-simulate-result/${jobId}`,
      { signal: AbortSignal.timeout(10_000), headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" } },
    );
    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.detail ?? "Failed to fetch result" }, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
