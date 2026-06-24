import { NextResponse } from "next/server";
import { startForecastServer } from "@/lib/forecast-server";

export async function POST() {
  try {
    const result = await startForecastServer();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
