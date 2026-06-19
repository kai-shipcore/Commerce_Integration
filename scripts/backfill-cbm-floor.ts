// backfill-cbm-floor.ts
// Reads per-SKU CBM from column B of the floor mat sheet and updates:
//   1. fc_products.cbm_per_unit  (all matching SKUs)
//   2. fc_container_items.cbm_unit (floor mat container items for those SKUs)
//
// Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/backfill-cbm-floor.ts <file.xlsx>

import * as ExcelJS from "exceljs";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/backfill-cbm-floor.ts <file.xlsx>");
  process.exit(1);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  // Find Master SKU column in row 3
  const headerRow = ws.getRow(3);
  let skuColIdx = -1;
  for (let c = 1; c <= 50; c++) {
    const val = headerRow.getCell(c).value;
    if (typeof val === "string" && val.trim() === "Master SKU") {
      skuColIdx = c;
      break;
    }
  }
  if (skuColIdx === -1) {
    console.error("Could not find Master SKU column in row 3.");
    process.exit(1);
  }

  // Read SKU→CBM from column B (col 2) and the detected SKU column
  const cbmMap = new Map<string, number>();
  const lastRow = ws.lastRow?.number ?? 0;
  for (let r = 4; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const skuRaw = row.getCell(skuColIdx).value;
    const cbmRaw = row.getCell(2).value;
    if (!skuRaw || typeof skuRaw !== "string") continue;
    const sku = skuRaw.trim().toUpperCase();
    const cbm = typeof cbmRaw === "number" ? cbmRaw : parseFloat(String(cbmRaw ?? ""));
    if (!sku || isNaN(cbm) || cbm <= 0) continue;
    cbmMap.set(sku, cbm);
  }

  console.log(`Read ${cbmMap.size} SKU→CBM entries from sheet.`);

  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let productUpdated = 0;
    let itemUpdated = 0;

    for (const [sku, cbm] of cbmMap) {
      const pr = await client.query(
        `UPDATE shipcore.fc_products SET cbm_per_unit = $1 WHERE master_sku = $2`,
        [cbm, sku]
      );
      productUpdated += pr.rowCount ?? 0;

      const ir = await client.query(
        `UPDATE shipcore.fc_container_items ci
         SET cbm_unit = $1, updated_at = NOW()
         FROM shipcore.fc_containers c
         WHERE ci.container_id = c.id
           AND c.container_number LIKE '%-CA-FLOOR'
           AND ci.master_sku = $2`,
        [cbm, sku]
      );
      itemUpdated += ir.rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(`Updated ${productUpdated} fc_products rows.`);
    console.log(`Updated ${itemUpdated} fc_container_items rows (floor mat containers).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed — rolled back.");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
