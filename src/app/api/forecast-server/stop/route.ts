import { NextResponse } from "next/server";
import { stopForecastServer } from "@/lib/forecast-server";

export async function POST() {
  try {
    stopForecastServer();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
