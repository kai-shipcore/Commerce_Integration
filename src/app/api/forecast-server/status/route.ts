import { NextResponse } from "next/server";
import { isRunning } from "@/lib/forecast-server";

export async function GET() {
  const running = await isRunning();
  return NextResponse.json({ running });
}
