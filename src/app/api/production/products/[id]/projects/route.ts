// Code Guide: creates a new pd_project_list row (one seat row of a product) under the given
// product, atomically with its initial configuration rows (pd_project) and checklist items
// (pd_project_list_checklist_items).

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
    const { parts, checklistItems, ...header } = ProjectCreateSchema.parse(body);

    const product = await prisma.product.findUnique({ where: { id: BigInt(id) } });
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const project = await prisma.project.create({
      data: {
        productId: BigInt(id),
        ...header,
        parts: { create: parts },
        checklistItems: { create: checklistItems },
      },
      include: {
        parts: { orderBy: { createdAt: "asc" }, include: { assignedTo: { select: USER_SELECT } } },
        _count: { select: { checklistItems: true } },
      },
    });

    const session = await auth();
    void logAudit({
      entityType: "project",
      entityId: String(project.id),
      entityLabel: `${product.make} ${product.model} · ${header.seatRow}${header.submodel ? ` ${header.submodel}` : ""}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { productId: id, seatRow: project.seatRow, submodel: project.submodel },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(project) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating project:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
