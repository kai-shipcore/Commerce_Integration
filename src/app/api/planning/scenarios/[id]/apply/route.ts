// Code Guide: POST /api/planning/scenarios/[id]/apply
// Writes a tab's container plan onto the real one.
//
// Without `confirm: true` this only returns the diff, so the grid can show
// what would change before anything is written — the write is not reversible.
// The write itself goes through ContainerPlanningService so allocation
// syncing and the container audit log happen the same way they do for a
// normal edit.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

const BodySchema = z.object({
  confirm: z.boolean().optional(),
  include_drafts: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const includeDrafts = parsed.data.include_drafts ?? false;

    if (!parsed.data.confirm) {
      const diff = await PlanningScenarioService.previewApply(id, actor, includeDrafts);
      return apiSuccess({ data: { ...diff, applied: 0, preview: true } });
    }

    const result = await PlanningScenarioService.applyToLive(id, actor, includeDrafts);
    return apiSuccess({ data: { ...result, preview: false } });
  } catch (error) {
    return handleApiError(error);
  }
}
