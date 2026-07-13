// Code Guide: single pd_project_list record by id (one seat row of a product). PATCH updates
// submodel/isActive only -- seatRow is fixed at creation and make/model/fNumber/yearGeneration
// now live on the parent Product. DELETE hard-deletes (cascades to parts + checklist).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProjectUpdateSchema = z.object({
  submodel: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const USER_SELECT = { id: true, name: true, email: true } as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id: BigInt(id) },
      include: {
        parts: { orderBy: { createdAt: "asc" }, include: { assignedTo: { select: USER_SELECT } } },
        product: { select: { id: true, make: true, model: true, fNumber: true, yearGeneration: true } },
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: serialize(project) });
  } catch (error: unknown) {
    console.error("Error fetching project:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProjectUpdateSchema.parse(body);

    const existing = await prisma.project.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const project = await prisma.project.update({
      where: { id: BigInt(id) },
      data: validated,
      include: {
        parts: { orderBy: { createdAt: "asc" }, include: { assignedTo: { select: USER_SELECT } } },
        product: { select: { id: true, make: true, model: true, fNumber: true, yearGeneration: true } },
      },
    });

    return NextResponse.json({ success: true, data: serialize(project) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating project:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("project-list", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;

    const existing = await prisma.project.findUnique({
      where: { id: BigInt(id) },
      include: { product: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    await prisma.project.delete({ where: { id: BigInt(id) } });

    const session = await auth();
    void logAudit({
      entityType: "project",
      entityId: id,
      entityLabel: `${existing.product.make} ${existing.product.model} · ${existing.seatRow}${existing.submodel ? ` ${existing.submodel}` : ""}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, message: "Project deleted successfully" });
  } catch (error: unknown) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
