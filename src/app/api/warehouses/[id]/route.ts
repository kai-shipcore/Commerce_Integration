// Code Guide: CRUD API for a single fc_warehouses record by id.
// PATCH updates any subset of fields; DELETE removes the record.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serialize(w: object): object {
  return JSON.parse(JSON.stringify(w, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const WarehouseUpdateSchema = z.object({
  warehouseCode: z.string().min(1).optional(),
  warehouseName: z.string().min(1).optional(),
  warehouseType: z.enum(["own", "fba", "3pl", "transit"]).optional(),
  country: z.string().optional(),
  stateRegion: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = WarehouseUpdateSchema.parse(body);

    const existing = await prisma.warehouse.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Warehouse not found" },
        { status: 404 }
      );
    }

    if (validated.warehouseCode) {
      const code = validated.warehouseCode.toUpperCase();
      const duplicate = await prisma.warehouse.findUnique({
        where: { warehouseCode: code },
      });
      if (duplicate && duplicate.id !== BigInt(id)) {
        return NextResponse.json(
          { success: false, error: `Warehouse code already exists: ${code}` },
          { status: 400 }
        );
      }
      validated.warehouseCode = code;
    }

    const warehouse = await prisma.warehouse.update({
      where: { id: BigInt(id) },
      data: validated,
    });

    return NextResponse.json({ success: true, data: serialize(warehouse) });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating warehouse:", error);
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
  try {
    const { id } = await params;

    const existing = await prisma.warehouse.findUnique({ where: { id: BigInt(id) } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Warehouse not found" },
        { status: 404 }
      );
    }

    await prisma.warehouse.delete({ where: { id: BigInt(id) } });

    return NextResponse.json({ success: true, message: "Warehouse deleted successfully" });
  } catch (error: unknown) {
    console.error("Error deleting warehouse:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
