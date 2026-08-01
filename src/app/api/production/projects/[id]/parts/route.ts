// Code Guide: configuration rows ("+ Add config") for a single Project.
// POST only — the parent GET /api/production/projects already returns nested parts.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProjectPartCreateSchema = z.object({
  cab: z.string().optional(),
  code: z.string().optional(),
  status: z.enum(["Pending", "Scheduled", "Scanned"]).default("Pending"),
  assignedToUserId: z.string().optional(),
  photoCount: z.number().int().min(0).default(0),
  docUrl: z.string().url().optional().or(z.literal("")),
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
    const validated = ProjectPartCreateSchema.parse(body);

    const part = await ProductListService.createProjectPart(BigInt(id), validated);
    return apiSuccess({ data: serialize(part) }, 201);
  } catch (error) {
    console.error("Error creating project part:", error);
    return handleApiError(error);
  }
}
