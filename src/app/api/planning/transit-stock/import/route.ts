// Code Guide: PUT /api/planning/transit-stock/import
// Bulk upserts transit_stock by master_sku into both planning stats tables.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";

const RowSchema = z.object({
  masterSku: z.string().min(1),
  transitStock: z.number().int().min(0),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function PUT(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid import rows" }, { status: 400 });
  }

  const rowsBySku = new Map<string, number>();
  for (const row of parsed.data.rows) {
    const masterSku = row.masterSku.trim().toUpperCase();
    if (masterSku) rowsBySku.set(masterSku, row.transitStock);
  }

  const rows = [...rowsBySku.entries()].map(([masterSku, transitStock]) => ({ masterSku, transitStock }));
  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: "No valid transit stock rows found" }, { status: 400 });
  }

  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE stg_transit_stock_import (
        master_sku TEXT PRIMARY KEY,
        transit_stock INT NOT NULL
      ) ON COMMIT DROP
    `);

    await client.query(
      `INSERT INTO stg_transit_stock_import (master_sku, transit_stock)
       SELECT unnest($1::text[]), unnest($2::int[])`,
      [rows.map((row) => row.masterSku), rows.map((row) => row.transitStock)],
    );

    const before = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM stg_transit_stock_import stg
      WHERE EXISTS (SELECT 1 FROM shipcore.fc_stats s WHERE s.master_sku = stg.master_sku)
         OR EXISTS (SELECT 1 FROM shipcore.fc_stats_custom s WHERE s.master_sku = stg.master_sku)
    `);

    await client.query(`
      INSERT INTO shipcore.fc_stats (master_sku, transit_stock, created_at, updated_at)
      SELECT master_sku, transit_stock, NOW(), NOW()
      FROM stg_transit_stock_import
      ON CONFLICT (master_sku) DO UPDATE SET
        transit_stock = EXCLUDED.transit_stock,
        updated_at = NOW()
    `);
    await client.query(`
      INSERT INTO shipcore.fc_stats_custom (master_sku, transit_stock, created_at, updated_at)
      SELECT master_sku, transit_stock, NOW(), NOW()
      FROM stg_transit_stock_import
      ON CONFLICT (master_sku) DO UPDATE SET
        transit_stock = EXCLUDED.transit_stock,
        updated_at = NOW()
    `);

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();

    const updated = Number(before.rows[0]?.count ?? 0);
    return NextResponse.json({
      success: true,
      imported: rows.length,
      updated,
      inserted: Math.max(0, rows.length - updated),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[planning/transit-stock/import] PUT error:", errorMessage(error));
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
