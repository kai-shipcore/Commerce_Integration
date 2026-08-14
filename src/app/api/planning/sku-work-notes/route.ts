// GET/PUT short shared workflow labels for the Planning dashboard Note column.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { PlanningDashboardService } from "@/lib/planning-dashboard/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

function parseSlot(value: unknown): 1 | 2 | 3 {
  return value === "2" || value === 2 ? 2 : value === "3" || value === 3 ? 3 : 1;
}

export async function GET(request: NextRequest) {
  try {
    const data = await PlanningDashboardService.getSkuWorkNotes(parseSlot(request.nextUrl.searchParams.get("slot")));
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
    const body = await request.json() as { sku?: unknown; note?: unknown; slot?: unknown };
    const data = await PlanningDashboardService.setSkuWorkNote(body.sku, body.note, session?.user?.id ?? null, parseSlot(body.slot));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
