import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { PlanningStatsRefreshService } from "@/lib/planning-stats-refresh/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const denied = await guardPermission("demand-planning", "read");
  if (denied) return denied;

  const { jobId } = await params;
  const job = await PlanningStatsRefreshService.getJob(jobId).catch(() => null);
  if (!job) {
    return NextResponse.json({ success: false, error: "Refresh job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
    },
  });
}
