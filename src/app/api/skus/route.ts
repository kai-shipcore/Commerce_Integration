/**
 * Code Guide:
 * This API route owns the skus backend workflow.
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

// Validation schema for creating/updating SKUs
const SKUSchema = z.object({
  skuCode: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  currentStock: z.number().int().min(0).default(0),
  reorderPoint: z.number().int().min(0).optional(),
  isCustomVariant: z.boolean().default(false),
  parentSKUId: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string()).default([]),
  unitCost: z.number().positive().optional(),
  retailPrice: z.number().positive().optional(),
  shopifyProductId: z.string().optional(),
  amazonASIN: z.string().optional(),
  walmartItemId: z.string().optional(),
  ebayItemId: z.string().optional(),
});

// GET /api/skus - List products from sc_products + sc_inventory_snapshot
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const offset = (page - 1) * limit;

    const rawSortBy = searchParams.get("sortBy") || "masterSkuCode";
    const sortOrder = searchParams.get("sortOrder") === "desc" ? "DESC" : "ASC";
    const sortColMap: Record<string, string> = {
      masterSkuCode: "p.master_sku",
      name: "p.product_name",
      available: "inv_available",
      onHand: "inv_on_hand",
      backorder: "inv_backorder",
      salesRecords: "p.master_sku",
    };
    const sortCol = sortColMap[rawSortBy] ?? "p.master_sku";

    const search = searchParams.get("search")?.trim() || "";
    const searchParam = search ? `%${search}%` : null;

    const validPeriods = [30, 60, 90, 365];
    const salesPeriodDays = validPeriods.includes(parseInt(searchParams.get("salesPeriod") || ""))
      ? parseInt(searchParams.get("salesPeriod")!)
      : 30;
    const salesStartDate = new Date(Date.now() - salesPeriodDays * 24 * 60 * 60 * 1000);

    type CountRow = { count: bigint };
    const countResult = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM shipcore.sc_products p
       WHERE $1::text IS NULL OR p.master_sku ILIKE $1 OR p.product_name ILIKE $1`,
      searchParam
    );
    const total = Number(countResult[0]?.count ?? 0);

    type ProductRow = {
      master_sku: string;
      product_name: string;
      category: string | null;
      inv_on_hand: string | null;
      inv_available: string | null;
      inv_backorder: string | null;
      inv_reserved: string | null;
    };
    const rows = await prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT
         p.master_sku,
         p.product_name,
         p.category,
         COALESCE(SUM(i.on_hand_qty), 0)::text  AS inv_on_hand,
         COALESCE(SUM(i.available_qty), 0)::text AS inv_available,
         COALESCE(SUM(i.backorder_qty), 0)::text AS inv_backorder,
         COALESCE(SUM(i.reserved_qty), 0)::text  AS inv_reserved
       FROM shipcore.sc_products p
       LEFT JOIN shipcore.sc_inventory_snapshot i ON i.master_sku = p.master_sku
       WHERE $1::text IS NULL OR p.master_sku ILIKE $1 OR p.product_name ILIKE $1
       GROUP BY p.master_sku, p.product_name, p.category
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $2 OFFSET $3`,
      searchParam,
      limit,
      offset
    );

    const masterSkuCodes = rows.map((r) => r.master_sku);
    const salesByMasterSku =
      masterSkuCodes.length > 0
        ? await prisma.salesRecord.groupBy({
            by: ["masterSkuCode"],
            where: {
              masterSkuCode: { in: masterSkuCodes },
              saleDate: { gte: salesStartDate },
            },
            _sum: { quantity: true },
          })
        : [];
    const salesMap = new Map(salesByMasterSku.map((s) => [s.masterSkuCode, s._sum.quantity || 0]));

    const data = rows.map((row) => ({
      id: row.master_sku,
      masterSkuCode: row.master_sku,
      skuCode: row.master_sku,
      name: row.product_name,
      description: null,
      category: row.category ?? null,
      currentStock: Number(row.inv_available ?? 0),
      reorderPoint: null,
      unitCost: null,
      retailPrice: null,
      inventory: {
        onHand: Number(row.inv_on_hand ?? 0),
        reserved: Number(row.inv_reserved ?? 0),
        allocated: 0,
        backorder: Number(row.inv_backorder ?? 0),
        inbound: 0,
        available: Number(row.inv_available ?? 0),
      },
      _count: { salesRecords: salesMap.get(row.master_sku) || 0 },
      salesSummary: {
        totalQuantity: salesMap.get(row.master_sku) || 0,
        days: salesPeriodDays,
      },
    }));

    return NextResponse.json({
      success: true,
      data,
      periods: { sales: salesPeriodDays },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching SKUs:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/skus - Create a new SKU
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validatedData = SKUSchema.parse(body);

    // Check if SKU code already exists
    const existing = await prisma.sKU.findUnique({
      where: { skuCode: validatedData.skuCode },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "SKU code already exists" },
        { status: 400 }
      );
    }

    // If custom variant, verify parent exists
    if (validatedData.isCustomVariant && validatedData.parentSKUId) {
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
      const createdSku = await tx.sKU.create({
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

      if (defaultLocation) {
        await tx.inventoryBalance.create({
          data: {
            skuId: createdSku.id,
            locationId: defaultLocation.id,
            onHandQty: validatedData.currentStock,
            availableQty: validatedData.currentStock,
          },
        });
      }

      return createdSku;
    });

    // Invalidate dashboard cache (new SKU affects totals)
    await CacheManager.delete("dashboard:analytics");

    return NextResponse.json(
      { success: true, data: sku },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating SKU:", error);

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
