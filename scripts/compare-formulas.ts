// Compare spreadsheet values vs our system formulas for a sample of SKUs
// Usage: npx tsx --env-file=.env.local scripts/compare-formulas.ts <file.csv>

import * as path from "path";
import * as XLSX from "xlsx";
import { getPrimaryPool } from "../src/lib/db/primary-db";
import { currentDailyAverage } from "../src/lib/planning/forecast-calculations";

const filePath = process.argv[2];
if (!filePath) { console.error("Usage: npx tsx --env-file=.env.local scripts/compare-formulas.ts <file.csv>"); process.exit(1); }

const workbook = XLSX.readFile(path.resolve(filePath), { raw: false, cellDates: false });
const sheet    = workbook.Sheets[workbook.SheetNames[0]];
const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
const headerRow = rows[2] as unknown[];
const dataRows  = rows.slice(3) as unknown[][];

const h = (s: string) => headerRow.findIndex(h => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase().includes(s.toLowerCase()));

const COL = {
  sku:           h("master sku"),
  wPrev:         h("avg.\ndaily\nsales\n이전") !== -1 ? h("avg.\ndaily\nsales\n이전") : 24,
  wReal:         25,
  wCurr:         26,
  ePrev:         28,
  eReal:         29, // confirmed from debug
  eCurr:         29,
  fbaCurr:       31,
  tPrev:         36,
  tReal:         37,
  tCurr:         38,
  west90:        12, west60: 13, west30: 14, west15: 15, west7: 16, westPre: 17,
  east90:        18, east60: 19, east30: 20, east15: 21, east7: 22, eastPre: 23,
  west30d:       32, east30d: 33, fba30d: 34, total30d: 35,
  back:          6,
  westStock:     9, eastStock: 10, totalStock: 11,
};

function n(v: unknown) { return typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0; }

// Find SKUs with actual west sales > 0
const activeSKUs = dataRows
  .filter(r => n(r[COL.west30]) > 0 || n(r[COL.west90]) > 0)
  .slice(0, 5);

const skus = activeSKUs.map(r => String(r[COL.sku]).trim());
console.log("Comparing SKUs with sales:", skus);

const pool = getPrimaryPool();

for (const row of activeSKUs) {
  const sku = String(row[COL.sku]).trim();
  if (!sku) continue;

  const sheet_wPrev  = n(row[COL.wPrev]);
  const sheet_wReal  = n(row[COL.wReal]);
  const sheet_wCurr  = n(row[COL.wCurr]);
  const sheet_ePrev  = n(row[COL.ePrev]);
  const sheet_eReal  = n(row[28]); // east avg real
  const sheet_eCurr  = n(row[29]);
  const sheet_tPrev  = n(row[COL.tPrev]);
  const sheet_tReal  = n(row[COL.tReal]);
  const sheet_tCurr  = n(row[COL.tCurr]);
  const sheet_w30d   = n(row[COL.west30d]);
  const sheet_e30d   = n(row[COL.east30d]);
  const sheet_fba30d = n(row[COL.fba30d]);
  const sheet_tot30d = n(row[COL.total30d]);

  // Our formula for wCurr
  const our_wCurr = currentDailyAverage(sheet_wPrev, sheet_wReal);
  const our_eCurr = currentDailyAverage(sheet_ePrev, sheet_eReal);

  console.log(`\n=== ${sku} ===`);
  console.log(`                  | sheet    | our formula`);
  console.log(`west_avg_prev     | ${sheet_wPrev.toFixed(6)} | (raw from velocity)`);
  console.log(`west_avg_real     | ${sheet_wReal.toFixed(6)} | (raw from velocity)`);
  console.log(`west_avg_curr     | ${sheet_wCurr.toFixed(6)} | currentDailyAvg(${sheet_wPrev.toFixed(6)}, ${sheet_wReal.toFixed(6)}) = ${our_wCurr.toFixed(6)}`);
  console.log(`east_avg_curr     | ${sheet_eCurr.toFixed(6)} | currentDailyAvg(${sheet_ePrev.toFixed(6)}, ${sheet_eReal.toFixed(6)}) = ${our_eCurr.toFixed(6)}`);
  console.log(`total_avg_prev    | ${sheet_tPrev.toFixed(6)} | (west+east prev)`);
  console.log(`total_avg_real    | ${sheet_tReal.toFixed(6)} | (west+east+fba real)`);
  console.log(`total_avg_curr    | ${sheet_tCurr.toFixed(6)} | (west+east+fba curr)`);
  console.log(`west_fbm_30d      | ${sheet_w30d.toFixed(4)} |`);
  console.log(`east_fbm_30d      | ${sheet_e30d.toFixed(4)} |`);
  console.log(`total_30d         | ${sheet_tot30d.toFixed(4)} |`);
  console.log(`MATCH wCurr: ${Math.abs(our_wCurr - sheet_wCurr) < 0.0001 ? "✓" : `✗ diff=${(our_wCurr - sheet_wCurr).toFixed(6)}`}`);
}

// Also check the first container block (col 63-72 for 176-CA-SEAT) for one active SKU
const sampleRow = activeSKUs[0];
if (sampleRow) {
  const sku = String(sampleRow[COL.sku]).trim();
  console.log(`\n=== Container chain for ${sku} (176-CA-SEAT = col 63...) ===`);
  for (let i = 60; i < Math.min(120, (sampleRow as unknown[]).length); i++) {
    const hdr = String(headerRow[i] ?? "").replace(/\s+/g, " ").trim();
    const val = (sampleRow as unknown[])[i];
    if (hdr || (val !== "" && val !== 0)) console.log(`  [${i}] ${hdr}: ${JSON.stringify(val)}`);
  }
}

pool.end();
