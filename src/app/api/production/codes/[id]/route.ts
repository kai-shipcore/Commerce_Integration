// Code Guide: CRUD API for a single pd_production_codes record by id.
// PATCH updates any subset of fields; DELETE soft-deletes by marking the code inactive.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serialize(c: object): object {
  return JSON.parse(JSON.stringify(c, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProductionCodeUpdateSchema = z.object({
  code: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductionCodeUpdateSchema.parse(body);
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const requiredAction = isStatusOnly
      ? (validated.isActive ? "status" : "delete")
      : "edit";
    const denied = await guardPermission("parts-codes", requiredAction);
    if (denied) return denied;

    const existing = await prisma.productionCode.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Code not found" },
        { status: 404 }
      );
    }

    if (validated.code) {
      const code = validated.code.toUpperCase();
      const duplicate = await prisma.productionCode.findUnique({
        where: { code },
      });
      if (duplicate && duplicate.id !== BigInt(id)) {
        return NextResponse.json(
          { success: false, error: `Code already exists: ${code}` },
          { status: 400 }
        );
      }
      validated.code = code;
    }

    const updated = await prisma.productionCode.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    const session = await auth();
    const auditAction = isStatusOnly
      ? (validated.isActive ? "status_change" : "delete")
      : "update";
    void logAudit({
      entityType: "production_code",
      entityId: id,
      entityLabel: existing.code,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: auditAction,
      before: isStatusOnly
        ? { isActive: !validated.isActive }
        : { description: existing.description },
      after: isStatusOnly
        ? { isActive: validated.isActive }
        : { description: updated.description },
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
    console.error("Error updating production code:", error);
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

    const existing = await prisma.productionCode.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Code not found" },
        { status: 404 }
      );
    }

    await prisma.productionCode.update({
      where: { id: BigInt(id) },
      data: { isActive: false },
    });

    const session = await auth();
    void logAudit({
      entityType: "production_code",
      entityId: id,
      entityLabel: existing.code,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { isActive: true },
      ip: getIp(_request.headers),
    });
    return NextResponse.json({ success: true, message: "Code deactivated successfully" });
  } catch (error: unknown) {
    console.error("Error deleting production code:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
