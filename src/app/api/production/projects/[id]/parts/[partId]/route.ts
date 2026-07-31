// Code Guide: single configuration row (ProjectPart) by id. PATCH updates any field — this powers
// every inline-editable cell in the Project List table. DELETE removes the row.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProjectPartUpdateSchema = z.object({
  cab: z.string().nullable().optional(),
  status: z.enum(["Pending", "Scheduled", "Scanned"]).optional(),
  assignedToUserId: z.string().nullable().optional(),
  photoCount: z.number().int().min(0).optional(),
  docUrl: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, partId } = await params;
    const body = await request.json();
    const validated = ProjectPartUpdateSchema.parse(body);

    const part = await ProductListService.updateProjectPart(BigInt(id), BigInt(partId), validated);
    return apiSuccess({ data: serialize(part) });
  } catch (error) {
    console.error("Error updating project part:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> },
) {
  const denied = await guardPermission("project-list", "delete");
  if (denied) return denied;
  try {
    const { id, partId } = await params;
    await ProductListService.deleteProjectPart(BigInt(id), BigInt(partId));
    return apiSuccess({ message: "Configuration deleted" });
  } catch (error) {
    console.error("Error deleting project part:", error);
    return handleApiError(error);
  }
}
