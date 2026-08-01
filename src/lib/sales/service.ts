/**
 * Business logic for the Sales page: platform/date-range querying (flat or
 * grouped-by-period) and the CSV import pipeline (row validation, missing-SKU
 * auto-creation, order/item upsert). The import writes are intentionally not
 * wrapped in a DB transaction — matching the original route, each row's
 * upserts auto-commit independently, so one bad row after N good ones
 * doesn't roll back the N that already landed.
 */

import { z } from "zod";
import { CacheManager } from "@/lib/redis";
import { ValidationError } from "@/lib/errors";
import { SalesRepository, type SalesFilters } from "@/lib/sales/repository";

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

export interface ImportSummary {
  summary: { total: number; imported: number; failed: number; skipped: number; skusCreated: number };
  createdSkus: string[];
  results: ImportResult[];
  hasMoreResults: boolean;
}

export const SalesService = {
  async listGrouped(filters: SalesFilters, groupBy: string) {
    const dateTrunc = groupBy === "month" ? "month" : groupBy === "week" ? "week" : "day";
    return SalesRepository.listGrouped(filters, dateTrunc);
  },

  async listPaged(filters: SalesFilters, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const { rows, total } = await SalesRepository.listPaged(filters, limit, offset);
    return {
      rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async importRows(rows: Record<string, string>[]): Promise<ImportSummary> {
    if (rows.length > 5000) {
      throw new ValidationError("Maximum 5000 rows allowed per import");
    }

    const skuCodes = [...new Set(rows.map((r) => r.sku_code?.trim()).filter(Boolean))];
    const existingSkus = await SalesRepository.findSkusByCode(skuCodes);
    const skuSet = new Set(existingSkus.map((s) => s.skuCode));

    const missingSkuCodes = skuCodes.filter((code) => !skuSet.has(code));
    const createdSkuCodes: string[] = [];

    if (missingSkuCodes.length > 0) {
      const newSkus = await SalesRepository.createMissingSkus(missingSkuCodes);
      for (const s of newSkus) {
        skuSet.add(s.skuCode);
        createdSkuCodes.push(s.skuCode);
      }
    }

    const results: ImportResult[] = [];
    const validRecords: {
      skuCode: string; platform: string; orderId: string; orderType: string;
      saleDate: Date; quantity: number; unitPrice: number; totalAmount: number; fulfilled: boolean;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

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
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.issues.map((i) => i.message).join(", ");
          results.push({ row: rowNum, sku_code: row.sku_code || "unknown", success: false, error: issues });
        } else {
          results.push({ row: rowNum, sku_code: row.sku_code || "unknown", success: false, error: error instanceof Error ? error.message : "Unknown error" });
        }
      }
    }

    let insertedCount = 0;
    if (validRecords.length > 0) {
      await SalesRepository.withClient(async (client) => {
        const orderMap = new Map<string, { platform: string; saleDate: Date; totalAmount: number; isCounted: boolean }>();
        for (const r of validRecords) {
          const isCounted = r.orderType === "actual_sale";
          if (!orderMap.has(r.orderId)) {
            orderMap.set(r.orderId, { platform: r.platform, saleDate: r.saleDate, totalAmount: 0, isCounted });
          }
          orderMap.get(r.orderId)!.totalAmount += r.totalAmount;
        }

        const internalOrderIdMap = new Map<string, string>();
        for (const [externalOrderId, order] of orderMap) {
          const orderId = await SalesRepository.upsertOrder(client, {
            externalOrderId,
            platform: order.platform,
            saleDate: order.saleDate,
            totalAmount: order.totalAmount,
            isCounted: order.isCounted,
          });
          internalOrderIdMap.set(externalOrderId, orderId);
        }

        for (const r of validRecords) {
          const orderId = internalOrderIdMap.get(r.orderId)!;
          const isCounted = r.orderType === "actual_sale";
          const lineItemId = `${r.orderId}-${r.skuCode}`;

          await SalesRepository.upsertOrderItem(client, {
            orderId,
            platform: r.platform,
            lineItemId,
            skuCode: r.skuCode,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            totalAmount: r.totalAmount,
            fulfillmentStatus: r.fulfilled ? "Shipped" : "Unshipped",
            isCounted,
          });
          insertedCount++;
        }
      });

      await CacheManager.delete("dashboard:analytics");
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
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
    };
  },
};
