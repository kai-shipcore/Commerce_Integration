import { getPrimaryPool } from "../src/lib/db/primary-db";

const SKU = "CA-SC-10-E-27-BK-1TO";

async function main() {
  const pool = getPrimaryPool();

  const [stats, items] = await Promise.all([
    pool.query(`
      SELECT master_sku, west_stock, east_stock, total_stock, back,
             avg_daily_real, avg_daily_prev, avg_daily_curr,
             east_avg_real, east_avg_prev, east_avg_curr,
             fba_avg_real, fba_avg_curr,
             total_avg_real, total_avg_prev, total_avg_curr
      FROM shipcore.fc_stats
      WHERE master_sku = $1
    `, [SKU]),
    pool.query(`
      SELECT c.container_number, c.eta_date, ci.qty, ci.cbm_unit
      FROM shipcore.fc_container_items ci
      JOIN shipcore.fc_containers c ON c.id = ci.container_id
      WHERE ci.master_sku = $1
      ORDER BY c.eta_date
    `, [SKU]),
  ]);

  console.log("fc_stats row:");
  console.table(stats.rows);
  console.log("Container items:");
  console.table(items.rows);

  await pool.end();
}

main().catch(console.error);
