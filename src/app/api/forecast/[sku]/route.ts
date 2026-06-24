import { NextResponse, type NextRequest } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const search = req.nextUrl.searchParams.toString();

  try {
    const upstream = await fetch(
      `${FORECAST_API}/forecast/${encodeURIComponent(sku)}${search ? `?${search}` : ""}`,
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
