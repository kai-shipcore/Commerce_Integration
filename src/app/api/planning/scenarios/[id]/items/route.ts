// Code Guide: GET/PUT /api/planning/scenarios/[id]/items
// A tab's container overlay — the quantities and ETAs the grid seeds its
// qtyOverrides / etaOverrides maps from. Nothing here touches
// fc_container_items or fc_containers.
//
// GET — the whole overlay for one tab
// PUT — upsert cells. qty null clears the override so the cell falls back to
//       the Live quantity; qty 0 is an explicit "ship none of this here".

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { guardPermission } from "@/lib/permissions";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

const BodySchema = z.object({
  items: z.array(z.object({
    container_id: z.number().int().positive(),
    master_sku: z.string().trim().min(1),
    qty: z.number().int().min(0).nullable(),
  })).max(5000).optional(),
  containers: z.array(z.object({
    container_id: z.number().int().positive(),
    eta_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })).max(200).optional(),
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
    const data = await PlanningScenarioService.getOverlay(id, actor);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
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

    if (parsed.data.items?.length) {
      await PlanningScenarioService.saveItems(id, actor, parsed.data.items);
    }
    for (const container of parsed.data.containers ?? []) {
      await PlanningScenarioService.saveContainerOverride(
        id, actor, container.container_id, container.eta_date,
      );
    }

    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
