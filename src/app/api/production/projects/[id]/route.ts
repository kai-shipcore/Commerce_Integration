// Code Guide: single pd_project_list record by id (one seat row of a product). PATCH updates
// submodel/isActive only -- seatRow is fixed at creation and make/model/fNumber/yearGeneration
// now live on the parent Product. DELETE hard-deletes (cascades to parts + checklist).

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProjectUpdateSchema = z.object({
  submodel: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const { id } = await params;
    const project = await ProductListService.getProject(BigInt(id));
    return apiSuccess({ data: serialize(project) });
  } catch (error) {
    console.error("Error fetching project:", error);
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProjectUpdateSchema.parse(body);

    const project = await ProductListService.updateProject(BigInt(id), validated);
    return apiSuccess({ data: serialize(project) });
  } catch (error) {
    console.error("Error updating project:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const session = await auth();

    await ProductListService.deleteProject(BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    return handleApiError(error);
  }
}
