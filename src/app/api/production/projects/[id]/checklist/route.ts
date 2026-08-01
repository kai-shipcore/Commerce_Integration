// Code Guide: checklist items for a single Project.
// GET lists items for the Project; POST adds a new item (description + status).

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(i: object): object {
  return JSON.parse(JSON.stringify(i, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ChecklistItemCreateSchema = z.object({
  description: z.string().min(1),
  status: z.enum(["Pending", "In Progress", "Done"]).default("Pending"),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const { id } = await params;
    const items = await ProductListService.listChecklistItems(BigInt(id));
    return apiSuccess({ data: items.map(serialize) });
  } catch (error) {
    console.error("Error fetching checklist items:", error);
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ChecklistItemCreateSchema.parse(body);

    const item = await ProductListService.createChecklistItem(BigInt(id), validated);
    return apiSuccess({ data: serialize(item) }, 201);
  } catch (error) {
    console.error("Error creating checklist item:", error);
    return handleApiError(error);
  }
}
