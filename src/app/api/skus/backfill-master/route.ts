/**
 * Code Guide:
 * This API route owns the skus / backfill-master backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
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

    // Step 2: Update SalesRecords with master SKU codes
    if (!skipSalesRecords) {
      console.log("Updating SalesRecords with master SKU codes...");

      // Get all unique SKU IDs from sales records that don't have masterSkuCode
      const salesWithoutMaster = await prisma.salesRecord.findMany({
        where: { masterSkuCode: null },
        select: { id: true, skuId: true },
        distinct: ['skuId'],
      });

      const skuIds = [...new Set(salesWithoutMaster.map(s => s.skuId))];
      console.log(`Found ${skuIds.length} unique SKUs in sales records needing master SKU`);

      // Get SKU codes for these IDs
      const skusForSales = await prisma.sKU.findMany({
        where: { id: { in: skuIds } },
        select: { id: true, skuCode: true, masterSkuCode: true },
      });

      // Build map of skuId -> masterSkuCode (from SKU table)
      const skuIdToMasterMap = new Map<string, string>();
      const skusNeedingLookup: { id: string; skuCode: string }[] = [];

      for (const sku of skusForSales) {
        if (sku.masterSkuCode) {
          skuIdToMasterMap.set(sku.id, sku.masterSkuCode);
        } else {
          skusNeedingLookup.push({ id: sku.id, skuCode: sku.skuCode });
        }
      }

      // Lookup master SKUs for any that don't have it in the SKU table
      if (skusNeedingLookup.length > 0) {
        for (let i = 0; i < skusNeedingLookup.length; i += batchSize) {
          const batch = skusNeedingLookup.slice(i, i + batchSize);
          const skuCodes = batch.map(s => s.skuCode);

          try {
            const masterSkuLookup = await lookupMasterSkusFromSupabase(skuCodes);
            if (!masterSkuLookup) continue; // Skip if lookup not available

            for (const sku of batch) {
              const masterInfo = masterSkuLookup.get(sku.skuCode);
              if (masterInfo?.parse1) {
                skuIdToMasterMap.set(sku.id, masterInfo.parse1);
              }
            }
          } catch (error: any) {
            results.errors.push(`Sales lookup batch ${i}: ${error.message}`);
          }
        }
      }

      // Update sales records in bulk by SKU ID
      const totalSkusToUpdate = skuIdToMasterMap.size;
      let skusProcessed = 0;

      for (const [skuId, masterSkuCode] of skuIdToMasterMap) {
        try {
          const updateResult = await prisma.salesRecord.updateMany({
            where: {
              skuId: skuId,
              masterSkuCode: null,
            },
            data: { masterSkuCode },
          });
          results.salesRecordsUpdated += updateResult.count;
          skusProcessed++;

          // Log progress every 500 SKUs
          if (skusProcessed % 500 === 0 || skusProcessed === totalSkusToUpdate) {
            console.log(`Sales records: ${skusProcessed}/${totalSkusToUpdate} SKUs processed, ${results.salesRecordsUpdated} records updated`);
          }
        } catch (error: any) {
          results.errors.push(`Sales update for SKU ${skuId}: ${error.message}`);
        }
      }

      console.log(`Completed: Updated ${results.salesRecordsUpdated} sales records`);
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
    const [skusWithoutMaster, skusWithMaster, salesWithoutMaster, salesWithMaster] = await Promise.all([
      prisma.sKU.count({ where: { masterSkuCode: null } }),
      prisma.sKU.count({ where: { masterSkuCode: { not: null } } }),
      prisma.salesRecord.count({ where: { masterSkuCode: null } }),
      prisma.salesRecord.count({ where: { masterSkuCode: { not: null } } }),
    ]);

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
