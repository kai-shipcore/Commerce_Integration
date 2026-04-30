/**
 * Code Guide:
 * This API route owns the skus / backfill-master backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { lookupMasterSkusFromSupabase, testLookupConnection } from "@/lib/db/supabase-lookup";

/**
 * POST /api/skus/backfill-master
 * Backfill master SKU codes for existing SKUs and SalesRecords
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get("batchSize") || "500");
    const skipSalesRecords = searchParams.get("skipSalesRecords") === "true";

    const results = {
      skusUpdated: 0,
      skusWithMasterSku: 0,
      salesRecordsUpdated: 0,
      errors: [] as string[],
      lookupAvailable: true,
    };

    // Test if lookup function is available
    const connectionTest = await testLookupConnection();
    if (!connectionTest.available) {
      results.lookupAvailable = false;
      return NextResponse.json({
        success: false,
        error: connectionTest.error || "Master SKU lookup not available. Set DATABASE_URL or SUPABASE_LOOKUP_DATABASE_URL in your environment.",
        results,
      });
    }

    // Step 1: Get all SKUs without masterSkuCode
    console.log("Fetching SKUs without master SKU...");
    const skusWithoutMaster = await prisma.sKU.findMany({
      where: { masterSkuCode: null },
      select: { id: true, skuCode: true },
    });

    console.log(`Found ${skusWithoutMaster.length} SKUs without master SKU`);

    // Process in batches
    for (let i = 0; i < skusWithoutMaster.length; i += batchSize) {
      const batch = skusWithoutMaster.slice(i, i + batchSize);
      const skuCodes = batch.map(s => s.skuCode);

      try {
        const masterSkuLookup = await lookupMasterSkusFromSupabase(skuCodes);
        if (!masterSkuLookup) continue; // Skip if lookup not available

        // Update each SKU with its master SKU
        for (const sku of batch) {
          const masterInfo = masterSkuLookup.get(sku.skuCode);
          if (masterInfo?.parse1) {
            await prisma.sKU.update({
              where: { id: sku.id },
              data: { masterSkuCode: masterInfo.parse1 },
            });
            results.skusWithMasterSku++;
          }
          results.skusUpdated++;
        }

        console.log(`Processed ${Math.min(i + batchSize, skusWithoutMaster.length)}/${skusWithoutMaster.length} SKUs`);
      } catch (error: any) {
        results.errors.push(`Batch ${i}-${i + batchSize}: ${error.message}`);
      }
    }

    // Step 2: Update sc_sales_order_items with master SKU codes
    if (!skipSalesRecords) {
      console.log("Updating sc_sales_order_items with master SKU codes...");

      const pool = getPrimaryPool();

      // Find distinct channel_skus in sc_sales_order_items where master_sku is NULL
      const { rows: nullSkuRows } = await pool.query<{ channel_sku: string }>(
        `SELECT DISTINCT channel_sku FROM shipcore.sc_sales_order_items WHERE master_sku IS NULL AND channel_sku IS NOT NULL`
      );

      const channelSkus = nullSkuRows.map((r) => r.channel_sku);
      console.log(`Found ${channelSkus.length} distinct channel SKUs needing master SKU`);

      // Process in batches
      for (let i = 0; i < channelSkus.length; i += batchSize) {
        const batch = channelSkus.slice(i, i + batchSize);

        try {
          const masterSkuLookup = await lookupMasterSkusFromSupabase(batch);
          if (!masterSkuLookup) continue;

          for (const channelSku of batch) {
            const masterInfo = masterSkuLookup.get(channelSku);
            if (masterInfo?.parse1) {
              const { rowCount } = await pool.query(
                `UPDATE shipcore.sc_sales_order_items SET master_sku = $1 WHERE channel_sku = $2 AND master_sku IS NULL`,
                [masterInfo.parse1, channelSku]
              );
              results.salesRecordsUpdated += rowCount ?? 0;
            }
          }

          console.log(`Processed ${Math.min(i + batchSize, channelSkus.length)}/${channelSkus.length} channel SKUs, ${results.salesRecordsUpdated} rows updated`);
        } catch (error: any) {
          results.errors.push(`Sales lookup batch ${i}: ${error.message}`);
        }
      }

      console.log(`Completed: Updated ${results.salesRecordsUpdated} sc_sales_order_items rows`);
    }

    return NextResponse.json({
      success: true,
      message: "Backfill completed",
      results,
    });
  } catch (error: any) {
    console.error("Backfill error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/skus/backfill-master
 * Get stats on how many records need backfill
 */
export async function GET() {
  try {
    const [skusWithoutMaster, skusWithMaster] = await Promise.all([
      prisma.sKU.count({ where: { masterSkuCode: null } }),
      prisma.sKU.count({ where: { masterSkuCode: { not: null } } }),
    ]);

    const pool = getPrimaryPool();
    const [withoutRes, withRes] = await Promise.all([
      pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM shipcore.sc_sales_order_items WHERE master_sku IS NULL`),
      pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM shipcore.sc_sales_order_items WHERE master_sku IS NOT NULL`),
    ]);

    const salesWithoutMaster = parseInt(withoutRes.rows[0]?.cnt ?? "0", 10);
    const salesWithMaster = parseInt(withRes.rows[0]?.cnt ?? "0", 10);

    return NextResponse.json({
      success: true,
      stats: {
        skus: {
          withoutMasterSku: skusWithoutMaster,
          withMasterSku: skusWithMaster,
          total: skusWithoutMaster + skusWithMaster,
        },
        salesRecords: {
          withoutMasterSku: salesWithoutMaster,
          withMasterSku: salesWithMaster,
          total: salesWithoutMaster + salesWithMaster,
        },
      },
    });
  } catch (error: any) {
    console.error("Stats error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
