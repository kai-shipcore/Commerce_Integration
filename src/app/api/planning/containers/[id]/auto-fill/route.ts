// Code Guide: POST /api/planning/containers/[id]/auto-fill
// Bulk-upserts fc_container_items for a container from optimizer-calculated quantities.
// cbm_unit is looked up from fc_products. Returns item_id, qty, cbm_unit, total_cbm per SKU.
//
// This route mutates container-planning's own tables, but its only caller is
// the Demand Planning grid's "commit container quantities" flow — the
// Container Planning page does not use it.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { ContainerPlanningService } from "@/lib/container-planning/service";

const BodySchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    qty: z.number().int().min(0),
  })).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPlanningMutation(req, "container-planning", "edit");
  if (denied) return denied;
  const { id } = await params;
  const containerId = parseInt(id, 10);
  if (!Number.isFinite(containerId) || containerId <= 0) {
    return apiError("Invalid container id", 400);
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  try {
    const items = await ContainerPlanningService.autoFill(containerId, parsed.data.items);
    return apiSuccess({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
