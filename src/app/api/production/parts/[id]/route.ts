// Code Guide: CRUD API for a single pd_production_parts record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the part inactive.

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

const ProductionPartUpdateSchema = z.object({
  partName: z.string().min(1).optional(),
  description: z.string().optional(),
  seatRow: z.enum(["Front", "Rear", "Second Row", "Third Row"]).optional(),
  position: z.enum(["Driver", "Passenger", "Middle", "Universal"]).optional(),
  category: z.enum(["Headrest", "Top Body", "Bottom", "Arm", "Console", "Back Storage", "Sub-part", "Leg Support", "Side Bolster"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductionPartUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly
      ? (validated.isActive ? "status" : "delete")
      : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const existing = await prisma.productionPart.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Part not found" },
        { status: 404 }
      );
    }

    if (validated.partName) {
      const duplicate = await prisma.productionPart.findUnique({
        where: { partName: validated.partName },
      });
      if (duplicate && duplicate.id !== BigInt(id)) {
        return NextResponse.json(
          { success: false, error: `Part already exists: ${validated.partName}` },
          { status: 400 }
        );
      }
    }

    const part = await prisma.productionPart.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    const session = await auth();
    const auditAction = isStatusOnly
      ? (validated.isActive ? "status_change" : "delete")
      : "update";
    void logAudit({
      entityType: "production_part",
      entityId: id,
      entityLabel: existing.partName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: auditAction,
      before: isStatusOnly
        ? { isActive: !validated.isActive }
        : { partName: existing.partName, description: existing.description },
      after: isStatusOnly
        ? { isActive: validated.isActive }
        : { partName: part.partName, description: part.description },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(part) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating production part:", error);
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

    const existing = await prisma.productionPart.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Part not found" },
        { status: 404 }
      );
    }

    await prisma.productionPart.update({
      where: { id: BigInt(id) },
      data: { isActive: false },
    });

    const session = await auth();
    void logAudit({
      entityType: "production_part",
      entityId: id,
      entityLabel: existing.partName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { isActive: true, partName: existing.partName },
      ip: getIp(_request.headers),
    });
    return NextResponse.json({ success: true, message: "Part deactivated successfully" });
  } catch (error: unknown) {
    console.error("Error deleting production part:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
