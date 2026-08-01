// Code Guide: PATCH /api/planning/containers/items/[id]
// Updates qty for a single fc_container_items row and keeps remaining-stock
// allocations synchronized.
//
// DELETE /api/planning/containers/items/[id]
// Removes the item and any remaining-stock allocations attached to it.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { ContainerPlanningService } from "@/lib/container-planning/service";

const BodySchema = z.object({
  qty: z.number().int().min(0),
  sku_memo: z.string().optional(),
});

function parseItemId(id: string) {
  const itemId = parseInt(id, 10);
  return Number.isNaN(itemId) ? null : itemId;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPlanningMutation(_req, "container-planning", "delete");
  if (denied) return denied;
  const { id } = await params;
  const itemId = parseItemId(id);
  if (itemId == null) return apiError("Invalid id", 400);

  try {
    await ContainerPlanningService.deleteItem(itemId);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPlanningMutation(req, "container-planning", "edit");
  if (denied) return denied;
  const { id } = await params;
  const itemId = parseItemId(id);
  if (itemId == null) return apiError("Invalid id", 400);

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return apiError("qty must be a non-negative integer", 400);

  const { qty, sku_memo } = parsed.data;

  try {
    const result = await ContainerPlanningService.updateItem(itemId, qty, sku_memo ?? null);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
