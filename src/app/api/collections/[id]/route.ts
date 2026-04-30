/**
 * Code Guide:
 * This API route owns the collections / [id] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { z } from "zod";

const UpdateCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  colorCode: z.string().optional(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  skuIds: z.array(z.string()).optional(),
});

const AddRemoveSKUSchema = z.object({
  skuId: z.string().min(1),
});

// GET /api/collections/[id] - Get collection details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const collection = await prisma.sKUCollection.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                name: true,
                description: true,
                currentStock: true,
                reorderPoint: true,
                imageUrl: true,
                category: true,
                unitCost: true,
                retailPrice: true,
              },
            },
          },
        },
      },
    });

    if (!collection) {
      return NextResponse.json(
        { success: false, error: "Collection not found" },
        { status: 404 }
      );
    }

    // Get aggregate sales for collection members via sc_sales_order_items
    const skuCodes = collection.members.map((m) => m.sku.skuCode);

    type SalesStatRow = { master_sku: string; qty: string; revenue: string; cnt: string };
    let salesStatRows: SalesStatRow[] = [];
    if (skuCodes.length > 0) {
      const pool = getPrimaryPool();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { rows } = await pool.query<SalesStatRow>(
        `SELECT i.master_sku,
                COALESCE(SUM(i.quantity), 0)::text AS qty,
                COALESCE(SUM(i.line_total), 0)::text AS revenue,
                COUNT(*)::text AS cnt
         FROM shipcore.sc_sales_order_items i
         JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
         WHERE i.master_sku = ANY($1::text[])
           AND o.order_date >= $2
           AND i.is_counted_in_demand = true
         GROUP BY i.master_sku`,
        [skuCodes, thirtyDaysAgo]
      );
      salesStatRows = rows;
    }

    const statsByMasterSku = new Map(salesStatRows.map((s) => [s.master_sku, s]));

    // Enhance collection data with sales stats
    const enhancedMembers = collection.members.map((member) => {
      const stats = statsByMasterSku.get(member.sku.skuCode);
      return {
        ...member,
        salesLast30Days: parseInt(stats?.qty ?? "0", 10),
        revenueLast30Days: parseFloat(stats?.revenue ?? "0"),
        orderCountLast30Days: parseInt(stats?.cnt ?? "0", 10),
      };
    });

    const response = {
      ...collection,
      members: enhancedMembers,
      totalSalesLast30Days: salesStatRows.reduce((sum, s) => sum + parseInt(s.qty, 10), 0),
      totalRevenueLast30Days: salesStatRows.reduce((sum, s) => sum + parseFloat(s.revenue), 0),
      totalStock: collection.members.reduce(
        (sum, m) => sum + m.sku.currentStock,
        0
      ),
    };

    return NextResponse.json({ success: true, data: response });
  } catch (error: any) {
    console.error("Error fetching collection:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/collections/[id] - Update collection
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = UpdateCollectionSchema.parse(body);

    const { skuIds, ...collectionData } = validatedData;

    // If skuIds are provided, update the members
    const updateData: any = { ...collectionData };

    if (skuIds !== undefined) {
      // Delete existing members and create new ones
      updateData.members = {
        deleteMany: {},
        create: skuIds.map((skuId, index) => ({
          skuId,
          sortOrder: index,
        })),
      };
    }

    const collection = await prisma.sKUCollection.update({
      where: { id },
      data: updateData,
      include: {
        members: {
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ success: true, data: collection });
  } catch (error: any) {
    console.error("Error updating collection:", error);

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

// DELETE /api/collections/[id] - Delete collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await prisma.sKUCollection.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: "Collection deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting collection:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
