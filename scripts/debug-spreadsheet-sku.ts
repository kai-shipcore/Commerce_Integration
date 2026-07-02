// Reads the seat cover custom CSV and prints all data for CA-SC-10-E-27-BK-1TO
import * as path from "path";
import * as XLSX from "xlsx";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/debug-spreadsheet-sku.ts <file.csv>");
  process.exit(1);
}

const SKU = "CA-SC-10-E-27-BK-1TO";

const workbook = XLSX.readFile(path.resolve(filePath), { raw: false, cellDates: false });
const sheet    = workbook.Sheets[workbook.SheetNames[0]];
const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

// Print first 3 rows (header rows)
console.log("Row 0:", rows[0]?.slice(0, 60));
console.log("Row 1:", rows[1]?.slice(0, 60));
console.log("Row 2 (header):", rows[2]?.slice(0, 60));

const headerRow = rows[2] as unknown[];
const dataRows  = rows.slice(3) as unknown[][];

// Find master sku col
const colSku = headerRow.findIndex(h => String(h ?? "").trim().toLowerCase() === "master sku");
console.log(`\nMaster SKU column: ${colSku}`);

// Find the target row
const targetRow = dataRows.find(r => String(r[colSku] ?? "").trim() === SKU);
if (!targetRow) {
  console.log(`SKU ${SKU} not found in data rows`);
  process.exit(0);
}

console.log(`\nAll columns for SKU ${SKU}:`);
for (let i = 0; i < Math.max(headerRow.length, targetRow.length); i++) {
  const header = String(headerRow[i] ?? "").trim();
  const val    = targetRow[i];
  if (header || (val !== "" && val !== 0)) {
    console.log(`  [${i}] ${header}: ${JSON.stringify(val)}`);
  }
}
