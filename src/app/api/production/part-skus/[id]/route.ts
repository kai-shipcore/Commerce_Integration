// Code Guide: single fc_part_skus record by id.
// PATCH only supports toggling isActive (the generated fields are immutable once created).
// DELETE soft-deletes by marking the Part SKU inactive.

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

const PartSkuUpdateSchema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = PartSkuUpdateSchema.parse(body);
    const requiredAction = validated.isActive ? "status" : "delete";
    const denied = await guardPermission("part-sku-generator", requiredAction);
    if (denied) return denied;

    const existing = await prisma.partSku.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Part SKU not found" },
        { status: 404 }
      );
    }

    const partSku = await prisma.partSku.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    const session = await auth();
    void logAudit({
      entityType: "part_sku",
      entityId: id,
      entityLabel: existing.sku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: validated.isActive ? "status_change" : "delete",
      before: { isActive: existing.isActive },
      after: { isActive: partSku.isActive },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(partSku) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating part sku:", error);
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
  const denied = await guardPermission("part-sku-generator", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;

    const existing = await prisma.partSku.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Part SKU not found" },
        { status: 404 }
      );
    }

    await prisma.partSku.update({
      where: { id: BigInt(id) },
      data: { isActive: false },
    });

    const session = await auth();
    void logAudit({
      entityType: "part_sku",
      entityId: id,
      entityLabel: existing.sku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { isActive: true },
      ip: getIp(_request.headers),
    });
    return NextResponse.json({ success: true, message: "Part SKU deactivated successfully" });
  } catch (error: unknown) {
    console.error("Error deleting part sku:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
