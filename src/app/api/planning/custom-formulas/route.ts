// Code Guide: shared Custom/Calc columns for the Demand Planning Live tab.
// Everyone with read access receives the same values; only users with the
// demand-planning edit permission may replace them.

import { NextRequest } from "next/server";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { guardPermission } from "@/lib/permissions";
import { PlanningCustomFormulasService } from "@/lib/planning-custom-formulas/service";

export async function GET() {
  try {
    const denied = await guardPermission("demand-planning", "read");
    if (denied) return denied;
    return apiSuccess({ data: await PlanningCustomFormulasService.get() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const denied = await guardPermission("demand-planning", "edit");
    if (denied) return denied;
    const body = await request.json().catch(() => null) as { formulas?: unknown } | null;
    return apiSuccess({ data: await PlanningCustomFormulasService.save(body?.formulas) });
  } catch (error) {
    return handleApiError(error);
  }
}
