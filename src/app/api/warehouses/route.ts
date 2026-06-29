// Code Guide: CRUD API for fc_warehouses table. GET lists all warehouses with optional filters;
// POST creates a new warehouse record.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// BigInt fields (id) must be converted to string before JSON serialization.
function serialize(w: object): object {
  return JSON.parse(JSON.stringify(w, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const WarehouseCreateSchema = z.object({
  warehouseCode: z.string().min(1),
  warehouseName: z.string().min(1),
  warehouseType: z.enum(["own", "fba", "3pl", "transit"]),
  country: z.string().optional(),
  stateRegion: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("warehouse", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const type = searchParams.get("type") ?? "";
    const activeParam = searchParams.get("active");

    const warehouses = await prisma.warehouse.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { warehouseCode: { contains: search, mode: "insensitive" } },
                { warehouseName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(type ? { warehouseType: type } : {}),
        ...(activeParam !== null ? { isActive: activeParam === "true" } : {}),
      },
      orderBy: { warehouseCode: "asc" },
    });

    return NextResponse.json({ success: true, data: warehouses.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching warehouses:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("warehouse", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = WarehouseCreateSchema.parse(body);

    const code = validated.warehouseCode.toUpperCase();

    const existing = await prisma.warehouse.findUnique({
      where: { warehouseCode: code },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Warehouse code already exists: ${code}` },
        { status: 400 }
      );
    }

    const warehouse = await prisma.warehouse.create({
      data: { ...validated, warehouseCode: code },
    });

    const session = await auth();
    void logAudit({
      entityType: "warehouse",
      entityId: String(warehouse.id),
      entityLabel: warehouse.warehouseCode,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { warehouseName: warehouse.warehouseName, warehouseType: warehouse.warehouseType, country: warehouse.country },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(warehouse) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating warehouse:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
