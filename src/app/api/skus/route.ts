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

// GET /api/skus - List all SKUs aggregated by master SKU
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Pagination
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const skip = (page - 1) * limit;

    // Sorting
    const sortBy = searchParams.get("sortBy") || "masterSkuCode";
    const sortOrder = searchParams.get("sortOrder") || "asc";

    // Filters
    const category = searchParams.get("category");
    const search = searchParams.get("search");

    const validPeriods = [30, 60, 90, 365];
    const salesPeriod = parseInt(searchParams.get("salesPeriod") || "30");
    const salesPeriodDays = validPeriods.includes(salesPeriod) ? salesPeriod : 30;

    // Calculate date ranges
    const now = new Date();
    const salesStartDate = new Date(now.getTime() - salesPeriodDays * 24 * 60 * 60 * 1000);

    // Build where clause for master SKU filtering
    const where: {
      masterSkuCode: { not: null };
      category?: string;
      OR?: Array<
        | { masterSkuCode: { contains: string; mode: "insensitive" } }
        | { skuCode: { contains: string; mode: "insensitive" } }
        | { name: { contains: string; mode: "insensitive" } }
        | { description: { contains: string; mode: "insensitive" } }
      >;
    } = {
      masterSkuCode: { not: null }, // Only include SKUs with master SKU
    };

    if (category) where.category = category;
    if (search) {
      where.OR = [
        { masterSkuCode: { contains: search, mode: "insensitive" } },
        { skuCode: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // Group by master SKU first so the table shows one business row per product
    // family instead of one row per web variant.
    const masterSkuGroups = await prisma.sKU.groupBy({
      by: ["masterSkuCode"],
      where,
      _count: { id: true },
      _sum: { currentStock: true },
    });

    const total = masterSkuGroups.length;
    const allMasterSkuCodes = masterSkuGroups
      .map((g) => g.masterSkuCode)
      .filter((code): code is string => code !== null);

    // Maps make it cheap to join several aggregate queries into one response
    // object without repeatedly scanning arrays.
    const webSkuCounts = new Map(
      masterSkuGroups.map((g) => [g.masterSkuCode, g._count.id])
    );
    const stockTotals = new Map(
      masterSkuGroups.map((g) => [g.masterSkuCode, g._sum.currentStock || 0])
    );

    // Fetch ALL representative SKUs for display info
    const representativeSkus = await prisma.sKU.findMany({
      where: {
        masterSkuCode: { in: allMasterSkuCodes },
      },
      distinct: ["masterSkuCode"],
      select: {
        id: true,
        masterSkuCode: true,
        name: true,
        description: true,
        category: true,
        unitCost: true,
        retailPrice: true,
        reorderPoint: true,
      },
    });

    const repSkuMap = new Map(representativeSkus.map((s) => [s.masterSkuCode, s]));
    const skuRecords = await prisma.sKU.findMany({
      where: {
        masterSkuCode: { in: allMasterSkuCodes },
      },
      select: {
        id: true,
        masterSkuCode: true,
      },
    });

    const skuIdToMaster = new Map(
      skuRecords
        .filter((s): s is { id: string; masterSkuCode: string } => Boolean(s.masterSkuCode))
        .map((s) => [s.id, s.masterSkuCode])
    );

    const inventoryBalances = await prisma.inventoryBalance.findMany({
      where: {
        skuId: { in: skuRecords.map((s) => s.id) },
      },
      select: {
        skuId: true,
        onHandQty: true,
        reservedQty: true,
        allocatedQty: true,
        backorderQty: true,
        inboundQty: true,
        availableQty: true,
      },
    });

    const inventoryMap = new Map<
      string,
      {
        onHand: number;
        reserved: number;
        allocated: number;
        backorder: number;
        inbound: number;
        available: number;
      }
    >();

    for (const balance of inventoryBalances) {
      const masterSkuCode = skuIdToMaster.get(balance.skuId);
      if (!masterSkuCode) continue;

      const current = inventoryMap.get(masterSkuCode) ?? {
        onHand: 0,
        reserved: 0,
        allocated: 0,
        backorder: 0,
        inbound: 0,
        available: 0,
      };

      current.onHand += balance.onHandQty;
      current.reserved += balance.reservedQty;
      current.allocated += balance.allocatedQty;
      current.backorder += balance.backorderQty;
      current.inbound += balance.inboundQty;
      current.available += balance.availableQty;

      inventoryMap.set(masterSkuCode, current);
    }

    // Sales are summed across every child SKU that shares the same master code.
    const salesByMasterSku = await prisma.salesRecord.groupBy({
      by: ["masterSkuCode"],
      where: {
        masterSkuCode: { in: allMasterSkuCodes },
        saleDate: { gte: salesStartDate },
      },
      _sum: { quantity: true },
    });

    const salesMap = new Map(
      salesByMasterSku.map((s) => [s.masterSkuCode, s._sum.quantity || 0])
    );

    // Build complete data for ALL master SKUs
    const allData = allMasterSkuCodes.map((masterSkuCode) => {
      const rep = repSkuMap.get(masterSkuCode);

      return {
        id: rep?.id || masterSkuCode,
        masterSkuCode,
        skuCode: masterSkuCode,
        name: rep?.name || masterSkuCode,
        description: rep?.description || null,
        category: rep?.category || null,
        currentStock: inventoryMap.get(masterSkuCode)?.available || stockTotals.get(masterSkuCode) || 0,
        reorderPoint: rep?.reorderPoint || null,
        unitCost: rep?.unitCost || null,
        retailPrice: rep?.retailPrice || null,
        webSkuCount: webSkuCounts.get(masterSkuCode) || 0,
        inventory: {
          onHand: inventoryMap.get(masterSkuCode)?.onHand || 0,
          reserved: inventoryMap.get(masterSkuCode)?.reserved || 0,
          allocated: inventoryMap.get(masterSkuCode)?.allocated || 0,
          backorder: inventoryMap.get(masterSkuCode)?.backorder || 0,
          inbound: inventoryMap.get(masterSkuCode)?.inbound || 0,
          available: inventoryMap.get(masterSkuCode)?.available || 0,
        },
        _count: {
          salesRecords: salesMap.get(masterSkuCode) || 0,
        },
        salesSummary: {
          totalQuantity: salesMap.get(masterSkuCode) || 0,
          days: salesPeriodDays,
        },
      };
    });

    // Sorting before pagination keeps the global order stable across pages.
    const sortedData = [...allData].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "salesRecords":
          cmp = a.salesSummary.totalQuantity - b.salesSummary.totalQuantity;
          break;
        case "currentStock":
          cmp = a.inventory.available - b.inventory.available;
          break;
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "masterSkuCode":
        default:
          cmp = (a.masterSkuCode || "").localeCompare(b.masterSkuCode || "");
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });

    // Paginate AFTER sorting
    const paginatedData = sortedData.slice(skip, skip + limit);

    return NextResponse.json({
      success: true,
      data: paginatedData,
      periods: {
        sales: salesPeriodDays,
      },
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
