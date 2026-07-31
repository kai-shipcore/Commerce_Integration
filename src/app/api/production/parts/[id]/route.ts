// Code Guide: CRUD API for a single pd_production_parts record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the part inactive.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { MasterDataService, MASTER_DATA_CONFIGS } from "@/lib/parts-codes/service";

const ProductionPartUpdateSchema = z.object({
  partName: z.string().min(1).optional(),
  description: z.string().optional(),
  seatRow: z.enum(["Front", "Rear", "Second Row", "Third Row"]).optional(),
  position: z.enum(["Driver", "Passenger", "Middle", "Universal"]).optional(),
  category: z.enum(["Headrest", "Top Body", "Bottom", "Arm", "Console", "Back Storage", "Sub-part", "Leg Support", "Side Bolster"]).optional(),
  isActive: z.boolean().optional(),
});

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductionPartUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly ? (validated.isActive ? "status" : "delete") : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const session = await auth();
    const part = await MasterDataService.update(MASTER_DATA_CONFIGS.part, BigInt(id), validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(part) });
  } catch (error) {
    console.error("Error updating production part:", error);
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

    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.part, BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: MASTER_DATA_CONFIGS.part.deactivatedMessage });
  } catch (error) {
    console.error("Error deleting production part:", error);
    return handleApiError(error);
  }
}
