// Code Guide: single pd_product_list record by id. PATCH updates header fields (make/model/
// fNumber/yearGeneration/isActive). DELETE hard-deletes (cascades to projects -> parts + checklist).

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

const ProductUpdateSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  fNumber: z.string().min(1).optional(),
  yearGeneration: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductUpdateSchema.parse(body);

    const existing = await prisma.product.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const product = await prisma.product.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    return NextResponse.json({ success: true, data: serialize(product) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating product:", error);
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

    const existing = await prisma.product.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    await prisma.product.delete({ where: { id: BigInt(id) } });

    const session = await auth();
    void logAudit({
      entityType: "product",
      entityId: id,
      entityLabel: `${existing.make} ${existing.model} — ${existing.fNumber}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, message: "Product deleted successfully" });
  } catch (error: unknown) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
