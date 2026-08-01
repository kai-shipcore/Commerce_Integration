// Code Guide: GET/PUT shared Master SKU notes for the demand planning dashboard.
// Notes are global per SKU, not per-user preferences, so every user sees the same memo.
// Controller layer only: delegates to PlanningDashboardService.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { PlanningDashboardService } from "@/lib/planning-dashboard/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const data = await PlanningDashboardService.getSkuNotes();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;

  try {
    const session = await auth();
    const body = await request.json() as { sku?: unknown; note?: unknown };
    const data = await PlanningDashboardService.setSkuNote(body.sku, body.note, session?.user?.id ?? null);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
