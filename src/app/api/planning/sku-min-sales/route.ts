// Code Guide: SKU Min Sales CRUD (GET list / POST save one-or-many / DELETE by sku)
// backs the /planning/min-sales page. A registered SKU's minimum is a floor on the
// Demand Planning "T.Avg 현재" column, applied at read time by DemandPlanningService.
// Controller only: validates with Zod and delegates to SkuMinSalesService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { guardPermission } from "@/lib/permissions";
import { SkuMinSalesService } from "@/lib/sku-min-sales/service";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";

const RowSchema = z.object({
  masterSku: z.string().trim().min(1).max(128),
  minTotalAvgCurr: z.number().finite().min(0).max(1_000_000),
  note: z.string().trim().max(1000).nullish(),
});

const SaveSchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
});

async function currentWho() {
  const session = await auth();
  return { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null };
}

export async function GET() {
  const denied = await guardPermission("min-sales", "read");
  if (denied) return denied;
  try {
    const data = await SkuMinSalesService.list();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("min-sales", "edit");
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const data = await SkuMinSalesService.save(parsed.data.rows, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("min-sales", "delete");
  if (denied) return denied;
  try {
    const raw = new URL(request.url).searchParams.get("sku") ?? "";
    const skus = raw.split(",").map((sku) => sku.trim()).filter(Boolean);
    if (skus.length === 0) return apiError("sku is required", 400);
    const data = await SkuMinSalesService.remove(skus, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
