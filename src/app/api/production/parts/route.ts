// Code Guide: CRUD API for fc_production_parts table. GET lists all parts with optional filters;
// POST creates a new part record.

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
function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProductionPartCreateSchema = z.object({
  partName: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const activeParam = searchParams.get("active");

    const parts = await prisma.productionPart.findMany({
      where: {
        ...(search
          ? { partName: { contains: search, mode: "insensitive" } }
          : {}),
        ...(activeParam !== null ? { isActive: activeParam === "true" } : {}),
      },
      orderBy: { partName: "asc" },
    });

    return NextResponse.json({ success: true, data: parts.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching production parts:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = ProductionPartCreateSchema.parse(body);

    const existing = await prisma.productionPart.findUnique({
      where: { partName: validated.partName },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Part already exists: ${validated.partName}` },
        { status: 400 }
      );
    }

    const part = await prisma.productionPart.create({
      data: validated,
    });

    const session = await auth();
    void logAudit({
      entityType: "production_part",
      entityId: String(part.id),
      entityLabel: part.partName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { description: part.description },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(part) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating production part:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
