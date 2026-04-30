/**
 * Code Guide:
 * This API route owns the skus / [id] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { CacheManager } from "@/lib/redis";

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

// GET /api/skus/[id] - Get a single product by master_sku
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    type ProductRow = { master_sku: string; product_name: string; category: string | null; status: string | null };
    const products = await prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT master_sku, product_name, category, status FROM shipcore.sc_products WHERE master_sku = $1`,
      id
    );

    if (products.length === 0) {
      return NextResponse.json({ success: false, error: "SKU not found" }, { status: 404 });
    }
    const product = products[0];

    type InventoryRow = { warehouse_code: string; on_hand_qty: string; available_qty: string; backorder_qty: string; reserved_qty: string };
    const inventoryRows = await prisma.$queryRawUnsafe<InventoryRow[]>(
      `SELECT warehouse_code, on_hand_qty::text, available_qty::text, backorder_qty::text, reserved_qty::text
       FROM shipcore.sc_inventory_snapshot
       WHERE master_sku = $1
       ORDER BY warehouse_code`,
      id
    );

    type MappingRow = { channel_sku: string; channel: string };
    const mappingRows = await prisma.$queryRawUnsafe<MappingRow[]>(
      `SELECT channel_sku, channel FROM shipcore.sc_sku_mappings WHERE master_sku = $1 ORDER BY channel_sku`,
      id
    );

    const salesCount = await prisma.salesRecord.count({ where: { masterSkuCode: id } });

    const inventory = {
      onHand:    inventoryRows.reduce((s, r) => s + Number(r.on_hand_qty  ?? 0), 0),
      available: inventoryRows.reduce((s, r) => s + Number(r.available_qty ?? 0), 0),
      backorder: inventoryRows.reduce((s, r) => s + Number(r.backorder_qty ?? 0), 0),
      reserved:  inventoryRows.reduce((s, r) => s + Number(r.reserved_qty  ?? 0), 0),
    };

    const data = {
      id:            product.master_sku,
      masterSkuCode: product.master_sku,
      name:          product.product_name,
      category:      product.category,
      status:        product.status,
      inventory,
      inventoryByWarehouse: inventoryRows.map((r) => ({
        warehouse: r.warehouse_code,
        onHand:    Number(r.on_hand_qty   ?? 0),
        available: Number(r.available_qty ?? 0),
        backorder: Number(r.backorder_qty ?? 0),
        reserved:  Number(r.reserved_qty  ?? 0),
      })),
      webSkus: mappingRows.map((r) => ({ channelSku: r.channel_sku, channel: r.channel })),
      salesCount,
    };

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error("Error fetching SKU:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
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
