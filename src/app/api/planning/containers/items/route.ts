// Code Guide: POST /api/planning/containers/items
// Creates or replaces one fc_container_items row for a SKU in a container.
// If remaining available stock exists for that SKU, the matching allocation
// rows are synchronized in the same transaction.

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { guardPlanningMutation } from "@/lib/planning/mutation-permission";
import { ContainerPlanningService } from "@/lib/container-planning/service";

const BodySchema = z.object({
  container_id: z.number().int().positive(),
  master_sku: z.string().min(1),
  qty: z.number().int().min(0),
  cbm_unit: z.number().min(0).default(0),
  sku_memo: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const denied = await guardPlanningMutation(req, "container-planning", "edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  const { container_id, master_sku, qty, cbm_unit, sku_memo } = parsed.data;

  try {
    const result = await ContainerPlanningService.upsertItem(container_id, master_sku, qty, cbm_unit, sku_memo ?? null);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
