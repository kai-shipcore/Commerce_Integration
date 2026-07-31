/**
 * Code Guide:
 * Lightweight home dashboard stats endpoint.
 * Returns per-category KPIs, stock distribution, top critical SKUs,
 * delayed containers, and global stats for the Command Center.
 * Controller layer only: delegates to HomeStatsService.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { HomeStatsService } from "@/lib/home-stats/service";

function getErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bustCache = req.nextUrl.searchParams.get("bust") === "1";
    const { data, cached } = await HomeStatsService.getStats(bustCache);
    return NextResponse.json({ success: true, data, ...(cached ? { cached: true } : {}) });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
