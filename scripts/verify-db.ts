import { getPrimaryPool } from "../src/lib/db/primary-db";

async function main() {
  const pool = getPrimaryPool();

  const [counts, customPrefixes, statsPrefixes, containerSummary, orphaned, tables] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt, 'fc_stats' AS tbl FROM shipcore.fc_stats UNION ALL SELECT COUNT(*), 'fc_stats_custom' FROM shipcore.fc_stats_custom`),
    pool.query(`SELECT LEFT(master_sku, 5) AS prefix, COUNT(*) AS cnt FROM shipcore.fc_stats_custom WHERE master_sku LIKE 'CA-%' GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT LEFT(master_sku, 5) AS prefix, COUNT(*) AS cnt FROM shipcore.fc_stats GROUP BY 1 ORDER BY 1 LIMIT 10`),
    pool.query(`SELECT CASE WHEN c.container_number LIKE '%-CA-SEAT' THEN 'SEAT' ELSE 'CC/FM' END AS type, COUNT(DISTINCT c.container_number) AS containers, COUNT(ci.id) AS items FROM shipcore.fc_containers c JOIN shipcore.fc_container_items ci ON ci.container_id = c.id GROUP BY 1`),
    pool.query(`SELECT COUNT(*) AS orphaned FROM shipcore.fc_container_items ci LEFT JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku WHERE p.master_sku IS NULL`),
    pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'shipcore' ORDER BY table_name`),
  ]);

  console.log("--- Stats table row counts ---");
  console.table(counts.rows);
  console.log("--- fc_stats_custom SKU prefixes ---");
  console.table(customPrefixes.rows);
  console.log("--- fc_stats SKU prefixes ---");
  console.table(statsPrefixes.rows);
  console.log("--- fc_container_items summary ---");
  console.table(containerSummary.rows);
  console.log("--- Orphaned container items (no matching fc_product) ---");
  console.table(orphaned.rows);
  console.log("--- shipcore tables ---");
  console.log(tables.rows.map((r: { table_name: string }) => r.table_name).join(", "));

  await pool.end();
}

main().catch(console.error);
