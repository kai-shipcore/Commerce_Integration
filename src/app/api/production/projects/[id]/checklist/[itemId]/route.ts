// Code Guide: single checklist item by id. PATCH updates description/status; DELETE hard-removes
// it (checklist items are trivial sub-rows — no soft-delete/audit needed, unlike the parent tables).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serialize(i: object): object {
  return JSON.parse(JSON.stringify(i, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ChecklistItemUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  status: z.enum(["Pending", "In Progress", "Done"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, itemId } = await params;
    const body = await request.json();
    const validated = ChecklistItemUpdateSchema.parse(body);

    const existing = await prisma.projectChecklistItem.findUnique({ where: { id: BigInt(itemId) } });
    if (!existing || existing.projectId !== BigInt(id)) {
      return NextResponse.json(
        { success: false, error: "Checklist item not found" },
        { status: 404 }
      );
    }

    const item = await prisma.projectChecklistItem.update({
      where: { id: BigInt(itemId) },
      data: validated,
    });

    return NextResponse.json({ success: true, data: serialize(item) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating checklist item:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id, itemId } = await params;

    const existing = await prisma.projectChecklistItem.findUnique({ where: { id: BigInt(itemId) } });
    if (!existing || existing.projectId !== BigInt(id)) {
      return NextResponse.json(
        { success: false, error: "Checklist item not found" },
        { status: 404 }
      );
    }

    await prisma.projectChecklistItem.delete({ where: { id: BigInt(itemId) } });

    return NextResponse.json({ success: true, message: "Checklist item deleted" });
  } catch (error: unknown) {
    console.error("Error deleting checklist item:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
