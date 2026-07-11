import { NextResponse } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ segment: string }> },
) {
  const { segment } = await params;
  const { searchParams } = new URL(request.url);
  const cutoff      = searchParams.get("cutoff") ?? "";
  const horizon     = searchParams.get("horizon") ?? "13";
  const model       = searchParams.get("model") ?? "Auto";
  const productType = searchParams.get("product_type") ?? "All";

  if (!cutoff) {
    return NextResponse.json({ error: "cutoff is required" }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${FORECAST_API}/segment-simulate-job/${encodeURIComponent(segment)}?cutoff=${encodeURIComponent(cutoff)}&horizon=${horizon}&model=${encodeURIComponent(model)}&product_type=${encodeURIComponent(productType)}`,
      { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" } },
    );
    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.detail ?? "Failed to start simulation" }, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
