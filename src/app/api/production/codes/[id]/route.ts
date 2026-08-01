// Code Guide: CRUD API for a single pd_production_codes record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the code inactive.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { MasterDataService, MASTER_DATA_CONFIGS } from "@/lib/parts-codes/service";

const ProductionCodeUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

function serialize(c: object): object {
  return JSON.parse(JSON.stringify(c, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductionCodeUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly ? (validated.isActive ? "status" : "delete") : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const session = await auth();
    const updated = await MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(id), validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(updated) });
  } catch (error) {
    console.error("Error updating production code:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("parts-codes", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const session = await auth();

    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.code, BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: MASTER_DATA_CONFIGS.code.deactivatedMessage });
  } catch (error) {
    console.error("Error deleting production code:", error);
    return handleApiError(error);
  }
}
