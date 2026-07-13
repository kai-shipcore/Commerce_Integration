// Code Guide: CRUD API for pd_designer_initials table. GET lists all designer initials with
// optional filters; POST creates a new designer initial record.

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
function serialize(d: object): object {
  return JSON.parse(JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const DesignerInitialCreateSchema = z.object({
  initial: z.string().min(1),
  designerName: z.string().min(1),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const activeParam = searchParams.get("active");

    const initials = await prisma.designerInitial.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { initial: { contains: search, mode: "insensitive" } },
                { designerName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(activeParam !== null ? { isActive: activeParam === "true" } : {}),
      },
      orderBy: { initial: "asc" },
    });

    return NextResponse.json({ success: true, data: initials.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching designer initials:", error);
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
    const validated = DesignerInitialCreateSchema.parse(body);

    const initial = validated.initial.toUpperCase();

    const existing = await prisma.designerInitial.findUnique({
      where: { initial },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Initial already exists: ${initial}` },
        { status: 400 }
      );
    }

    const created = await prisma.designerInitial.create({
      data: { ...validated, initial },
    });

    const session = await auth();
    void logAudit({
      entityType: "designer_initial",
      entityId: String(created.id),
      entityLabel: created.initial,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { designerName: created.designerName },
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
    console.error("Error creating designer initial:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
