// Update cbm_per_unit in fc_products from inventory forecast CSV files.
// Usage: npx tsx --env-file=.env.local scripts/update-cbm-from-csv.ts [--dry-run] <file1.csv> [file2.csv ...]

import * as path from "path";
import * as XLSX from "xlsx";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const dryRun = process.argv.includes("--dry-run");
const files = process.argv.slice(2).filter(a => !a.startsWith("--"));

if (files.length === 0) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/update-cbm-from-csv.ts [--dry-run] <file1.csv> [file2.csv ...]");
  process.exit(1);
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

const skuCbm = new Map<string, number>();

for (const filePath of files) {
  const wb = XLSX.readFile(path.resolve(filePath), { raw: false, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  const headerRow = rows[2] as string[];
  if (!headerRow) { console.warn(`No header row in ${filePath}`); continue; }

  const skuCol  = headerRow.findIndex(h => h.replace(/\s+/g, " ").trim().toLowerCase() === "master sku");
  const cbmCol  = headerRow.findIndex(h => h.trim().toLowerCase() === "cbm");

  if (skuCol < 0 || cbmCol < 0) {
    console.warn(`Could not find columns in ${filePath}: sku=${skuCol}, cbm=${cbmCol}`);
    continue;
  }

  let count = 0;
  for (const row of rows.slice(3) as unknown[][]) {
    const sku = String(row[skuCol] ?? "").trim();
    const cbm = parseNumber(row[cbmCol]);
    if (sku && cbm !== null) {
      skuCbm.set(sku, cbm);
      count++;
    }
  }
  console.log(`${path.basename(filePath)}: ${count} SKUs found (sku_col=${skuCol}, cbm_col=${cbmCol})`);
}

console.log(`\nTotal unique SKUs to update: ${skuCbm.size}`);
if (dryRun) { console.log("[DRY RUN] Sample:", [...skuCbm.entries()].slice(0, 5)); process.exit(0); }

const pool = getPrimaryPool();

async function run() {
  // Check which SKUs exist in fc_products
  const skuList = [...skuCbm.keys()];
  const existing = await pool.query<{ master_sku: string }>(
    `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
    [skuList]
  );
  const existingSet = new Set(existing.rows.map(r => r.master_sku));
  const missing = skuList.filter(s => !existingSet.has(s));

  console.log(`Found in fc_products: ${existingSet.size}`);
  if (missing.length > 0) console.log(`Not in fc_products (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`);

  // Batch update using unnest
  const updateSkus: string[] = [];
  const updateCbms: number[] = [];
  for (const sku of existingSet) {
    updateSkus.push(sku);
    updateCbms.push(skuCbm.get(sku)!);
  }

  const result = await pool.query(
    `UPDATE shipcore.fc_products
     SET cbm_per_unit = vals.cbm, updated_at = NOW()
     FROM (SELECT unnest($1::text[]) AS sku, unnest($2::numeric[]) AS cbm) vals
     WHERE master_sku = vals.sku`,
    [updateSkus, updateCbms]
  );

  console.log(`Updated ${result.rowCount} rows in fc_products.`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
