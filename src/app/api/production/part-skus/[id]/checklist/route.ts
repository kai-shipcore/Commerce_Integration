// Code Guide: checklist items for a single Part SKU.
// GET lists items for the Part SKU; POST adds a new item (description + status).

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

const ChecklistItemCreateSchema = z.object({
  description: z.string().min(1),
  status: z.enum(["Pending", "In Progress", "Done"]).default("Pending"),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("part-sku-generator", "read");
  if (denied) return denied;
  try {
    const { id } = await params;
    const items = await prisma.partSkuChecklistItem.findMany({
      where: { partSkuId: BigInt(id) },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ success: true, data: items.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching checklist items:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("part-sku-generator", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ChecklistItemCreateSchema.parse(body);

    const partSku = await prisma.partSku.findUnique({ where: { id: BigInt(id) } });
    if (!partSku) {
      return NextResponse.json(
        { success: false, error: "Part SKU not found" },
        { status: 404 }
      );
    }

    const item = await prisma.partSkuChecklistItem.create({
      data: { ...validated, partSkuId: BigInt(id) },
    });

    return NextResponse.json({ success: true, data: serialize(item) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating checklist item:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
