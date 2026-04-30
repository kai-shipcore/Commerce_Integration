/**
 * Code Guide:
 * This API route owns the sales / import backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";
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

    // Look up all SKUs at once (Prisma SKU catalog)
    const existingSkus = await prisma.sKU.findMany({
      where: { skuCode: { in: skuCodes } },
      select: { id: true, skuCode: true },
    });

    const skuSet = new Set(existingSkus.map((s) => s.skuCode));

    // Find SKU codes that don't exist
    const missingSkuCodes = skuCodes.filter((code) => !skuSet.has(code));
    const createdSkuCodes: string[] = [];

    // Create missing SKUs
    if (missingSkuCodes.length > 0) {
      const newSkus = await prisma.sKU.createManyAndReturn({
        data: missingSkuCodes.map((code) => ({
          skuCode: code,
          name: code,
          currentStock: 0,
        })),
        select: { id: true, skuCode: true },
      });

      newSkus.forEach((s) => {
        skuSet.add(s.skuCode);
        createdSkuCodes.push(s.skuCode);
      });
    }

    const results: ImportResult[] = [];
    const validRecords: {
      skuCode: string;
      platform: string;
      orderId: string;
      orderType: string;
      saleDate: Date;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      fulfilled: boolean;
    }[] = [];

    // Validate rows independently so one malformed line does not block the rest
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row and 0-index

      try {
        const parsed = SalesRowSchema.parse(row);
        const skuCode = parsed.sku_code.trim();

        if (!skuSet.has(skuCode)) {
          results.push({ row: rowNum, sku_code: parsed.sku_code, success: false, error: `Failed to find or create SKU "${parsed.sku_code}"` });
          continue;
        }

        const totalAmount = parsed.quantity * parsed.unit_price;
        const orderId = parsed.order_id || `IMP-${Date.now()}-${i}`;

        validRecords.push({
          skuCode,
          platform: parsed.platform || "manual",
          orderId,
          orderType: parsed.order_type || "actual_sale",
          saleDate: new Date(parsed.sale_date),
          quantity: parsed.quantity,
          unitPrice: parsed.unit_price,
          totalAmount,
          fulfilled: parsed.fulfilled || false,
        });

        results.push({ row: rowNum, sku_code: parsed.sku_code, success: true, skuCreated: createdSkuCodes.includes(skuCode) });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          const issues = error.issues.map((i) => i.message).join(", ");
          results.push({ row: rowNum, sku_code: row.sku_code || "unknown", success: false, error: issues });
        } else {
          results.push({ row: rowNum, sku_code: row.sku_code || "unknown", success: false, error: error.message || "Unknown error" });
        }
      }
    }

    let insertedCount = 0;
    if (validRecords.length > 0) {
      const pool = getPrimaryPool();
      const client = await pool.connect();

      try {
        // Group by orderId to build order-level totals
        const orderMap = new Map<string, { platform: string; saleDate: Date; totalAmount: number; isCounted: boolean }>();
        for (const r of validRecords) {
          const isCounted = r.orderType === "actual_sale";
          if (!orderMap.has(r.orderId)) {
            orderMap.set(r.orderId, { platform: r.platform, saleDate: r.saleDate, totalAmount: 0, isCounted });
          }
          orderMap.get(r.orderId)!.totalAmount += r.totalAmount;
        }

        // UPSERT orders
        const internalOrderIdMap = new Map<string, string>();
        for (const [externalOrderId, order] of orderMap) {
          const res = await client.query<{ id: string }>(
            `INSERT INTO shipcore.sc_sales_orders (
               platform_source, external_order_id, order_number,
               order_date, order_status,
               total_price, is_counted_in_demand
             ) VALUES ($1, $2, $2, $3, 'completed', $4, $5)
             ON CONFLICT (external_order_id) DO UPDATE SET
               total_price = EXCLUDED.total_price,
               updated_at  = NOW()
             RETURNING id`,
            [order.platform, externalOrderId, order.saleDate, order.totalAmount, order.isCounted]
          );
          internalOrderIdMap.set(externalOrderId, res.rows[0].id);
        }

        // UPSERT items
        for (const r of validRecords) {
          const orderId = internalOrderIdMap.get(r.orderId)!;
          const isCounted = r.orderType === "actual_sale";
          const lineItemId = `${r.orderId}-${r.skuCode}`;

          await client.query(
            `INSERT INTO shipcore.sc_sales_order_items (
               order_id, platform_source, external_line_item_id,
               master_sku, channel_sku, sku,
               quantity, unit_price, line_total,
               fulfillment_status,
               is_counted_in_demand
             ) VALUES ($1, $2, $3, $4, $4, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (external_line_item_id) DO UPDATE SET
               quantity             = EXCLUDED.quantity,
               unit_price           = EXCLUDED.unit_price,
               line_total           = EXCLUDED.line_total,
               fulfillment_status   = EXCLUDED.fulfillment_status,
               is_counted_in_demand = EXCLUDED.is_counted_in_demand,
               updated_at           = NOW()`,
            [
              orderId, r.platform, lineItemId,
              r.skuCode,
              r.quantity, r.unitPrice, r.totalAmount,
              r.fulfilled ? "Shipped" : "Unshipped",
              isCounted,
            ]
          );
          insertedCount++;
        }
      } finally {
        client.release();
      }

      await CacheManager.delete("dashboard:analytics");
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      summary: {
        total: rows.length,
        imported: insertedCount,
        failed: failCount,
        skipped: rows.length - successCount - failCount,
        skusCreated: createdSkuCodes.length,
      },
      createdSkus: createdSkuCodes,
      results: results.slice(0, 100),
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
