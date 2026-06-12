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
    type InvRow = { sku: string; west_stock: number; east_stock: number; total_stock: number; west_avail: number; east_avail: number; back: number };
    const invMap = new Map<string, InvRow>();

    if (pool) {
      const client = await pool.connect();
      try {
        const result = await client.query<InvRow>(
          `SELECT
             BTRIM(master_sku) AS sku,
             SUM(CASE WHEN warehouse = 'Fullerton'  THEN COALESCE(on_hand, 0) ELSE 0 END)::int AS west_stock,
             SUM(CASE WHEN warehouse = 'TTM Group'  THEN COALESCE(on_hand, 0) ELSE 0 END)::int AS east_stock,
             SUM(COALESCE(on_hand, 0))::int                                                       AS total_stock,
             SUM(CASE WHEN warehouse = 'Fullerton'  THEN COALESCE(available, 0) ELSE 0 END)::int AS west_avail,
             SUM(CASE WHEN warehouse = 'TTM Group'  THEN COALESCE(available, 0) ELSE 0 END)::int AS east_avail,
             (-SUM(COALESCE(backorder, 0)))::int                                                  AS back
           FROM ecommerce_data.coverland_inventory
           WHERE BTRIM(master_sku) = ANY($1)
           GROUP BY BTRIM(master_sku)`,
          [skuList],
        );
        for (const r of result.rows) {
          invMap.set(r.sku, {
            sku: r.sku,
            west_stock: Number(r.west_stock),
            east_stock: Number(r.east_stock),
            total_stock: Number(r.total_stock),
            west_avail: Number(r.west_avail),
            east_avail: Number(r.east_avail),
            back: Number(r.back),
          });
        }
      } finally {
        client.release();
      }
    }

    // Step 3: merge — 인벤토리 없으면 0, orderRequest > 0이면 무조건 표시
    const data = skuList.map((sku) => ({
      sku,
      west_stock:  invMap.get(sku)?.west_stock  ?? 0,
      east_stock:  invMap.get(sku)?.east_stock  ?? 0,
      total_stock: invMap.get(sku)?.total_stock ?? 0,
      west_avail:  invMap.get(sku)?.west_avail  ?? 0,
      east_avail:  invMap.get(sku)?.east_avail  ?? 0,
      back:        invMap.get(sku)?.back        ?? 0,
    }));

    console.log("[dashboard/part-rows] returned", data.length, "rows");
    return NextResponse.json({ success: true, rows: data });
  } catch (err) {
    console.error("[dashboard/part-rows] error", err);
    return NextResponse.json({ success: false, rows: [] }, { status: 500 });
  }
}
