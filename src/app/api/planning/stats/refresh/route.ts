// Code Guide: POST /api/planning/stats/refresh — "Sync" button target.
// Creates a durable job record and schedules it on the persistent PM2-hosted
// Node process. The request returns immediately; clients poll
// /refresh/[jobId] for completion.

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { PlanningStatsRefreshService } from "@/lib/planning-stats-refresh/service";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function POST(request: Request) {
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;

  try {
    const requestBody = await request.json().catch(() => null) as { salesWindowWeights?: unknown; oosLostDemandWeights?: unknown } | null;

    const queued = await PlanningStatsRefreshService.queue(requestBody ?? {});

    return NextResponse.json({
      success: true,
      data: {
        jobId: queued.job.id,
        status: queued.job.status,
        reused: !queued.created,
      },
    }, { status: 202 });
  } catch (error) {
    console.error("Planning stats refresh POST failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
