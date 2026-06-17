import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

type InboundHistoryRow = {
  item_id: number;
  container_id: number;
  container_number: string;
  status: string;
  eta: string | null;
  status_changed_at: string | null;
  inbound_qty: number;
  cbm: number;
  source_types: string[] | null;
  remaining_references: string[] | null;
  remaining_qty: number;
  mistake_references: string[] | null;
  mistake_qty: number;
  item_updated_at: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const masterSku = searchParams.get("masterSku")?.trim().toUpperCase();

    if (!masterSku) {
      return NextResponse.json({ success: false, error: "masterSku is required" }, { status: 400 });
    }

    const result = await getPrimaryPool().query<InboundHistoryRow>(
      `
      SELECT
        ci.id::int AS item_id,
        c.id::int AS container_id,
        c.container_number,
        c.status::text AS status,
        c.eta_date::text AS eta,
        c.updated_at::text AS status_changed_at,
        ci.qty::int AS inbound_qty,
        ci.total_cbm::float8 AS cbm,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.source_type) FILTER (WHERE s.source_type IS NOT NULL), NULL) AS source_types,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.reference_no) FILTER (WHERE s.source_type = 'remaining'), NULL) AS remaining_references,
        COALESCE(SUM(a.qty) FILTER (WHERE s.source_type = 'remaining'), 0)::int AS remaining_qty,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.reference_no) FILTER (WHERE s.source_type = 'mistake'), NULL) AS mistake_references,
        COALESCE(SUM(a.qty) FILTER (WHERE s.source_type = 'mistake'), 0)::int AS mistake_qty,
        ci.updated_at::text AS item_updated_at
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
      LEFT JOIN shipcore.fc_container_item_allocations a
        ON a.container_id = ci.container_id
      LEFT JOIN shipcore.fc_available_stock s
        ON s.id = a.source_stock_id
       AND s.master_sku = ci.master_sku
      WHERE ci.master_sku = $1
        AND ci.qty > 0
      GROUP BY ci.id, c.id, c.container_number, c.status, c.eta_date, c.updated_at, ci.qty, ci.total_cbm, ci.updated_at
      ORDER BY
        c.eta_date DESC NULLS LAST,
        c.updated_at DESC,
        c.id DESC
      `,
      [masterSku],
    );

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        itemId: row.item_id,
        containerId: row.container_id,
        containerNumber: row.container_number,
        status: row.status,
        eta: row.eta,
        statusChangedAt: row.status_changed_at,
        stockInCompletedAt: row.status === "complete" ? row.status_changed_at : null,
        inboundQty: row.inbound_qty,
        cbm: row.cbm,
        sourceTypes: row.source_types ?? [],
        remainingReferences: row.remaining_references ?? [],
        remainingQty: row.remaining_qty,
        mistakeReferences: row.mistake_references ?? [],
        mistakeQty: row.mistake_qty,
        itemUpdatedAt: row.item_updated_at,
        changeHistory: null,
      })),
    });
  } catch (error) {
    console.error("SKU forecast inbound history GET failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
