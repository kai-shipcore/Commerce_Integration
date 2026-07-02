import { getPrimaryPool } from "../src/lib/db/primary-db";

const pool = getPrimaryPool();

async function run() {
  // How many FM SKUs in fc_products vs fc_stats
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM shipcore.fc_products WHERE category_code = 'FM') AS products,
      (SELECT COUNT(*)::int FROM shipcore.fc_stats s JOIN shipcore.fc_products p ON p.master_sku = s.master_sku WHERE p.category_code = 'FM') AS stats,
      (SELECT COUNT(*)::int FROM shipcore.fc_stats s JOIN shipcore.fc_products p ON p.master_sku = s.master_sku WHERE p.category_code = 'FM' AND (s.total_avg_curr > 0 OR s.total_avg_real > 0)) AS stats_with_sales,
      (SELECT COUNT(*)::int FROM shipcore.fc_stats s JOIN shipcore.fc_products p ON p.master_sku = s.master_sku WHERE p.category_code = 'FM' AND s.total_avg_curr = 0 AND s.total_avg_real = 0 AND s.avg_daily_real = 0) AS stats_all_zero
  `);
  console.log('=== Counts ===');
  console.table(counts.rows);

  // Distribution of sales velocity for FM SKUs in stats
  const dist = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE s.total_avg_real = 0)::int                  AS zero_sales,
      COUNT(*) FILTER (WHERE s.total_avg_real > 0 AND s.total_avg_real < 0.1)::int AS very_low,
      COUNT(*) FILTER (WHERE s.total_avg_real >= 0.1 AND s.total_avg_real < 1)::int AS low,
      COUNT(*) FILTER (WHERE s.total_avg_real >= 1)::int                 AS decent
    FROM shipcore.fc_stats s
    JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
    WHERE p.category_code = 'FM'
  `);
  console.log('\n=== FM stats velocity distribution (total_avg_real) ===');
  console.table(dist.rows);

  // Check fc_stats_custom (velocity snapshots) for FM
  const custom = await pool.query(`
    SELECT COUNT(*)::int AS custom_fm_rows
    FROM shipcore.fc_stats_custom s
    JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
    WHERE p.category_code = 'FM'
  `).catch(() => ({ rows: [{ custom_fm_rows: 'table not found' }] }));
  console.log('\n=== FM rows in fc_stats_custom ===');
  console.table(custom.rows);

  // SKU pattern breakdown
  const patterns = await pool.query(`
    SELECT
      CASE
        WHEN master_sku LIKE 'CA-FM-80-FM%' THEN 'CA-FM-80-FM##### (numbered)'
        WHEN master_sku LIKE 'FM-%' THEN 'FM-* (legacy)'
        ELSE 'other'
      END AS pattern,
      COUNT(*)::int AS count
    FROM shipcore.fc_products
    WHERE category_code = 'FM'
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\n=== FM SKU patterns in fc_products ===');
  console.table(patterns.rows);

  // When were these created?
  const ages = await pool.query(`
    SELECT
      DATE_TRUNC('month', p.created_at)::date AS created_month,
      COUNT(*)::int AS count
    FROM shipcore.fc_products p
    WHERE p.category_code = 'FM'
    GROUP BY 1 ORDER BY 1
  `);
  console.log('\n=== FM products created by month ===');
  console.table(ages.rows);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
