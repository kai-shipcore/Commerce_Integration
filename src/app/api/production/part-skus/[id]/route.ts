// Code Guide: single pd_part_skus record by id.
// PATCH only supports toggling isActive (the generated fields are immutable once created).
// DELETE soft-deletes by marking the Part SKU inactive.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { PartSkuGeneratorService } from "@/lib/part-sku-generator/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const PartSkuUpdateSchema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = PartSkuUpdateSchema.parse(body);
    const requiredAction = validated.isActive ? "status" : "delete";
    const denied = await guardPermission("part-sku-generator", requiredAction);
    if (denied) return denied;

    const session = await auth();
    const partSku = await PartSkuGeneratorService.setActive(BigInt(id), validated.isActive, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(partSku) });
  } catch (error) {
    console.error("Error updating part sku:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("part-sku-generator", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const session = await auth();

    await PartSkuGeneratorService.softDelete(BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: "Part SKU deactivated successfully" });
  } catch (error) {
    console.error("Error deleting part sku:", error);
    return handleApiError(error);
  }
}
