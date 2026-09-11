// Code Guide: GET/POST/PATCH /api/planning/scenarios
// The Demand Planning grid's Google-Sheets-style tabs. The Live tab is not a
// row here — it is the real container data, and has no scenario id.
// GET   — tabs the caller can see (their own plus shared ones)
// POST  — create a tab; `copy_from: "live"` snapshots the current real plan
// PATCH — reorder tabs ({ order: [id, ...] })
// Controller layer only: shaping and rules live in PlanningScenarioService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { guardPermission } from "@/lib/permissions";
import { requireScenarioActor } from "@/lib/planning-scenarios/actor";
import { PlanningScenarioService } from "@/lib/planning-scenarios/service";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(["private", "shared"]).optional(),
  color: z.string().trim().max(32).nullable().optional(),
  view_state: z.record(z.string(), z.unknown()).optional(),
  copy_from: z.literal("live").nullable().optional(),
  include_drafts: z.boolean().optional(),
});

const ReorderSchema = z.object({
  order: z.array(z.union([z.string(), z.number()])).max(200),
});

export async function GET(request: NextRequest) {
  try {
    const denied = await guardPermission("demand-planning", "read");
    if (denied) return denied;

    const actor = await requireScenarioActor(request);
    const data = await PlanningScenarioService.list(actor);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const actor = await requireScenarioActor(request);
    const input = parsed.data;

    const data = input.copy_from === "live"
      ? await PlanningScenarioService.duplicate(actor, {
        fromId: null,
        name: input.name,
        includeDrafts: input.include_drafts ?? false,
        viewState: input.view_state,
      })
      : await PlanningScenarioService.create(actor, {
        name: input.name,
        visibility: input.visibility,
        color: input.color ?? null,
        viewState: input.view_state,
      });

    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const denied = await guardPlanningMutation(request, "demand-planning", "edit");
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const parsed = ReorderSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const actor = await requireScenarioActor(request);
    await PlanningScenarioService.reorder(actor, parsed.data.order);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
