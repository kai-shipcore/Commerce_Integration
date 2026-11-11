// Code Guide: Replacing Soon CRUD (GET list / POST save one-or-many / DELETE by sku)
// backs the /planning/replacing-soon page. A registered SKU is about to be replaced,
// so the Demand Planning automatic order calculations stock it only up to its
// target inventory life (default 30 days). Controller only: validates with Zod and
// delegates to SkuReplacingSoonService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { guardPermission } from "@/lib/permissions";
import { SkuReplacingSoonService } from "@/lib/sku-replacing-soon/service";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";

const RowSchema = z.object({
  masterSku: z.string().trim().min(1).max(128),
  targetInvLifeDays: z.number().int().min(1).max(365).nullish(),
  replacementSku: z.string().trim().max(128).nullish(),
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
  const denied = await guardPermission("replacing-soon", "read");
  if (denied) return denied;
  try {
    const data = await SkuReplacingSoonService.list();
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("replacing-soon", "edit");
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const data = await SkuReplacingSoonService.save(parsed.data.rows, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("replacing-soon", "delete");
  if (denied) return denied;
  try {
    const raw = new URL(request.url).searchParams.get("sku") ?? "";
    const skus = raw.split(",").map((sku) => sku.trim()).filter(Boolean);
    if (skus.length === 0) return apiError("sku is required", 400);
    const data = await SkuReplacingSoonService.remove(skus, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
