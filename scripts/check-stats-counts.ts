import { getPrimaryPool } from "../src/lib/db/primary-db";

const pool = getPrimaryPool();

async function run() {
  const r = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE p.category_code = 'FM')::int AS floor_mat,
      COUNT(*) FILTER (WHERE p.category_code = 'CC')::int AS car_cover,
      COUNT(*) FILTER (WHERE p.category_code = 'SC')::int AS seat_cover,
      COUNT(*) FILTER (WHERE p.category_code IS NULL)::int AS no_category
    FROM shipcore.fc_stats s
    LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
  `);
  console.table(r.rows);

  // Sample some floor mat SKUs
  const fm = await pool.query(`
    SELECT s.master_sku, p.category_code
    FROM shipcore.fc_stats s
    LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
    WHERE p.category_code = 'FM'
    LIMIT 10
  `);
  console.log('\nSample FM SKUs:');
  console.table(fm.rows);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
