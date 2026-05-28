// Backfills cbm_unit on fc_container_items rows where cbm_unit IS NULL,
// pulling cbm_per_unit from fc_products. total_cbm is a generated column
// (cbm_unit * qty) and updates automatically.
import { getPrimaryPool } from "../src/lib/db/primary-db";

async function main() {
  const pool = getPrimaryPool();
  const result = await pool.query(`
    UPDATE shipcore.fc_container_items ci
    SET
      cbm_unit   = p.cbm_per_unit,
      updated_at = NOW()
    FROM shipcore.fc_products p
    WHERE ci.master_sku = p.master_sku
      AND p.cbm_per_unit IS NOT NULL
      AND p.cbm_per_unit > 0
      AND ci.cbm_unit IS NULL
  `);
  console.log(`Updated ${result.rowCount} rows.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
