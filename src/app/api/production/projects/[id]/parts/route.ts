// Code Guide: configuration rows ("+ Add config") for a single Project.
// POST only — the parent GET /api/production/projects already returns nested parts.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

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

const USER_SELECT = { id: true, name: true, email: true } as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("project-list", "create");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProjectPartCreateSchema.parse(body);

    const project = await prisma.project.findUnique({ where: { id: BigInt(id) } });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const part = await prisma.projectPart.create({
      data: { ...validated, docUrl: validated.docUrl || undefined, projectId: BigInt(id) },
      include: { assignedTo: { select: USER_SELECT } },
    });

    return NextResponse.json({ success: true, data: serialize(part) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating project part:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
