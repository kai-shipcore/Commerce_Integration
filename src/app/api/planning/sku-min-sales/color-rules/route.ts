// Code Guide: Sales reference colour rules (GET list / POST save one / DELETE by id)
// for the "Colour rules" tab of /planning/min-sales. A rule plans every SKU of one
// colour on a percent of the same SKU in another colour (Seat Cover IB on 30% of
// BE), applied at read time by DemandPlanningService. POST with `preview: true`
// saves nothing and returns how many active SKUs the rule would reach.
// Controller only: validates with Zod and delegates to SkuMinSalesService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { guardPermission } from "@/lib/permissions";
import { SkuMinSalesService } from "@/lib/sku-min-sales/service";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";

const RuleSchema = z.object({
  categoryCode: z.string().trim().min(1).max(8),
  material: z.string().trim().max(16).nullish(),
  color: z.string().trim().min(1).max(16),
  referenceColor: z.string().trim().min(1).max(16),
  referencePct: z.number().finite().positive().max(1000),
  note: z.string().trim().max(1000).nullish(),
  preview: z.boolean().optional(),
});

async function currentWho() {
  const session = await auth();
  return { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null };
}

export async function GET() {
  const denied = await guardPermission("min-sales", "read");
  if (denied) return denied;
  try {
    const data = await SkuMinSalesService.listColorRules();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = RuleSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { preview, ...rule } = parsed.data;
    const denied = await guardPermission("min-sales", preview ? "read" : "edit");
    if (denied) return denied;
    const data = preview
      ? await SkuMinSalesService.previewColorRule(rule)
      : await SkuMinSalesService.saveColorRule(rule, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("min-sales", "delete");
  if (denied) return denied;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return apiError("id is required", 400);
    const data = await SkuMinSalesService.removeColorRule(id, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
