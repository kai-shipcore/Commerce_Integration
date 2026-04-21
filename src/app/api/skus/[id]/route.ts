/**
 * Code Guide:
 * This API route owns the skus / [id] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { CacheManager, CacheKeys, CacheTTL } from "@/lib/redis";

const DEFAULT_INVENTORY_LOCATION_CODE = "DEFAULT";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// Validation schema for updating SKUs
const UpdateSKUSchema = z.object({
  skuCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  currentStock: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  isCustomVariant: z.boolean().optional(),
  parentSKUId: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string()).optional(),
  unitCost: z.number().positive().optional(),
  retailPrice: z.number().positive().optional(),
  shopifyProductId: z.string().optional(),
  amazonASIN: z.string().optional(),
  walmartItemId: z.string().optional(),
  ebayItemId: z.string().optional(),
});

// GET /api/skus/[id] - Get a single SKU by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check cache first
    const cacheKey = CacheKeys.sku(id);
    const cached = await CacheManager.get<unknown>(cacheKey);
    if (cached) {
      // Track query for hot SKU analysis
      await CacheManager.incrementSKUQueryCount(id);
      return NextResponse.json({ success: true, data: cached, cached: true });
    }

    const sku = await prisma.sKU.findUnique({
      where: { id },
      include: {
        inventoryBalances: {
          include: {
            location: {
              select: {
                id: true,
                code: true,
                name: true,
                isDefault: true,
              },
            },
          },
          orderBy: {
            location: {
              name: "asc",
            },
          },
        },
        parentSKU: {
          select: {
            id: true,
            skuCode: true,
            name: true,
            imageUrl: true,
          },
        },
        customVariants: {
          select: {
            id: true,
            skuCode: true,
            name: true,
            currentStock: true,
            imageUrl: true,
          },
        },
        collectionMembers: {
          include: {
            collection: {
              select: {
                id: true,
                name: true,
                colorCode: true,
              },
            },
          },
        },
        _count: {
          select: {
            salesRecords: true,
            inventorySnapshots: true,
          },
        },
      },
    });

    if (!sku) {
      return NextResponse.json(
        { success: false, error: "SKU not found" },
        { status: 404 }
      );
    }

    // Fetch related web SKUs that share the same master SKU
    let relatedWebSkus: { id: string; skuCode: string; salesCount: number }[] = [];
    if (sku.masterSkuCode) {
      const related = await prisma.sKU.findMany({
        where: {
          masterSkuCode: sku.masterSkuCode,
        },
        select: {
          id: true,
          skuCode: true,
          _count: {
            select: {
              salesRecords: true,
            },
          },
        },
        orderBy: {
          skuCode: "asc",
        },
      });
      relatedWebSkus = related.map((r) => ({
        id: r.id,
        skuCode: r.skuCode,
        salesCount: r._count.salesRecords,
      }));
    }

    const inventory = {
      onHand: sku.inventoryBalances.reduce((sum, balance) => sum + balance.onHandQty, 0),
      reserved: sku.inventoryBalances.reduce((sum, balance) => sum + balance.reservedQty, 0),
      allocated: sku.inventoryBalances.reduce((sum, balance) => sum + balance.allocatedQty, 0),
      backorder: sku.inventoryBalances.reduce((sum, balance) => sum + balance.backorderQty, 0),
      inbound: sku.inventoryBalances.reduce((sum, balance) => sum + balance.inboundQty, 0),
      available: sku.inventoryBalances.reduce((sum, balance) => sum + balance.availableQty, 0),
    };

    const skuWithRelated = {
      ...sku,
      currentStock: inventory.available,
      inventory,
      relatedWebSkus,
    };

    // Cache the SKU data
    await CacheManager.set(cacheKey, skuWithRelated, CacheTTL.SKU_DATA);

    // Track query for hot SKU analysis
    await CacheManager.incrementSKUQueryCount(id);

    return NextResponse.json({ success: true, data: skuWithRelated, cached: false });
  } catch (error: unknown) {
    console.error("Error fetching SKU:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// PATCH /api/skus/[id] - Update a SKU
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate input
    const validatedData = UpdateSKUSchema.parse(body);

    // Check if SKU exists
    const existing = await prisma.sKU.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "SKU not found" },
        { status: 404 }
      );
    }

    // If updating SKU code, check for duplicates
    if (validatedData.skuCode && validatedData.skuCode !== existing.skuCode) {
      const duplicate = await prisma.sKU.findUnique({
        where: { skuCode: validatedData.skuCode },
      });

      if (duplicate) {
        return NextResponse.json(
          { success: false, error: "SKU code already exists" },
          { status: 400 }
        );
      }
    }

    // If updating parent, verify it exists
    if (validatedData.parentSKUId) {
      const parent = await prisma.sKU.findUnique({
        where: { id: validatedData.parentSKUId },
      });

      if (!parent) {
        return NextResponse.json(
          { success: false, error: "Parent SKU not found" },
          { status: 400 }
        );
      }
    }

    const defaultLocation = await prisma.inventoryLocation.findFirst({
      where: { code: DEFAULT_INVENTORY_LOCATION_CODE },
      select: { id: true },
    });

    const sku = await prisma.$transaction(async (tx) => {
      const updatedSku = await tx.sKU.update({
        where: { id },
        data: validatedData,
        include: {
          parentSKU: {
            select: {
              id: true,
              skuCode: true,
              name: true,
            },
          },
          customVariants: {
            select: {
              id: true,
              skuCode: true,
              name: true,
            },
          },
        },
      });

      if (defaultLocation && validatedData.currentStock !== undefined) {
        const existingBalance = await tx.inventoryBalance.findUnique({
          where: {
            skuId_locationId: {
              skuId: id,
              locationId: defaultLocation.id,
            },
          },
          select: {
            reservedQty: true,
            allocatedQty: true,
            backorderQty: true,
            inboundQty: true,
          },
        });

        const reservedQty = existingBalance?.reservedQty ?? 0;
        const allocatedQty = existingBalance?.allocatedQty ?? 0;
        const backorderQty = existingBalance?.backorderQty ?? 0;
        const inboundQty = existingBalance?.inboundQty ?? 0;
        const availableQty = Math.max(
          0,
          validatedData.currentStock - reservedQty - allocatedQty
        );

        await tx.inventoryBalance.upsert({
          where: {
            skuId_locationId: {
              skuId: id,
              locationId: defaultLocation.id,
            },
          },
          update: {
            onHandQty: validatedData.currentStock,
            reservedQty,
            allocatedQty,
            backorderQty,
            inboundQty,
            availableQty,
          },
          create: {
            skuId: id,
            locationId: defaultLocation.id,
            onHandQty: validatedData.currentStock,
            reservedQty,
            allocatedQty,
            backorderQty,
            inboundQty,
            availableQty,
          },
        });
      }

      return updatedSku;
    });

    // Invalidate cache for this SKU and dashboard
    await Promise.all([
      CacheManager.invalidateSKU(id),
      CacheManager.delete("dashboard:analytics"),
    ]);

    return NextResponse.json({ success: true, data: sku });
  } catch (error: unknown) {
    console.error("Error updating SKU:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/skus/[id] - Delete a SKU
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if SKU exists
    const existing = await prisma.sKU.findUnique({
      where: { id },
      include: {
        customVariants: true,
        _count: {
          select: {
            salesRecords: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "SKU not found" },
        { status: 404 }
      );
    }

    // Check if SKU has custom variants
    if (existing.customVariants.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot delete SKU with custom variants. Delete variants first.",
        },
        { status: 400 }
      );
    }

    // Delete SKU (cascade will handle related records)
    await prisma.sKU.delete({ where: { id } });

    // Invalidate cache for this SKU and dashboard
    await Promise.all([
      CacheManager.invalidateSKU(id),
      CacheManager.delete("dashboard:analytics"),
    ]);

    return NextResponse.json({
      success: true,
      message: "SKU deleted successfully",
    });
  } catch (error: unknown) {
    console.error("Error deleting SKU:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
