// Code Guide: CRUD API for a single pd_designer_initials record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the initial inactive.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { MasterDataService, MASTER_DATA_CONFIGS } from "@/lib/parts-codes/service";

const DesignerInitialUpdateSchema = z.object({
  initial: z.string().min(1).optional(),
  designerName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

function serialize(d: object): object {
  return JSON.parse(JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = DesignerInitialUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly ? (validated.isActive ? "status" : "delete") : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const session = await auth();
    const updated = await MasterDataService.update(MASTER_DATA_CONFIGS.designerInitial, BigInt(id), validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(updated) });
  } catch (error) {
    console.error("Error updating designer initial:", error);
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

    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.designerInitial, BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: MASTER_DATA_CONFIGS.designerInitial.deactivatedMessage });
  } catch (error) {
    console.error("Error deleting designer initial:", error);
    return handleApiError(error);
  }
}
