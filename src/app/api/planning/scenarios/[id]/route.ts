// Code Guide: GET/PATCH/DELETE /api/planning/scenarios/[id]
// One Demand Planning tab.
// GET    — the tab plus its saved view_state (what a tab switch hydrates from)
// PATCH  — rename, recolor, share/unshare, or save the view_state
// DELETE — remove the tab and its container overlay (owner or admin only)
// Controller layer only: access rules live in PlanningScenarioService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { guardPermission } from "@/lib/permissions";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  color: z.string().trim().max(32).nullable().optional(),
  view_state: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPermission("demand-planning", "read");
    if (denied) return denied;

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.get(id, actor);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.update(id, actor, {
      name: parsed.data.name,
      visibility: parsed.data.visibility,
      color: parsed.data.color,
      viewState: parsed.data.view_state,
    });
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
    await PlanningScenarioService.remove(id, actor);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
