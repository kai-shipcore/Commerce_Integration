import { NextResponse } from "next/server";
import { getLookupPool } from "@/lib/db/supabase-lookup";

const SEAT_COVER_COLORS = ["BKRD", "BKWH", "BE", "BK", "GR", "DG", "BR", "DB", "WR", "PK", "RD", "WH", "OR"];

function extractSizes(componentSku: string): string[] {
  const parts = componentSku.split("-");
  const color = parts.find((p) => SEAT_COVER_COLORS.includes(p)) ?? "";
  const sizes: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    if (["F", "B", "R", "E"].includes(parts[i])) {
      sizes.push(color ? `${parts[i]}-${parts[i + 1]}-${color}` : `${parts[i]}-${parts[i + 1]}`);
    }
  }
  return sizes;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderNumber = searchParams.get("orderNumber");
  const sku = searchParams.get("sku");

  const pool = getLookupPool();
  if (!pool) {
    return NextResponse.json({ success: false, error: "Lookup DB unavailable" }, { status: 503 });
  }

  const client = await pool.connect();
  try {
    if (orderNumber) {
      const normalizedOrderNumber = orderNumber.trim().replace(/^#/, "");
      const orderNumberCandidates = Array.from(
        new Set([orderNumber.trim(), normalizedOrderNumber, `#${normalizedOrderNumber}`].filter(Boolean))
      );
      const result = await client.query<{ sku: string; product_name: string | null }>(
        `SELECT soi.sku, soi.product_name
         FROM ecommerce_data.sales_orders so
         JOIN ecommerce_data.sales_order_items soi ON soi.order_id = so.id
         WHERE so.order_number = ANY($1::text[])
           AND soi.sku IS NOT NULL`,
        [orderNumberCandidates]
      );
      const items = result.rows.map((r) => ({
        sku: r.sku,
        productName: r.product_name ?? "",
      }));
      return NextResponse.json({ success: true, items });
    }

    if (sku) {
      const result = await client.query<{ component_sku: string }>(
        `SELECT component_sku::text AS component_sku
         FROM ecommerce_data.shiphero_kit_components
         WHERE parent_kit_sku::text = $1`,
        [sku]
      );
      const sizes = result.rows.flatMap((r) =>
        extractSizes(r.component_sku).map((size) => ({
          size,
          componentSku: r.component_sku,
        }))
      );
      return NextResponse.json({ success: true, sizes });
    }

    return NextResponse.json({ success: false, error: "orderNumber or sku param required" }, { status: 400 });
  } catch (err) {
    console.error("[parts/lookup] error", err);
    return NextResponse.json({ success: false, error: "Lookup failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
