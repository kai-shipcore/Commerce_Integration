/**
 * Code Guide:
 * This API route owns the collections backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

// Validation schema for creating/updating collections
const CollectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  colorCode: z.string().optional(),
  isPinned: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  skuIds: z.array(z.string()).optional(),
});

// GET /api/collections - List all collections
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const isPinned = searchParams.get("isPinned");

    // Build where clause
    const where: any = {};
    if (isPinned !== null) where.isPinned = isPinned === "true";

    const collections = await prisma.sKUCollection.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        members: {
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                name: true,
                currentStock: true,
                imageUrl: true,
                category: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: collections,
    });
  } catch (error: any) {
    console.error("Error fetching collections:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/collections - Create a new collection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = CollectionSchema.parse(body);

    const { skuIds, ...collectionData } = validatedData;

    // Create collection
    const collection = await prisma.sKUCollection.create({
      data: {
        ...collectionData,
        members: skuIds
          ? {
              create: skuIds.map((skuId, index) => ({
                skuId,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        members: {
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                name: true,
                currentStock: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(
      { success: true, data: collection },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating collection:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
