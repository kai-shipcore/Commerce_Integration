// Code Guide: CRUD API for a single fc_designer_initials record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the initial inactive.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serialize(d: object): object {
  return JSON.parse(JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const DesignerInitialUpdateSchema = z.object({
  initial: z.string().min(1).optional(),
  designerName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = DesignerInitialUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly
      ? (validated.isActive ? "status" : "delete")
      : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const existing = await prisma.designerInitial.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Designer initial not found" },
        { status: 404 }
      );
    }

    if (validated.initial) {
      const initial = validated.initial.toUpperCase();
      const duplicate = await prisma.designerInitial.findUnique({
        where: { initial },
      });
      if (duplicate && duplicate.id !== BigInt(id)) {
        return NextResponse.json(
          { success: false, error: `Initial already exists: ${initial}` },
          { status: 400 }
        );
      }
      validated.initial = initial;
    }

    const updated = await prisma.designerInitial.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    const session = await auth();
    const auditAction = isStatusOnly
      ? (validated.isActive ? "status_change" : "delete")
      : "update";
    void logAudit({
      entityType: "designer_initial",
      entityId: id,
      entityLabel: existing.initial,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: auditAction,
      before: isStatusOnly
        ? { isActive: !validated.isActive }
        : { designerName: existing.designerName },
      after: isStatusOnly
        ? { isActive: validated.isActive }
        : { designerName: updated.designerName },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(updated) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating designer initial:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("parts-codes", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;

    const existing = await prisma.designerInitial.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Designer initial not found" },
        { status: 404 }
      );
    }

    await prisma.designerInitial.update({
      where: { id: BigInt(id) },
      data: { isActive: false },
    });

    const session = await auth();
    void logAudit({
      entityType: "designer_initial",
      entityId: id,
      entityLabel: existing.initial,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { isActive: true, designerName: existing.designerName },
      ip: getIp(_request.headers),
    });
    return NextResponse.json({ success: true, message: "Designer initial deactivated successfully" });
  } catch (error: unknown) {
    console.error("Error deleting designer initial:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
