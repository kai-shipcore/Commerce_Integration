// Code Guide: CRUD API for pd_product_list table. GET lists all products (vehicles) with their
// rows (projects) summarized for the list/detail UI; POST creates a new product (header only —
// rows are added afterward via /api/production/products/[id]/projects).

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

const ProductCreateSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  fNumber: z.string().min(1),
  yearGeneration: z.string().optional(),
});

const PROJECTS_INCLUDE = {
  projects: {
    select: {
      id: true,
      seatRow: true,
      submodel: true,
      parts: { select: { status: true } },
      _count: { select: { checklistItems: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

export async function GET(request: NextRequest) {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const activeParam = searchParams.get("active");

    const products = await prisma.product.findMany({
      where: activeParam !== null ? { isActive: activeParam === "true" } : { isActive: true },
      include: PROJECTS_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: products.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("project-list", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = ProductCreateSchema.parse(body);

    const product = await prisma.product.create({
      data: validated,
      include: PROJECTS_INCLUDE,
    });

    const session = await auth();
    void logAudit({
      entityType: "product",
      entityId: String(product.id),
      entityLabel: `${product.make} ${product.model} — ${product.fNumber}`,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { make: product.make, model: product.model, fNumber: product.fNumber },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(product) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating product:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
