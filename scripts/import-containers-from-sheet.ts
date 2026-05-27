// import-containers-from-sheet.ts
// Usage: npx tsx scripts/import-containers-from-sheet.ts <path/to/sheet.xlsx> [--dry-run]
//
// Reads container groups from row 3 of the first sheet tab.
// Rows 1-2 are ignored. Data rows start at row 4.
//
// Per container group (10-column blocks after the fixed columns):
//   col+0 = CBM (cbm_unit per row)
//   col+1 = Container name header → fc_containers.container_number
//            row values → fc_container_items.qty
//   col+5 = ETA date (header cell value) → fc_containers.eta_date
//
// Cell fill color of the container name header → status:
//   Blue   → shipped
//   Orange → shipped
//   Pink / Purple → draft
//   (uncolored)   → draft
//
// DB writes:
//   fc_containers      — upsert on container_number (updates eta_date + status)
//   fc_container_items — delete existing items for each container, then re-insert

import * as ExcelJS from "exceljs";
import { getPrimaryPool } from "../src/lib/db/primary-db";
import * as path from "path";

const filePath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npx tsx scripts/import-containers-from-sheet.ts <file.xlsx> [--dry-run]");
  process.exit(1);
}

// ─── Color → status ──────────────────────────────────────────────────────────

function argbToStatus(argb: string | undefined, containerName: string): string {
  if (!argb || argb.length < 6) return "draft";

  // ARGB is 8 hex chars (AARRGGBB) or sometimes 6 (RRGGBB)
  const hex = argb.length === 8 ? argb.slice(2) : argb.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const max = Math.max(r, g, b);
  const isBlue   = b === max && b - r > 30 && b - g > 10;
  const isOrange = r === max && g >= b && r - b > 60;

  const detected = isBlue ? "blue" : isOrange ? "orange" : "other";
  const status = (isBlue || isOrange) ? "shipped" : "draft";
  console.log(`  color(${containerName}): #${hex} → ${detected} → ${status}`);
  return status;
}

function getCellFillArgb(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill as ExcelJS.Fill | undefined;
  if (!fill || fill.type !== "pattern") return undefined;
  const fg = (fill as ExcelJS.FillPattern).fgColor;
  if (!fg || !fg.argb) return undefined;
  return fg.argb;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function cellToDateString(value: ExcelJS.CellValue): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel serial date
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ─── Cell text helper (handles rich text cells) ───────────────────────────────

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("").trim();
  }
  if (typeof v === "object" && "formula" in v) {
    const result = (v as ExcelJS.CellFormulaValue).result;
    return result !== undefined && result !== null ? String(result).trim() : "";
  }
  return String(v).trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface ContainerGroup {
  nameColIdx: number; // 1-based column index of the container name column
  name: string;
  status: string;
  etaDate: string | null;
}

interface ItemRow {
  masterSku: string;
  containerName: string;
  qty: number;
  cbmUnit: number | null;
}

async function main() {
  console.log(`Reading: ${path.resolve(filePath)}`);
  if (dryRun) console.log("DRY RUN — no DB writes");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    console.error("No worksheets found in the file.");
    process.exit(1);
  }

  console.log(`\nSheet: "${sheet.name}"`);

  // Row 3 = header row
  const headerRow = sheet.getRow(3);

  let skuColIdx = -1;
  const containerGroups: ContainerGroup[] = [];

  // Scan every cell in the header row
  const lastCol = sheet.columnCount;
  for (let c = 1; c <= lastCol; c++) {
    const cell = headerRow.getCell(c);
    const text = cellText(cell);

    if (text === "Master SKU") {
      skuColIdx = c;
      continue;
    }

    // Container name pattern: e.g. "166-CA-SEAT", "167-CA-BK"
    // Digits, dash, uppercase letters, dash, uppercase letters
    if (/^\d{2,4}-[A-Z]{1,4}-[A-Z]+/.test(text)) {
      const etaCell = headerRow.getCell(c + 5);
      const etaDate = cellToDateString(etaCell.value);
      const argb = getCellFillArgb(cell);
      const status = argbToStatus(argb, text);

      containerGroups.push({
        nameColIdx: c,
        name: text,
        status,
        etaDate,
      });
    }
  }

  if (skuColIdx === -1) {
    console.error('\nCould not find "Master SKU" column in row 3. Check that row 3 is the header row.');
    process.exit(1);
  }

  if (containerGroups.length === 0) {
    console.error("\nNo container name columns detected in row 3.");
    console.error('Expected pattern: digits-LETTERS-LETTERS (e.g. "166-CA-SEAT").');
    process.exit(1);
  }

  console.log(`\nFound ${containerGroups.length} container(s):`);
  for (const cg of containerGroups) {
    console.log(`  ${cg.name} | status=${cg.status} | eta=${cg.etaDate ?? "(none)"} | col=${cg.nameColIdx}`);
  }

  // Collect item rows (row 4+)
  const items: ItemRow[] = [];
  const lastRow = sheet.lastRow?.number ?? 0;

  for (let rowNum = 4; rowNum <= lastRow; rowNum++) {
    const row = sheet.getRow(rowNum);
    const skuRaw = cellText(row.getCell(skuColIdx));
    if (!skuRaw) continue;
    const masterSku = skuRaw.toUpperCase();

    for (const cg of containerGroups) {
      const qtyCell = row.getCell(cg.nameColIdx);
      const cbmCell = row.getCell(cg.nameColIdx - 1); // CBM column is immediately left

      const qtyRaw = qtyCell.value;
      const cbmRaw = cbmCell.value;

      const qty = typeof qtyRaw === "number" ? Math.round(qtyRaw) : parseInt(String(qtyRaw ?? ""), 10);
      const cbmUnit = typeof cbmRaw === "number" ? cbmRaw : parseFloat(String(cbmRaw ?? ""));

      if (!qty || qty <= 0 || isNaN(qty)) continue;

      items.push({
        masterSku,
        containerName: cg.name,
        qty,
        cbmUnit: isNaN(cbmUnit) || cbmUnit <= 0 ? null : cbmUnit,
      });
    }
  }

  console.log(`\nCollected ${items.length} SKU-container entries across ${containerGroups.length} container(s).`);

  if (dryRun) {
    console.log("\nDry-run preview (first 20 items):");
    for (const item of items.slice(0, 20)) {
      console.log(`  ${item.masterSku} → ${item.containerName} qty=${item.qty} cbm=${item.cbmUnit ?? "null"}`);
    }
    return;
  }

  // ─── DB writes ────────────────────────────────────────────────────────────

  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Upsert containers
    const containerIds = new Map<string, string>();
    for (const cg of containerGroups) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO shipcore.fc_containers
           (container_number, eta_date, status, cbm_capacity, created_at, updated_at)
         VALUES ($1, $2::date, $3::shipcore.fc_container_status, 67.5, NOW(), NOW())
         ON CONFLICT (container_number) DO UPDATE SET
           eta_date   = EXCLUDED.eta_date,
           status     = EXCLUDED.status,
           updated_at = NOW()
         RETURNING id::text`,
        [cg.name, cg.etaDate, cg.status]
      );
      containerIds.set(cg.name, result.rows[0].id);
      console.log(`  Upserted container: ${cg.name} (id=${result.rows[0].id})`);
    }

    // 2. Check which SKUs exist in fc_products
    const allSkus = [...new Set(items.map((i) => i.masterSku))];
    const skuResult = await client.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [allSkus]
    );
    const validSkus = new Set(skuResult.rows.map((r) => r.master_sku));
    const skippedSkus = allSkus.filter((s) => !validSkus.has(s));
    if (skippedSkus.length > 0) {
      console.log(`\nSkipping ${skippedSkus.length} SKU(s) not in fc_products: ${skippedSkus.join(", ")}`);
    }

    // 3. Delete existing items for all containers being imported
    for (const entry of Array.from(containerIds.entries())) {
      await client.query(
        `DELETE FROM shipcore.fc_container_items WHERE container_id = $1::bigint`,
        [entry[1]]
      );
    }

    // 4. Insert items (only valid SKUs)
    let inserted = 0;
    for (const item of items) {
      if (!validSkus.has(item.masterSku)) continue;
      const containerId = containerIds.get(item.containerName);
      if (!containerId) continue;

      await client.query(
        `INSERT INTO shipcore.fc_container_items
           (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
         VALUES ($1::bigint, $2, $3::int, $4::numeric, NOW(), NOW())`,
        [containerId, item.masterSku, item.qty, item.cbmUnit]
      );
      inserted++;
    }

    await client.query("COMMIT");
    console.log(`\nDone. Inserted ${inserted} items across ${containerGroups.length} container(s).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nImport failed — rolled back.");
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
