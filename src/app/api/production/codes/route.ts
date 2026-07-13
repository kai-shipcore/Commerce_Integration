// Code Guide: CRUD API for pd_production_codes table. GET lists all codes with optional filters;
// POST creates a new code record.

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
function serialize(c: object): object {
  return JSON.parse(JSON.stringify(c, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProductionCodeCreateSchema = z.object({
  code: z.string().min(1),
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

    const codes = await prisma.productionCode.findMany({
      where: {
        ...(search
          ? { code: { contains: search, mode: "insensitive" } }
          : {}),
        ...(activeParam !== null ? { isActive: activeParam === "true" } : {}),
      },
      orderBy: { code: "asc" },
    });

    return NextResponse.json({ success: true, data: codes.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching production codes:", error);
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
    const validated = ProductionCodeCreateSchema.parse(body);

    const code = validated.code.toUpperCase();

    const existing = await prisma.productionCode.findUnique({
      where: { code },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Code already exists: ${code}` },
        { status: 400 }
      );
    }

    const created = await prisma.productionCode.create({
      data: { ...validated, code },
    });

    const session = await auth();
    void logAudit({
      entityType: "production_code",
      entityId: String(created.id),
      entityLabel: created.code,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { description: created.description },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(created) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating production code:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
