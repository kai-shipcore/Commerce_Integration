import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getLookupPool } from "@/lib/db/supabase-lookup";

export async function GET() {
  try {
    // Step 1: Not Ready + orderRequest > 0 인 Part SKU 목록 (primary DB)
    const partSkus = await prisma.$queryRaw<{ sku: string }[]>`
      SELECT DISTINCT "partSkuValue" AS sku
      FROM shipcore.fc_replacement_parts
      WHERE "partSkuValue" IS NOT NULL
        AND "shippingStatus" = 'Not Ready'
        AND "deleteYN" = 'N'
        AND "orderRequest" ~ '^[0-9]+$'
        AND "orderRequest"::int > 0
      ORDER BY "partSkuValue"
    `;

    if (partSkus.length === 0) {
      console.log("[dashboard/part-rows] no qualifying part SKUs");
      return NextResponse.json({ success: true, rows: [] });
    }

    const skuList = partSkus.map((r) => r.sku);

    // Step 2: backorder from Supabase coverland_inventory (same source as Original/Custom)
    const pool = getLookupPool();
    const backMap = new Map<string, number>();

    if (pool) {
      const client = await pool.connect();
      try {
        const result = await client.query<{ sku: string; back: number }>(
          `SELECT
             BTRIM(master_sku) AS sku,
             (-SUM(COALESCE(backorder, 0)))::int AS back
           FROM ecommerce_data.coverland_inventory
           WHERE BTRIM(master_sku) = ANY($1)
           GROUP BY BTRIM(master_sku)`,
          [skuList],
        );
        for (const r of result.rows) {
          backMap.set(r.sku, Number(r.back));
        }
      } finally {
        client.release();
      }
    }

    // Step 3: merge — backorder 없으면 0, orderRequest > 0이면 무조건 표시
    const data = skuList.map((sku) => ({
      sku,
      back: backMap.get(sku) ?? 0,
    }));

    console.log("[dashboard/part-rows] returned", data.length, "rows");
    return NextResponse.json({ success: true, rows: data });
  } catch (err) {
    console.error("[dashboard/part-rows] error", err);
    return NextResponse.json({ success: false, rows: [] }, { status: 500 });
  }
}
