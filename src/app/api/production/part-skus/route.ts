// Code Guide: CRUD API for pd_part_skus table. GET lists all generated Part SKUs with optional
// filters; POST generates and saves a new Part SKU (Part-MakeAbbr-ModelAbbr-Code-Initial-Side).

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

const PartSkuCreateSchema = z.object({
  partName: z.string().min(1),
  make: z.string().min(1),
  makeAbbr: z.string().min(1),
  model: z.string().min(1),
  modelAbbr: z.string().min(1),
  code: z.string().min(1),
  initial: z.string().min(1),
  side: z.enum(["D", "P", "MD", "MP", "Universal"]),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("part-sku-generator", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const activeParam = searchParams.get("active");
    const make = searchParams.get("make");
    const model = searchParams.get("model");

    const partSkus = await prisma.partSku.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: "insensitive" } },
                { partName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(activeParam !== null ? { isActive: activeParam === "true" } : {}),
        ...(make ? { make: { equals: make, mode: "insensitive" } } : {}),
        ...(model ? { model: { equals: model, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: partSkus.map(serialize) });
  } catch (error: unknown) {
    console.error("Error fetching part skus:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("part-sku-generator", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = PartSkuCreateSchema.parse(body);

    const skuSegments = [
      validated.partName,
      validated.makeAbbr,
      validated.modelAbbr,
      validated.code,
      validated.initial,
    ];
    if (validated.side !== "Universal") skuSegments.push(validated.side);
    const sku = skuSegments.join("-");

    const existing = await prisma.partSku.findUnique({ where: { sku } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Part SKU already exists: ${sku}` },
        { status: 400 }
      );
    }

    const session = await auth();
    const partSku = await prisma.partSku.create({
      data: {
        ...validated,
        sku,
        createdByName: session?.user?.name ?? session?.user?.email ?? null,
      },
    });

    void logAudit({
      entityType: "part_sku",
      entityId: String(partSku.id),
      entityLabel: partSku.sku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { sku: partSku.sku },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: serialize(partSku) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating part sku:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
