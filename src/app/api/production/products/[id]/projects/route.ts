// Code Guide: creates a new pd_project_list row (one seat row of a product) under the given
// product, atomically with its initial configuration rows (pd_project) and checklist items
// (pd_project_list_checklist_items).

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

const ProjectPartInputSchema = z.object({
  cab: z.string().optional(),
  code: z.string().optional(),
  status: z.enum(["Pending", "Scheduled", "Scanned"]).default("Pending"),
  assignedToUserId: z.string().optional(),
  photoCount: z.number().int().min(0).default(0),
  docUrl: z.string().optional(),
});

const ChecklistItemInputSchema = z.object({
  description: z.string().min(1),
  status: z.enum(["Pending", "In Progress", "Done"]).default("Pending"),
});

const ProjectCreateSchema = z.object({
  seatRow: z.enum(["Front", "Rear", "Third Row"]),
  submodel: z.string().optional(),
  parts: z.array(ProjectPartInputSchema).default([]),
  checklistItems: z.array(ChecklistItemInputSchema).default([]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "create");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProjectCreateSchema.parse(body);
    const session = await auth();

    const project = await ProductListService.createProject(BigInt(id), validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(project) }, 201);
  } catch (error) {
    console.error("Error creating project:", error);
    return handleApiError(error);
  }
}
