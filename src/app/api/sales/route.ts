/**
 * Code Guide:
 * This API route owns the sales backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

// Validation schema for creating sales records
const SalesRecordSchema = z.object({
  skuId: z.string().min(1),
  platform: z.string().min(1),
  orderId: z.string().min(1),
  orderType: z.enum(["actual_sale", "pre_order"]).default("actual_sale"),
  saleDate: z.string().datetime(),
  quantity: z.number().int().min(1),
  unitPrice: z.number().positive(),
  totalAmount: z.number().positive(),
  fulfilled: z.boolean().default(false),
  fulfilledDate: z.string().datetime().optional(),
});

const BulkSalesSchema = z.array(SalesRecordSchema);

// GET /api/sales - Query sales data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const skuId = searchParams.get("skuId");
    const masterSkuCode = searchParams.get("masterSkuCode");
    const platform = searchParams.get("platform");
    const integrationId = searchParams.get("integrationId");
    const orderType = searchParams.get("orderType");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const groupBy = searchParams.get("groupBy"); // 'day', 'week', 'month'

    // Pagination
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "100");
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    // Support both skuId and masterSkuCode
    if (masterSkuCode) {
      where.masterSkuCode = masterSkuCode;
    } else if (skuId) {
      // If skuId provided, lookup its masterSkuCode for aggregation
      const sku = await prisma.sKU.findUnique({
        where: { id: skuId },
        select: { masterSkuCode: true },
      });
      if (sku?.masterSkuCode) {
        where.masterSkuCode = sku.masterSkuCode;
      } else {
        where.skuId = skuId;
      }
    }

    if (platform) where.platform = platform;
    if (integrationId) where.integrationId = integrationId;
    if (orderType) where.orderType = orderType;

    if (startDate || endDate) {
      where.saleDate = {};
      if (startDate) where.saleDate.gte = new Date(startDate);
      if (endDate) where.saleDate.lte = new Date(endDate);
    }

    // If groupBy is specified, return aggregated data
    if (groupBy && (skuId || masterSkuCode)) {
      const salesData = await prisma.salesRecord.findMany({
        where,
        select: {
          saleDate: true,
          quantity: true,
          totalAmount: true,
        },
        orderBy: { saleDate: "asc" },
      });

      // Group by specified period
      const grouped = salesData.reduce((acc: any, record) => {
        let key: string;
        const date = new Date(record.saleDate);

        if (groupBy === "day") {
          key = date.toISOString().split("T")[0];
        } else if (groupBy === "week") {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
        } else if (groupBy === "month") {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        } else {
          key = date.toISOString().split("T")[0];
        }

        if (!acc[key]) {
          acc[key] = {
            date: key,
            totalQuantity: 0,
            totalRevenue: 0,
            orderCount: 0,
          };
        }

        acc[key].totalQuantity += record.quantity;
        acc[key].totalRevenue += Number(record.totalAmount);
        acc[key].orderCount += 1;

        return acc;
      }, {});

      const result = Object.values(grouped);

      return NextResponse.json({
        success: true,
        data: result,
        groupBy,
      });
    }

    // Otherwise return individual records
    const [sales, total] = await Promise.all([
      prisma.salesRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { saleDate: "desc" },
        include: {
          sku: {
            select: {
              id: true,
              skuCode: true,
              name: true,
            },
          },
          integration: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.salesRecord.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: sales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Error fetching sales:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/sales - Create sales record(s)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if it's a single record or bulk
    const isBulk = Array.isArray(body);

    if (isBulk) {
      // Validate bulk data
      const validatedData = BulkSalesSchema.parse(body);

      // Create all records
      const created = await prisma.salesRecord.createMany({
        data: validatedData.map((record) => ({
          ...record,
          saleDate: new Date(record.saleDate),
          fulfilledDate: record.fulfilledDate
            ? new Date(record.fulfilledDate)
            : null,
        })),
        skipDuplicates: true,
      });

      return NextResponse.json(
        {
          success: true,
          message: `${created.count} sales records created`,
          count: created.count,
        },
        { status: 201 }
      );
    } else {
      // Single record
      const validatedData = SalesRecordSchema.parse(body);

      // Verify SKU exists
      const sku = await prisma.sKU.findUnique({
        where: { id: validatedData.skuId },
      });

      if (!sku) {
        return NextResponse.json(
          { success: false, error: "SKU not found" },
          { status: 404 }
        );
      }

      // Create sales record
      const sale = await prisma.salesRecord.create({
        data: {
          ...validatedData,
          saleDate: new Date(validatedData.saleDate),
          fulfilledDate: validatedData.fulfilledDate
            ? new Date(validatedData.fulfilledDate)
            : null,
        },
        include: {
          sku: {
            select: {
              id: true,
              skuCode: true,
              name: true,
            },
          },
          integration: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return NextResponse.json(
        { success: true, data: sale },
        { status: 201 }
      );
    }
  } catch (error: any) {
    console.error("Error creating sales record:", error);

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
