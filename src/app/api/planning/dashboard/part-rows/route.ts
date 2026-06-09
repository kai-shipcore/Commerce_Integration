import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ sku: string; back: bigint }[]>`
      SELECT
        "partSkuValue" AS sku,
        SUM(
          CASE
            WHEN "orderRequest" ~ '^[0-9]+$' THEN "orderRequest"::int
            ELSE 0
          END
        ) AS back
      FROM shipcore.fc_replacement_parts
      WHERE "partSkuValue" IS NOT NULL
        AND "shippingStatus" = 'Not Ready'
        AND "deleteYN" = 'N'
      GROUP BY "partSkuValue"
      HAVING SUM(
        CASE
          WHEN "orderRequest" ~ '^[0-9]+$' THEN "orderRequest"::int
          ELSE 0
        END
      ) > 0
      ORDER BY "partSkuValue"
    `;

    const data = rows.map((r) => ({
      sku:  r.sku,
      back: Number(r.back),
    }));

    console.log("[dashboard/part-rows] returned", data.length, "rows");
    return NextResponse.json({ success: true, rows: data });
  } catch (err) {
    console.error("[dashboard/part-rows] error", err);
    return NextResponse.json({ success: false, rows: [] }, { status: 500 });
  }
}
