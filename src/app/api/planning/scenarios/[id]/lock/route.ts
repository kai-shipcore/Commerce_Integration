// Code Guide: POST/DELETE /api/planning/scenarios/[id]/lock
// The edit lock on a shared tab.
// POST   — claim the lock; afterwards only the lock holder, the tab owner, or
//          an admin can write to the tab
// DELETE — release it (lock holder, owner, or admin)

import { NextRequest } from "next/server";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.lock(id, actor);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.unlock(id, actor);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
