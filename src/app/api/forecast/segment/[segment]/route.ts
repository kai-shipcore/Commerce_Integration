import { NextResponse } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ segment: string }> },
) {
  const { segment } = await params;
  const { searchParams } = new URL(request.url);
  const weeks       = searchParams.get("weeks") ?? "10";
  const productType = searchParams.get("product_type") ?? "All";
  const mode        = searchParams.get("mode") ?? "forward";
  const evalDate    = searchParams.get("eval_date") ?? "";

  const test     = searchParams.get("test") === "true" ? "&test=true" : "";
  const evalParam = evalDate ? `&eval_date=${encodeURIComponent(evalDate)}` : "";

  try {
    const upstream = await fetch(
      `${FORECAST_API}/segment-detail/${encodeURIComponent(segment)}?weeks=${weeks}&product_type=${encodeURIComponent(productType)}&mode=${mode}${evalParam}${test}`,
      { signal: AbortSignal.timeout(15_000) },
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
