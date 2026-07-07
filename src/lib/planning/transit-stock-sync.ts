// Code Guide: Shared helper that recalculates fc_stats.transit_stock from fc_transit_records.
// Called by transit-records API routes after any create / update / delete.

import { getPrimaryPool } from "@/lib/db/primary-db";

export async function syncTransitStock(skus: string[]): Promise<void> {
  if (skus.length === 0) return;
  const primary = getPrimaryPool();
  const subquery = `
    COALESCE((
      SELECT SUM(qty) FROM shipcore.fc_transit_records
      WHERE master_sku = s.master_sku AND status = 'in_transit'
    ), 0)
  `;
  await Promise.all([
    primary.query(
      `UPDATE shipcore.fc_stats s SET transit_stock = ${subquery}, updated_at = NOW() WHERE s.master_sku = ANY($1::text[])`,
      [skus],
    ),
    primary.query(
      `UPDATE shipcore.fc_stats_custom s SET transit_stock = ${subquery}, updated_at = NOW() WHERE s.master_sku = ANY($1::text[])`,
      [skus],
    ),
  ]);
}
