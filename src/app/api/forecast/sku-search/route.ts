import { NextResponse } from "next/server";

const FORECAST_API = "http://localhost:8000";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json([]);

  try {
    const upstream = await fetch(
      `${FORECAST_API}/sku-search?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    const data = await upstream.json();
    if (!upstream.ok) return NextResponse.json([], { status: upstream.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
