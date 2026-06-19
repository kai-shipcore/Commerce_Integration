// One-time sync: update fc_container_items.cbm_unit from fc_products.cbm_per_unit
// Usage: npx tsx --env-file=.env.local scripts/sync-cbm-to-containers.ts
import { getPrimaryPool } from "../src/lib/db/primary-db";

const pool = getPrimaryPool();

async function run() {
  const r = await pool.query(`
    UPDATE shipcore.fc_container_items ci
    SET cbm_unit = p.cbm_per_unit, updated_at = NOW()
    FROM shipcore.fc_products p
    WHERE ci.master_sku = p.master_sku
      AND p.cbm_per_unit IS NOT NULL
      AND ci.cbm_unit IS DISTINCT FROM p.cbm_per_unit
  `);
  console.log(`Updated ${r.rowCount} container item rows.`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
