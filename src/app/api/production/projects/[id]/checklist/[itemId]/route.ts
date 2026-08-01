// Code Guide: single checklist item by id. PATCH updates description/status; DELETE hard-removes
// it (checklist items are trivial sub-rows — no soft-delete/audit needed, unlike the parent tables).

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(i: object): object {
  return JSON.parse(JSON.stringify(i, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ChecklistItemUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  status: z.enum(["Pending", "In Progress", "Done"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, itemId } = await params;
    const body = await request.json();
    const validated = ChecklistItemUpdateSchema.parse(body);

    const item = await ProductListService.updateChecklistItem(BigInt(id), BigInt(itemId), validated);
    return apiSuccess({ data: serialize(item) });
  } catch (error) {
    console.error("Error updating checklist item:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, itemId } = await params;
    await ProductListService.deleteChecklistItem(BigInt(id), BigInt(itemId));
    return apiSuccess({ message: "Checklist item deleted" });
  } catch (error) {
    console.error("Error deleting checklist item:", error);
    return handleApiError(error);
  }
}
