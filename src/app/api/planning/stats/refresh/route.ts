// Code Guide: POST /api/planning/stats/refresh — "Sync" button target.
// Creates a durable job record and schedules it on the persistent PM2-hosted
// Node process. The request returns immediately; clients poll
// /refresh/[jobId] for completion.

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { PlanningStatsRefreshService } from "@/lib/planning-stats-refresh/service";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function refreshSource(request: Request): string {
  const fallback = "planning-stats-refresh-api";
  const referer = request.headers.get("referer");
  if (!referer) return fallback;
  try {
    return new URL(referer).pathname.slice(0, 200) || fallback;
  } catch {
    return fallback;
  }
}

function requestCorrelationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied
    : randomUUID();
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const allowed = await canDo(
    session.user.id,
    (session.user.role as string) ?? "user",
    "demand-planning",
    "read",
  );
  if (!allowed) {
    return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid query parameters" }, { status: 400 });
  }

  try {
    const { page, limit, status } = parsed.data;
    const result = await PlanningStatsRefreshService.listJobs({
      limit,
      offset: (page - 1) * limit,
      status,
    });
    return NextResponse.json({
      success: true,
      data: result.jobs,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
    });
  } catch (error) {
    console.error("Planning stats refresh GET failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const allowed = await canDo(
    session.user.id,
    (session.user.role as string) ?? "user",
    "demand-planning",
    "edit",
  );
  if (!allowed) {
    return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
  }

  try {
    const requestBody = await request.json().catch(() => null) as { salesWindowWeights?: unknown; oosLostDemandWeights?: unknown } | null;

    const queued = await PlanningStatsRefreshService.queue(requestBody ?? {}, {
      requestedBy: session.user.id,
      requestedByEmail: session.user.email ?? null,
      source: refreshSource(request),
      correlationId: requestCorrelationId(request),
    });

    const correlationId = queued.job.correlation_id;

    return NextResponse.json({
      success: true,
      data: {
        jobId: queued.job.id,
        status: queued.job.status,
        reused: !queued.created,
        correlationId,
      },
    }, {
      status: 202,
      headers: correlationId ? { "x-correlation-id": correlationId } : undefined,
    });
  } catch (error) {
    console.error("Planning stats refresh POST failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
