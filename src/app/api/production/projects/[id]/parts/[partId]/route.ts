// Code Guide: single configuration row (ProjectPart) by id. PATCH updates any field — this powers
// every inline-editable cell in the Project List table. DELETE removes the row.

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

const ProjectPartUpdateSchema = z.object({
  cab: z.string().nullable().optional(),
  status: z.enum(["Pending", "Scheduled", "Scanned"]).optional(),
  assignedToUserId: z.string().nullable().optional(),
  photoCount: z.number().int().min(0).optional(),
  docUrl: z.string().nullable().optional(),
});

const USER_SELECT = { id: true, name: true, email: true } as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, partId } = await params;
    const body = await request.json();
    const validated = ProjectPartUpdateSchema.parse(body);

    const existing = await prisma.projectPart.findUnique({ where: { id: BigInt(partId) } });
    if (!existing || existing.projectId !== BigInt(id)) {
      return NextResponse.json(
        { success: false, error: "Configuration not found" },
        { status: 404 }
      );
    }

    const part = await prisma.projectPart.update({
      where: { id: BigInt(partId) },
      data: validated,
      include: { assignedTo: { select: USER_SELECT } },
    });

    return NextResponse.json({ success: true, data: serialize(part) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating project part:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; partId: string }> }
) {
  const denied = await guardPermission("project-list", "delete");
  if (denied) return denied;
  try {
    const { id, partId } = await params;

    const existing = await prisma.projectPart.findUnique({ where: { id: BigInt(partId) } });
    if (!existing || existing.projectId !== BigInt(id)) {
      return NextResponse.json(
        { success: false, error: "Configuration not found" },
        { status: 404 }
      );
    }

    await prisma.projectPart.delete({ where: { id: BigInt(partId) } });

    return NextResponse.json({ success: true, message: "Configuration deleted" });
  } catch (error: unknown) {
    console.error("Error deleting project part:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
