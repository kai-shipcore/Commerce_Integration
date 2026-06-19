// import-stats-from-csv.ts
// Usage: npx tsx --env-file=.env.local scripts/import-stats-from-csv.ts <path/to/file.csv> [--dry-run]
//
// Works with Car Cover, Floor Mat, and Seat Cover forecast CSVs.
// Header row is at index 2 (0-based). Data rows start at index 3.
// Column positions are auto-detected from header values.
//
// Writes to the primary DB:
//
// shipcore.fc_container_items — inbound qty per SKU per container:
//   Container name columns detected by pattern NNN-... (e.g. 98-CA, 176-CA-SEAT).
//   For each container found in fc_containers, deletes existing items then re-inserts.
//   SKUs not present in fc_products are skipped.

import * as path from "path";
import * as XLSX from "xlsx";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const filePath = process.argv[2];
const dryRun   = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/import-stats-from-csv.ts <file.csv> [--dry-run]");
  process.exit(1);
}

function parseNum(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const n = Number(String(val).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function normalizeHeader(val: unknown): string {
  return String(val ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findCol(header: unknown[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = header.findIndex(h => normalizeHeader(h) === candidate.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

async function main() {
  const workbook = XLSX.readFile(path.resolve(filePath), { raw: false, cellDates: false });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  const headerRow = rows[2] as unknown[];
  const dataRows  = rows.slice(3) as unknown[][];

  // Auto-detect column positions from header
  const colSku = findCol(headerRow, "master sku");
  const colCbm = findCol(headerRow, "cbm");

  if (colSku === -1) { console.error("Could not find 'Master SKU' column"); process.exit(1); }

  console.log(`Column map — SKU:${colSku} CBM:${colCbm}`);

  // Find container columns: NNN-... pattern (e.g. 98-CA, 176-CA-SEAT); ETA at col+5
  const conPattern = /^\d+-[A-Z]/;
  const containerCols: { col: number; name: string }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] ?? "").trim();
    if (conPattern.test(cell)) {
      containerCols.push({ col: i, name: cell });
    }
  }
  console.log(`Found ${containerCols.length} container columns: ${containerCols.map(c => c.name).join(", ")}`);

  // Parse data rows
  type ItemRow = { master_sku: string; qty: number; cbm_unit: number };

  const itemsByContainer = new Map<string, ItemRow[]>();
  for (const { name } of containerCols) itemsByContainer.set(name, []);
  let skuCount = 0;

  for (const row of dataRows) {
    const masterSku = String(row[colSku] ?? "").trim();
    if (!masterSku) continue;
    skuCount++;

    const cbmUnit = colCbm !== -1 ? parseNum(row[colCbm]) : 0;

    for (const { col, name } of containerCols) {
      const qty = parseNum(row[col]);
      if (qty > 0) {
        itemsByContainer.get(name)!.push({ master_sku: masterSku, qty, cbm_unit: cbmUnit });
      }
    }
  }

  console.log(`Parsed ${skuCount} SKU rows`);
  for (const { name } of containerCols) {
    const count = itemsByContainer.get(name)!.length;
    if (count > 0) console.log(`  ${name}: ${count} SKUs`);
  }

  if (dryRun) {
    const firstCon = containerCols.find(c => itemsByContainer.get(c.name)!.length > 0);
    if (firstCon) {
      console.log(`\nDry run — fc_container_items sample for ${firstCon.name} (first 5):`);
      console.table(itemsByContainer.get(firstCon.name)!.slice(0, 5));
    }
    return;
  }

  const pool = getPrimaryPool();

  // Replace fc_container_items per container
  // Pre-load valid SKUs to avoid FK violations (fc_container_items.master_sku → fc_products)
  const validSkuRes = await pool.query<{ master_sku: string }>(`SELECT master_sku FROM shipcore.fc_products`);
  const validSkus = new Set(validSkuRes.rows.map(r => r.master_sku));

  let containersUpdated = 0;
  let containersSkipped = 0;

  for (const { name } of containerCols) {
    const items = itemsByContainer.get(name)!;
    if (items.length === 0) continue;

    const res = await pool.query<{ id: string }>(
      `SELECT id FROM shipcore.fc_containers WHERE container_number = $1`,
      [name]
    );
    if (res.rows.length === 0) {
      console.log(`  SKIP ${name} — not found in fc_containers`);
      containersSkipped++;
      continue;
    }

    const containerId = res.rows[0].id;
    const validItems = items.filter(item => validSkus.has(item.master_sku));
    const skipped = items.length - validItems.length;
    if (skipped > 0) console.log(`  ${name}: skipping ${skipped} items not in fc_products`);
    await pool.query(`DELETE FROM shipcore.fc_container_items WHERE container_id = $1`, [containerId]);
    for (const item of validItems) {
      await pool.query(
        `INSERT INTO shipcore.fc_container_items (container_id, master_sku, qty, cbm_unit) VALUES ($1, $2, $3, $4)`,
        [containerId, item.master_sku, item.qty, item.cbm_unit > 0 ? item.cbm_unit : null]
      );
    }
    console.log(`  ${name}: replaced ${items.length} items`);
    containersUpdated++;
  }

  console.log(`\nDone — ${containersUpdated} containers updated, ${containersSkipped} skipped (not in fc_containers)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
