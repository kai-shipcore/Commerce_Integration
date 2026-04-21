/**
 * Code Guide:
 * This API route owns the sales / import backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { CacheManager } from "@/lib/redis";
import { z } from "zod";

// Schema for each row in the CSV
const SalesRowSchema = z.object({
  sku_code: z.string().min(1, "SKU code is required"),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  quantity: z.coerce.number().int().positive("Quantity must be a positive integer"),
  unit_price: z.coerce.number().positive("Unit price must be positive"),
  platform: z.string().optional().default("manual"),
  order_id: z.string().optional(),
  order_type: z.enum(["actual_sale", "pre_order"]).optional().default("actual_sale"),
  fulfilled: z.string().optional().transform((val) => {
    if (!val) return false;
    return ["yes", "true", "1", "y"].includes(val.toLowerCase());
  }),
  fulfilled_date: z.string().optional().transform((val) => {
    if (!val) return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
  }),
  notes: z.string().optional(),
});

type SalesRow = z.infer<typeof SalesRowSchema>;

interface ImportResult {
  row: number;
  sku_code: string;
  success: boolean;
  error?: string;
  skuCreated?: boolean;
}

// POST /api/sales/import - Import sales records from CSV data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows } = body as { rows: Record<string, string>[] };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No data provided" },
        { status: 400 }
      );
    }

    if (rows.length > 5000) {
      return NextResponse.json(
        { success: false, error: "Maximum 5000 rows allowed per import" },
        { status: 400 }
      );
    }

    // Gather the full SKU set up front so missing SKUs can be created in one
    // pass instead of failing row-by-row later.
    const skuCodes = [...new Set(rows.map((r) => r.sku_code?.trim()).filter(Boolean))];

    // Look up all SKUs at once
    const existingSkus = await prisma.sKU.findMany({
      where: { skuCode: { in: skuCodes } },
      select: { id: true, skuCode: true },
    });

    const skuMap = new Map(existingSkus.map((s) => [s.skuCode, s.id]));

    // Find SKU codes that don't exist
    const missingSkuCodes = skuCodes.filter((code) => !skuMap.has(code));
    const createdSkuCodes: string[] = [];

    // Create missing SKUs
    if (missingSkuCodes.length > 0) {
      const newSkus = await prisma.sKU.createManyAndReturn({
        data: missingSkuCodes.map((code) => ({
          skuCode: code,
          name: code, // Use SKU code as name initially
          currentStock: 0,
        })),
        select: { id: true, skuCode: true },
      });

      // Add new SKUs to the map
      newSkus.forEach((s) => {
        skuMap.set(s.skuCode, s.id);
        createdSkuCodes.push(s.skuCode);
      });
    }

    const results: ImportResult[] = [];
    const validRecords: {
      skuId: string;
      platform: string;
      orderId: string;
      orderType: string;
      saleDate: Date;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      fulfilled: boolean;
      fulfilledDate: Date | null;
      notes: string | null;
    }[] = [];

    // Validate rows independently so one malformed line does not block the rest
    // of the CSV from importing.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row and 0-index

      try {
        // Parse and validate the row
        const parsed = SalesRowSchema.parse(row);

        // Get SKU ID (guaranteed to exist now since we created missing ones)
        const skuCode = parsed.sku_code.trim();
        const skuId = skuMap.get(skuCode);
        if (!skuId) {
          // This shouldn't happen, but handle it gracefully
          results.push({
            row: rowNum,
            sku_code: parsed.sku_code,
            success: false,
            error: `Failed to find or create SKU "${parsed.sku_code}"`,
          });
          continue;
        }

        // Calculate total amount
        const totalAmount = parsed.quantity * parsed.unit_price;

        // Generate order ID if not provided
        const orderId = parsed.order_id || `IMP-${Date.now()}-${i}`;

        validRecords.push({
          skuId,
          platform: parsed.platform || "manual",
          orderId,
          orderType: parsed.order_type || "actual_sale",
          saleDate: new Date(parsed.sale_date),
          quantity: parsed.quantity,
          unitPrice: parsed.unit_price,
          totalAmount,
          fulfilled: parsed.fulfilled || false,
          fulfilledDate: parsed.fulfilled_date || null,
          notes: parsed.notes || null,
        });

        // Check if this SKU was newly created
        const wasCreated = createdSkuCodes.includes(skuCode);

        results.push({
          row: rowNum,
          sku_code: parsed.sku_code,
          success: true,
          skuCreated: wasCreated,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          const issues = error.issues.map((i) => i.message).join(", ");
          results.push({
            row: rowNum,
            sku_code: row.sku_code || "unknown",
            success: false,
            error: issues,
          });
        } else {
          results.push({
            row: rowNum,
            sku_code: row.sku_code || "unknown",
            success: false,
            error: error.message || "Unknown error",
          });
        }
      }
    }

    // Batch inserts reduce database round-trips for large uploads.
    let insertedCount = 0;
    if (validRecords.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < validRecords.length; i += batchSize) {
        const batch = validRecords.slice(i, i + batchSize);
        await prisma.salesRecord.createMany({
          data: batch,
        });
        insertedCount += batch.length;
      }

      // Invalidate relevant caches
      await CacheManager.delete("dashboard:analytics");
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const skusCreatedCount = createdSkuCodes.length;

    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        imported: insertedCount,
        failed: failCount,
        skipped: rows.length - successCount - failCount,
        skusCreated: skusCreatedCount,
      },
      createdSkus: createdSkuCodes,
      results: results.slice(0, 100), // Limit results to first 100 for response size
      hasMoreResults: results.length > 100,
    });
  } catch (error: any) {
    console.error("Error importing sales:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET /api/sales/import/template - Download CSV template
export async function GET() {
  const template = `sku_code,sale_date,quantity,unit_price,platform,order_id,order_type,fulfilled,fulfilled_date,notes
ABC-123,2024-01-15,10,29.99,shopify,ORD-001,actual_sale,yes,2024-01-16,Sample order
XYZ-456,2024-01-16,5,49.99,amazon,,actual_sale,no,,
DEF-789,2024-01-17,3,19.99,manual,,pre_order,no,,Pre-order for upcoming release`;

  return new NextResponse(template, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=sales-import-template.csv",
    },
  });
}
