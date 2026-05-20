// Code Guide: Read API for fc_containers. Used by Warehouse Management to show inbound containers per destination warehouse.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const warehouseCode = searchParams.get("warehouseCode")?.trim() ?? "";
    const warehouseName = searchParams.get("warehouseName")?.trim() ?? "";
    const city = searchParams.get("city")?.trim() ?? "";
    const includeReceived = searchParams.get("includeReceived") === "true";
    const includeDetails = searchParams.get("includeDetails") === "true";

    const filters: string[] = [];
    const params: unknown[] = [];

    if (!includeReceived) {
      filters.push("c.status <> 'received'");
    }

    const destinationTerms = [warehouseCode, warehouseName, city].filter(Boolean);
    if (destinationTerms.length > 0) {
      const destinationFilters = destinationTerms.map((term) => {
        params.push(`%${term}%`);
        return `COALESCE(c.dest_warehouse, '') ILIKE $${params.length}`;
      });
      filters.push(`(${destinationFilters.join(" OR ")})`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await getPrimaryPool().query(
      `SELECT
         c.id::text AS id,
         c.container_number,
         c.eta_date,
         c.actual_arrival_date,
         c.status::text AS status,
         c.cbm_capacity::text AS cbm_capacity,
         c.factory_name,
         c.origin,
         c.dest_warehouse,
         COALESCE(item_summary.item_count, 0)::int AS item_count,
         COALESCE(item_summary.total_qty, 0)::int AS total_qty,
         COALESCE(item_summary.total_cbm, 0)::text AS total_cbm,
         COALESCE(item_summary.items, '[]'::json) AS items,
         COALESCE(po_summary.po_numbers, ARRAY[]::text[]) AS po_numbers
       FROM shipcore.fc_containers c
       LEFT JOIN (
         SELECT
           container_id,
           COUNT(*)::int AS item_count,
           COALESCE(SUM(qty), 0)::int AS total_qty,
           COALESCE(SUM(total_cbm), 0)::numeric AS total_cbm,
           json_agg(
             json_build_object(
               'id', id::text,
               'sku', master_sku,
               'qty', qty,
               'cbm', COALESCE(cbm_unit, CASE WHEN qty > 0 THEN total_cbm / qty ELSE 0 END, 0)
             )
             ORDER BY id
           ) AS items
         FROM shipcore.fc_container_items
         GROUP BY container_id
       ) item_summary ON item_summary.container_id = c.id
       LEFT JOIN (
         SELECT
           l.container_id,
           array_agg(po.po_number ORDER BY po.po_number) AS po_numbers
         FROM shipcore.fc_container_po_links l
         JOIN shipcore.fc_purchase_orders po ON po.id = l.po_id
         GROUP BY l.container_id
       ) po_summary ON po_summary.container_id = c.id
       ${where}
       ORDER BY c.eta_date NULLS LAST, c.id DESC`,
      params
    );

    const data = result.rows.map((row) => ({
      id: row.id as string,
      containerNumber: row.container_number as string,
      etaDate: serializeDate(row.eta_date),
      actualArrivalDate: serializeDate(row.actual_arrival_date),
      status: row.status as string,
      cbmCapacity: Number(row.cbm_capacity ?? 0),
      factoryName: row.factory_name as string | null,
      origin: row.origin as string | null,
      destWarehouse: row.dest_warehouse as string | null,
      itemCount: Number(row.item_count ?? 0),
      totalQty: Number(row.total_qty ?? 0),
      totalCbm: Number(row.total_cbm ?? 0),
      ...(includeDetails
        ? {
            poNumbers: (row.po_numbers ?? []) as string[],
            items: ((row.items ?? []) as Array<{ id?: string; sku?: string; qty?: number; cbm?: string | number }>).map((item) => ({
              id: item.id ?? "",
              sku: item.sku ?? "",
              qty: Number(item.qty ?? 0),
              cbm: Number(item.cbm ?? 0),
            })),
          }
        : {}),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching containers:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
