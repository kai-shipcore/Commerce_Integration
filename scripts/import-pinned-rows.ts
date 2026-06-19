// import-pinned-rows.ts
// Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/import-pinned-rows.ts <file.xlsx> <sheet_name> [--dry-run] [--limit=N]
//
// Reads rows from the specified sheet tab and upserts into shipcore.fc_pinned_rows.
// Only stores raw input columns — all derived values are computed at runtime.
//
// Column mapping (1-indexed, row 3 = headers, data starts row 4):
//   9  = master_sku
//   7  = back
//   10 = west_stock
//   11 = east_stock
//   12 = total_stock
//   13 = west_90d, 14 = west_60d, 15 = west_30d, 16 = west_15d, 17 = west_7d, 18 = west_30d_pre
//   19 = east_90d, 20 = east_60d, 21 = east_30d, 22 = east_15d, 23 = east_7d, 24 = east_30d_pre
//   32 = fba_30d (West FBM 30D — col 33 in sheet is East FBM 30D, col 34 = FBA 30D)
//   25 = avg_daily_prev
//   28 = east_avg_prev

import * as ExcelJS from "exceljs";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const filePath  = process.argv[2];
const sheetName = process.argv[3];
const dryRun    = process.argv.includes("--dry-run");
const limitArg  = process.argv.find((a) => a.startsWith("--limit="));
const limit     = limitArg ? parseInt(limitArg.split("=")[1]) : Infinity;

if (!filePath || !sheetName) {
  console.error("Usage: npx tsx scripts/import-pinned-rows.ts <file.xlsx> <sheet_name> [--dry-run] [--limit=N]");
  process.exit(1);
}

function toNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toInt(v: unknown): number {
  return Math.round(toNum(v));
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  console.log(`Reading: ${filePath}`);
  await workbook.xlsx.readFile(filePath);

  const ws = workbook.getWorksheet(sheetName);
  if (!ws) {
    const available = workbook.worksheets.map((s) => s.name).join(", ");
    console.error(`Sheet "${sheetName}" not found. Available: ${available}`);
    process.exit(1);
  }

  const rows: {
    master_sku:    string;
    back:          number;
    west_stock:    number;
    east_stock:    number;
    total_stock:   number;
    west_90d:      number;
    west_60d:      number;
    west_30d:      number;
    west_15d:      number;
    west_7d:       number;
    west_30d_pre:  number;
    east_90d:      number;
    east_60d:      number;
    east_30d:      number;
    east_15d:      number;
    east_7d:       number;
    east_30d_pre:  number;
    fba_30d:       number;
    avg_daily_prev: number;
    east_avg_prev:  number;
  }[] = [];

  let dataRow = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return; // skip header rows
    if (rows.length >= limit) return;

    const sku = String(row.getCell(9).value ?? "").trim();
    if (!sku) return;

    dataRow++;
    rows.push({
      master_sku:    sku,
      back:          toInt(row.getCell(7).value),
      west_stock:    toInt(row.getCell(10).value),
      east_stock:    toInt(row.getCell(11).value),
      total_stock:   toInt(row.getCell(12).value),
      west_90d:      toNum(row.getCell(13).value),
      west_60d:      toNum(row.getCell(14).value),
      west_30d:      toNum(row.getCell(15).value),
      west_15d:      toNum(row.getCell(16).value),
      west_7d:       toNum(row.getCell(17).value),
      west_30d_pre:  toNum(row.getCell(18).value),
      east_90d:      toNum(row.getCell(19).value),
      east_60d:      toNum(row.getCell(20).value),
      east_30d:      toNum(row.getCell(21).value),
      east_15d:      toNum(row.getCell(22).value),
      east_7d:       toNum(row.getCell(23).value),
      east_30d_pre:  toNum(row.getCell(24).value),
      fba_30d:       toInt(row.getCell(34).value),  // FBA 30D column
      avg_daily_prev: toNum(row.getCell(25).value),
      east_avg_prev:  toNum(row.getCell(28).value),
    });
  });

  console.log(`Found ${rows.length} data rows.`);
  rows.forEach((r, i) => console.log(`  [${i + 1}] ${r.master_sku} | stock=${r.total_stock} back=${r.back} w30=${r.west_30d} e30=${r.east_30d}`));

  if (dryRun) {
    console.log("\nDry run — no DB writes.");
    process.exit(0);
  }

  const pool = getPrimaryPool();
  let upserted = 0;
  for (const r of rows) {
    await pool.query(`
      INSERT INTO shipcore.fc_pinned_rows
        (master_sku, label, sort_order,
         back, west_stock, east_stock, total_stock,
         west_90d, west_60d, west_30d, west_15d, west_7d, west_30d_pre,
         east_90d, east_60d, east_30d, east_15d, east_7d, east_30d_pre,
         fba_30d, avg_daily_prev, east_avg_prev)
      VALUES ($1, 'Ref', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (master_sku, label) DO UPDATE SET
        sort_order    = EXCLUDED.sort_order,
        back          = EXCLUDED.back,
        west_stock    = EXCLUDED.west_stock,
        east_stock    = EXCLUDED.east_stock,
        total_stock   = EXCLUDED.total_stock,
        west_90d      = EXCLUDED.west_90d,
        west_60d      = EXCLUDED.west_60d,
        west_30d      = EXCLUDED.west_30d,
        west_15d      = EXCLUDED.west_15d,
        west_7d       = EXCLUDED.west_7d,
        west_30d_pre  = EXCLUDED.west_30d_pre,
        east_90d      = EXCLUDED.east_90d,
        east_60d      = EXCLUDED.east_60d,
        east_30d      = EXCLUDED.east_30d,
        east_15d      = EXCLUDED.east_15d,
        east_7d       = EXCLUDED.east_7d,
        east_30d_pre  = EXCLUDED.east_30d_pre,
        fba_30d       = EXCLUDED.fba_30d,
        avg_daily_prev = EXCLUDED.avg_daily_prev,
        east_avg_prev  = EXCLUDED.east_avg_prev,
        updated_at    = NOW()
    `, [
      r.master_sku, upserted,
      r.back, r.west_stock, r.east_stock, r.total_stock,
      r.west_90d, r.west_60d, r.west_30d, r.west_15d, r.west_7d, r.west_30d_pre,
      r.east_90d, r.east_60d, r.east_30d, r.east_15d, r.east_7d, r.east_30d_pre,
      r.fba_30d, r.avg_daily_prev, r.east_avg_prev,
    ]);
    upserted++;
  }

  console.log(`\nUpserted ${upserted} rows into shipcore.fc_pinned_rows.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
