import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: Request) {
  try {
    const masterSku = new URL(request.url).searchParams.get("masterSku")?.trim().toUpperCase();
    if (!masterSku) {
      return NextResponse.json({ success: false, error: "masterSku is required" }, { status: 400 });
    }

    const result = await getPrimaryPool().query<{
      id: number;
      name: string;
      eta: string | null;
      status: string;
      inbound_qty: number;
      cbm: number;
    }>(`
      SELECT
        c.id::int                 AS id,
        c.container_number        AS name,
        c.eta_date::text          AS eta,
        c.status::text            AS status,
        ci.qty::int               AS inbound_qty,
        ci.total_cbm::float8      AS cbm
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
      WHERE ci.master_sku = $1
        AND ci.qty > 0
        AND c.status IN ('shipped', 'packing_received')
      ORDER BY c.eta_date NULLS LAST, c.id
    `, [masterSku]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("SKU forecast inbound GET failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
