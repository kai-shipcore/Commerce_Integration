/**
 * Code Guide:
 * This API route owns the skus / bulk backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { CacheManager } from "@/lib/redis";

const BulkDeleteSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

// DELETE /api/skus/bulk - Delete multiple SKUs
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = BulkDeleteSchema.parse(body);

    // Check which SKUs exist and have variants
    const existingSKUs = await prisma.sKU.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        skuCode: true,
        customVariants: {
          select: { id: true },
        },
      },
    });

    const existingIds = existingSKUs.map((s) => s.id);
    const notFoundIds = ids.filter((id) => !existingIds.includes(id));

    // Check for SKUs with variants
    const skusWithVariants = existingSKUs.filter(
      (s) => s.customVariants.length > 0
    );

    if (skusWithVariants.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Some SKUs have custom variants and cannot be deleted",
          skusWithVariants: skusWithVariants.map((s) => ({
            id: s.id,
            skuCode: s.skuCode,
            variantCount: s.customVariants.length,
          })),
        },
        { status: 400 }
      );
    }

    // Delete all SKUs in a transaction
    const deleteResult = await prisma.$transaction(async (tx) => {
      // Delete collection memberships first
      await tx.sKUCollectionMember.deleteMany({
        where: { skuId: { in: existingIds } },
      });

      // Delete sales records
      await tx.salesRecord.deleteMany({
        where: { skuId: { in: existingIds } },
      });

      // Delete inventory snapshots
      await tx.inventorySnapshot.deleteMany({
        where: { skuId: { in: existingIds } },
      });

      // Delete trend data
      await tx.trendData.deleteMany({
        where: { skuId: { in: existingIds } },
      });

      // Finally delete the SKUs
      const deleted = await tx.sKU.deleteMany({
        where: { id: { in: existingIds } },
      });

      return deleted;
    });

    // Invalidate caches
    await Promise.all([
      ...existingIds.map((id) => CacheManager.invalidateSKU(id)),
      CacheManager.delete("dashboard:analytics"),
      CacheManager.delete("dashboard:analytics:7d"),
      CacheManager.delete("dashboard:analytics:30d"),
      CacheManager.delete("dashboard:analytics:90d"),
      CacheManager.delete("dashboard:analytics:1y"),
    ]);

    return NextResponse.json({
      success: true,
      deleted: deleteResult.count,
      notFound: notFoundIds.length,
      message: `Successfully deleted ${deleteResult.count} SKU(s)`,
    });
  } catch (error: any) {
    console.error("Error bulk deleting SKUs:", error);

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
