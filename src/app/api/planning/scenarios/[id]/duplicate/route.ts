// Code Guide: POST /api/planning/scenarios/[id]/duplicate
// Copies an existing tab — its saved view plus its whole container overlay —
// into a new private tab owned by the caller. Copying the Live tab has no id
// and goes through POST /api/planning/scenarios with copy_from: "live".

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

const BodySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const { id } = await params;
    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.duplicate(actor, {
      fromId: id,
      name: parsed.data.name,
    });
    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
