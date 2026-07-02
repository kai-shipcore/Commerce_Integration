import { getPrimaryPool } from "../src/lib/db/primary-db";

const pool = getPrimaryPool();

async function run() {
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                                                         AS total_items,
      COUNT(*) FILTER (WHERE ci.cbm_unit IS NULL)::int                     AS null_cbm,
      COUNT(*) FILTER (WHERE p.cbm_per_unit IS NULL)::int                  AS missing_in_products,
      COUNT(*) FILTER (WHERE ci.cbm_unit IS DISTINCT FROM p.cbm_per_unit)::int AS mismatched
    FROM shipcore.fc_container_items ci
    LEFT JOIN shipcore.fc_products p ON p.master_sku = ci.master_sku
  `);
  console.table(r.rows);

  const nullRows = await pool.query(`
    SELECT ci.master_sku, c.container_number, ci.qty
    FROM shipcore.fc_container_items ci
    JOIN shipcore.fc_containers c ON c.id = ci.container_id
    WHERE ci.cbm_unit IS NULL
    LIMIT 10
  `);
  if (nullRows.rowCount) {
    console.log('\nItems with null cbm_unit:');
    console.table(nullRows.rows);
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
