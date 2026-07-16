// import-containers-from-sheet.ts
// Usage: npx tsx scripts/import-containers-from-sheet.ts <file.xlsx|google-sheets-url> [--tab "L- 7.2.2026"] [--dry-run]
//
// Reads the specified tab (default: first sheet whose name starts with "L-").
// Header row is row 3. Data rows start at row 4.
//
// Columns read per row:
//   B  (col 2)  = CBM per unit → updates fc_products.cbm_per_unit
//   L  (col 12) = Master SKU
//   Container columns (detected from row 3 by name pattern):
//     col+0 = container name / qty per SKU in data rows
//     col+5 = ETA date (header cell only)
//     fill color of header cell → status (blue=shipped, orange=packing_received, purple/other=draft)
//
// Container name pattern: digits-LETTERS[-LETTERS[-digits]] e.g. "178-CA-SEAT", "2026-SEAT-EXTRA-1"
//
// DB writes (all inside one transaction):
//   1. UPDATE fc_products SET cbm_per_unit = ... (only rows with a CBM value)
//   2. UPSERT fc_containers by container_number (insert or update eta/status)
//   3. UPSERT fc_container_items by container+sku (update qty/cbm if exists, insert if new)
//      — items NOT in the sheet are left untouched (no deletes)
//
// File parsing: uses Python 3 stdlib (zipfile + re) to read xlsx without loading the
// entire workbook into memory (ExcelJS OOMed on this 57MB file with 90MB+ sheets).

import { getPrimaryPool } from "../src/lib/db/primary-db";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import { spawnSync, execSync } from "child_process";

const input = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const forceDownload = process.argv.includes("--force-download");
const tabArgIdx = process.argv.indexOf("--tab");
const tabArg = tabArgIdx !== -1 ? process.argv[tabArgIdx + 1] : null;
const skuColArgIdx = process.argv.indexOf("--sku-col");
const skuColArg = skuColArgIdx !== -1 ? process.argv[skuColArgIdx + 1] : "L";

if (!input) {
  console.error(
    'Usage: npx tsx scripts/import-containers-from-sheet.ts <file.xlsx|google-sheets-url> [--tab "L- 7.2.2026"] [--dry-run]'
  );
  process.exit(1);
}

const CBM_CAPACITY_DEFAULT = 80;

// ─── Python extraction script ─────────────────────────────────────────────────
// Parses the xlsx as a zip (stdlib only), extracts only the target sheet,
// and outputs JSON with containers + sku rows.

const PYTHON_SCRIPT = `
import sys, json, re, zipfile, datetime, io
import xml.etree.ElementTree as ET

xlsx_path    = sys.argv[1]
tab_name_arg = sys.argv[2] if len(sys.argv) > 2 else ""
sku_col_name = sys.argv[3].upper() if len(sys.argv) > 3 else "L"

def col_name_to_num_simple(name):
    n = 0
    for ch in name.upper():
        n = n * 26 + (ord(ch) - 64)
    return n

HEADER_ROW = 3
DATA_START  = 4
CBM_COL     = 2    # B
SKU_COL     = col_name_to_num_simple(sku_col_name)
ETA_OFFSET  = 5
CONTAINER_RE = re.compile(r'^\\d{2,4}-[A-Z]{1,6}(-[A-Z\\d]+)*$')

col_name_to_num = col_name_to_num_simple

try:
    zf = zipfile.ZipFile(xlsx_path)
except Exception as e:
    print(json.dumps({"error": f"Cannot open file: {e}"}))
    sys.exit(1)

# 1. Shared strings
sst = []
try:
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
    for m in re.finditer(r'<si>(.*?)</si>', xml, re.DOTALL):
        texts = re.findall(r'<t(?:\\s[^>]*)?>([^<]*)</t>', m.group(1))
        sst.append("".join(texts))
except Exception:
    pass

# 2. Styles → fill ARGB per xf index
xf_to_argb = {}
try:
    xml = zf.read("xl/styles.xml").decode("utf-8", errors="replace")
    fills = []
    fills_sec = re.search(r'<fills[^>]*>(.*?)</fills>', xml, re.DOTALL)
    if fills_sec:
        for fill in re.finditer(r'<fill>(.*?)</fill>', fills_sec.group(1), re.DOTALL):
            m = re.search(r'<fgColor\\s+rgb="([0-9A-Fa-f]{8})"', fill.group(1))
            fills.append(m.group(1) if m else None)
    xfs_sec = re.search(r'<cellXfs[^>]*>(.*?)</cellXfs>', xml, re.DOTALL)
    if xfs_sec:
        for i, xf in enumerate(re.finditer(r'<xf\\b[^>]*/?>|<xf\\b[^>]*>.*?</xf>', xfs_sec.group(1), re.DOTALL)):
            m = re.search(r'\\bfillId="(\\d+)"', xf.group(0))
            if m:
                fid = int(m.group(1))
                if 0 <= fid < len(fills) and fills[fid]:
                    xf_to_argb[i] = fills[fid]
except Exception:
    pass

# 3. Find target sheet
wb_xml   = zf.read("xl/workbook.xml").decode("utf-8", errors="replace")
rels_xml = zf.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")

sheets_info = re.findall(r'<sheet\\b[^>]*\\bname="([^"]*)"[^>]*\\br:id="([^"]*)"', wb_xml)
rels_map    = dict(re.findall(r'\\bId="([^"]*)"[^>]*\\bTarget="([^"]*)"', rels_xml))
tab_names   = [n for n, _ in sheets_info]

target_file = None
target_name = None
for name, rid in sheets_info:
    if tab_name_arg:
        match = (name == tab_name_arg)
    else:
        match = name.startswith("L-") or name.startswith("L ") or name.startswith("L- ")
    if match:
        target_name = name
        rel = rels_map.get(rid, "")
        target_file = ("xl/" + rel) if not rel.startswith("/") else rel.lstrip("/")
        break

if not target_file or not target_file.endswith(".xml"):
    print(json.dumps({"error": "Tab not found", "tabs": tab_names}))
    sys.exit(1)

# 4. Parse sheet XML — stream directly from the zip so the full XML is never
#    loaded into memory (a 56 MB xlsx can have 300 MB+ of uncompressed sheet XML)
NS      = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
tag_row = "{" + NS + "}row"
tag_c   = "{" + NS + "}c"
tag_v   = "{" + NS + "}v"
COLRE   = re.compile(r"([A-Z]+)")

EXCEL_EPOCH = datetime.date(1899, 12, 30)
def serial_to_date(v):
    try:    return (EXCEL_EPOCH + datetime.timedelta(days=int(v))).isoformat()
    except: return None

containers = []
sku_rows   = []

with zf.open(target_file) as sheet_stream:
    context = ET.iterparse(sheet_stream, events=("start", "end"))
    _, root = next(context)

    for event, elem in context:
        if event != "end" or elem.tag != tag_row:
            continue
        rnum_str = elem.get("r")
        if not rnum_str:
            root.clear(); continue
        rnum = int(rnum_str)
        if rnum < HEADER_ROW:
            root.clear(); continue

        cells = {}
        for c in elem:
            if c.tag != tag_c: continue
            ref = c.get("r", "")
            cm  = COLRE.match(ref)
            if not cm: continue
            col_idx = col_name_to_num(cm.group(1))
            typ   = c.get("t", "")
            s_str = c.get("s")
            s_idx = int(s_str) if s_str is not None else None
            v_el  = c.find(tag_v)
            raw   = v_el.text if v_el is not None else None
            if typ == "s" and raw is not None:
                idx = int(raw); display_val = sst[idx] if idx < len(sst) else ""
            elif typ in ("str", "inlineStr") and raw is not None:
                display_val = raw
            elif raw is not None:
                try:    display_val = float(raw)
                except: display_val = raw
            else:
                display_val = None
            argb = xf_to_argb.get(s_idx) if s_idx is not None else None
            cells[col_idx] = {"val": display_val, "argb": argb}

        if rnum == HEADER_ROW:
            for col_idx, cell in cells.items():
                v = cell["val"]
                if isinstance(v, str) and CONTAINER_RE.match(v.strip()):
                    name = v.strip()
                    eta_str = None
                    ec = cells.get(col_idx + ETA_OFFSET)
                    if ec:
                        ev = ec["val"]
                        if isinstance(ev, float) and ev > 40000:
                            eta_str = serial_to_date(ev)
                    containers.append({"colIdx": col_idx, "name": name, "etaDate": eta_str, "argb": cell["argb"]})
        elif rnum >= DATA_START:
            sku_cell = cells.get(SKU_COL)
            if not sku_cell or not sku_cell["val"]:
                root.clear(); continue
            sku = str(sku_cell["val"]).strip().upper()
            if not sku:
                root.clear(); continue
            cbm_cell = cells.get(CBM_COL)
            cbm_val  = cbm_cell["val"] if cbm_cell else None
            cbm      = float(cbm_val) if isinstance(cbm_val, (int, float)) and cbm_val > 0 else None
            qtys = {}
            for cg in containers:
                qty_cell = cells.get(cg["colIdx"])
                if qty_cell:
                    qv = qty_cell["val"]
                    if isinstance(qv, (int, float)):
                        rounded = round(qv)
                        if rounded > 0:
                            qtys[cg["name"]] = rounded
            sku_rows.append({"masterSku": sku, "cbmUnit": cbm, "qtys": qtys})
        root.clear()

print(json.dumps({"tab": target_name, "containers": containers, "skuRows": sku_rows}))
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContainerInfo {
  colIdx: number;
  name: string;
  etaDate: string | null;
  argb: string | null;
}

interface SkuRowRaw {
  masterSku: string;
  cbmUnit: number | null;
  qtys: Record<string, number>;
}

interface ExtractionResult {
  tab: string;
  containers: ContainerInfo[];
  skuRows: SkuRowRaw[];
  error?: string;
  tabs?: string[];
}

interface ContainerGroup {
  name: string;
  status: string;
  etaDate: string | null;
}

// ─── Color → status ───────────────────────────────────────────────────────────

function argbToStatus(argb: string | null, containerName: string): string {
  if (!argb || argb.length < 6) return "draft";
  const hex = argb.length === 8 ? argb.slice(2) : argb.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const isBlue   = b > r && b > g && b - r > 50 && b - g > 10;
  const isOrange = r > b && g >= b && r - b > 60;
  const detected = isBlue ? "blue" : isOrange ? "orange" : "purple/other";
  const status   = isBlue ? "shipped" : isOrange ? "packing_received" : "draft";
  console.log(`  color(${containerName}): #${hex} → ${detected} → ${status}`);
  return status;
}

// ─── Google Sheets download ───────────────────────────────────────────────────
// Uses https.get (fires real per-packet data events; fetch/undici buffers the whole
// body first). Note: for large sheets, Google generates the xlsx server-side BEFORE
// sending any bytes — that wait can take minutes with no data flowing, which is why
// resolveLocalPath() runs a time-based heartbeat around the whole download.

// Error carrying how many bytes had arrived before it failed (for clearer logs).
class DownloadError extends Error {
  bytesDownloaded: number;
  httpStatus: number | null;
  constructor(message: string, bytesDownloaded = 0, httpStatus: number | null = null) {
    super(message);
    this.name = "DownloadError";
    this.bytesDownloaded = bytesDownloaded;
    this.httpStatus = httpStatus;
  }
}

// A 4xx from Google (not shared / not found) won't fix itself on retry; anything
// else (aborted/reset/timeout/5xx/truncation) is worth another attempt.
function isRetryable(err: unknown): boolean {
  if (err instanceof DownloadError && err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 500) {
    return false;
  }
  return true;
}

function downloadToFile(
  url: string,
  dest: string,
  onFirstByte: () => void,
  redirectsLeft = 5
): Promise<number> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, (res) => {
      if (
        (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) &&
        res.headers.location
      ) {
        if (redirectsLeft <= 0) { reject(new DownloadError("Too many redirects")); return; }
        res.resume(); // drain body to free socket before following redirect
        downloadToFile(res.headers.location, dest, onFirstByte, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new DownloadError(`HTTP ${res.statusCode} ${res.statusMessage}`, 0, res.statusCode ?? null));
        return;
      }
      const cl = res.headers["content-length"];
      const expectedBytes = cl ? parseInt(cl) : null;
      const totalMB = expectedBytes ? expectedBytes / 1024 / 1024 : null;
      let downloaded = 0, lastLogged = 0, gotFirstByte = false;
      const out = fs.createWriteStream(dest);

      const fail = (err: Error) => {
        out.destroy();
        reject(err instanceof DownloadError ? err : new DownloadError(err.message, downloaded));
      };

      res.on("data", (chunk: Buffer) => {
        if (!gotFirstByte) { gotFirstByte = true; onFirstByte(); }
        downloaded += chunk.length;
        const mb = downloaded / 1024 / 1024;
        if (mb - lastLogged >= 5) {
          const total = totalMB ? ` / ${totalMB.toFixed(1)} MB` : "";
          console.log(`Downloading... ${mb.toFixed(1)} MB${total}`);
          lastLogged = mb;
        }
      });
      res.pipe(out);
      out.on("finish", () => {
        // Guard against a silent short read: a truncated xlsx would blow up the
        // Python parser with a confusing "not a zip" error instead of a retry.
        if (expectedBytes !== null && downloaded < expectedBytes) {
          fail(new DownloadError(`incomplete download: got ${downloaded} of ${expectedBytes} bytes`, downloaded));
          return;
        }
        resolve(downloaded);
      });
      res.on("error", fail);
      out.on("error", fail);
    });
    req.on("error", (err) => reject(new DownloadError(err.message)));
  });
}

async function resolveLocalPath(): Promise<{ xlsxPath: string; tempFile: string | null }> {
  const isGoogleSheets =
    input.includes("docs.google.com") || input.includes("spreadsheets");

  if (!isGoogleSheets) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      console.error("File not found:", resolved);
      process.exit(1);
    }
    return { xlsxPath: resolved, tempFile: null };
  }

  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    console.error("Could not extract sheet ID from:", input);
    process.exit(1);
  }
  const sheetId   = m[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

  // Cache the downloaded workbook per sheet ID so a dry run followed by the real
  // run (or a retry after a failed import) can skip the slow Google export. The
  // export is the whole workbook regardless of tab, so the sheet ID is the key.
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const cachePath = path.join(os.tmpdir(), `sheet-import-cache-${sheetId}.xlsx`);

  if (!forceDownload && fs.existsSync(cachePath)) {
    const ageMs = Date.now() - fs.statSync(cachePath).mtimeMs;
    if (ageMs < CACHE_TTL_MS) {
      const ageStr = ageMs >= 60000 ? `${Math.floor(ageMs / 60000)}m` : `${Math.round(ageMs / 1000)}s`;
      console.log(`Reusing file downloaded ${ageStr} ago — skipping download.`);
      console.log("(Enable 'Force fresh download' if you've edited the sheet since.)");
      return { xlsxPath: cachePath, tempFile: null };
    }
  }

  // Download to a .part file, then atomically promote it to the cache path only on
  // success, so an interrupted transfer can never leave a corrupt cache behind.
  const partPath = `${cachePath}.${Date.now()}.part`;
  const MAX_ATTEMPTS = 4;
  let lastErr: DownloadError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      console.log("Requesting export from Google...");
      console.log("(Google builds the file server-side first — for large sheets this can take a few minutes with no bytes flowing yet.)");
    } else {
      console.log(`Retrying download — attempt ${attempt} of ${MAX_ATTEMPTS}...`);
    }

    // Heartbeat: Google sends no bytes while generating the xlsx, so a byte-based
    // progress bar would sit silent. Tick elapsed time until the first byte arrives.
    const startTime = Date.now();
    let receiving = false;
    const heartbeat = setInterval(() => {
      if (receiving) return;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`Waiting for Google to finish preparing the file... (${elapsed}s)`);
    }, 3000);

    try {
      const totalBytes = await downloadToFile(exportUrl, partPath, () => {
        receiving = true;
        console.log("File ready — downloading now...");
      });
      clearInterval(heartbeat);
      fs.renameSync(partPath, cachePath);
      console.log(`Download complete: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
      return { xlsxPath: cachePath, tempFile: null };
    } catch (err) {
      clearInterval(heartbeat);
      lastErr = err instanceof DownloadError ? err : new DownloadError(String(err));
      try { fs.unlinkSync(partPath); } catch {}

      const atMb = lastErr.bytesDownloaded > 0
        ? ` after ${(lastErr.bytesDownloaded / 1024 / 1024).toFixed(1)} MB`
        : "";

      if (isRetryable(lastErr) && attempt < MAX_ATTEMPTS) {
        console.log(`Download interrupted${atMb}: ${lastErr.message} — retrying in a moment...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      break; // non-retryable, or out of attempts
    }
  }

  console.error(`Download failed after ${MAX_ATTEMPTS} attempt(s): ${lastErr?.message}`);
  if (lastErr?.httpStatus && lastErr.httpStatus >= 400 && lastErr.httpStatus < 500) {
    console.error("Make sure the sheet is shared as 'Anyone with the link can view'.");
  }
  try { fs.unlinkSync(partPath); } catch {}
  process.exit(1);
}

// ─── Parse xlsx via Python subprocess ────────────────────────────────────────

function parseXlsx(xlsxPath: string): ExtractionResult {
  const scriptPath = path.join(os.tmpdir(), `_extract_containers_${Date.now()}.py`);
  fs.writeFileSync(scriptPath, PYTHON_SCRIPT);

  const args = [scriptPath, xlsxPath];
  args.push(tabArg ?? "");
  args.push(skuColArg);

  console.log("Parsing xlsx via Python (avoids ExcelJS memory limits)...");
  const result = spawnSync("python3", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });

  fs.unlinkSync(scriptPath);

  if (result.error) {
    console.error("Failed to spawn python3:", result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "(no output — process may have been killed by the OS out-of-memory killer)";
    const signal = result.signal ? ` killed by signal ${result.signal}` : ` exit code ${result.status}`;
    console.error(`Python extraction failed (${signal}):\n${detail}`);
    process.exit(1);
  }

  const stdout = result.stdout.trim();
  const lastLine = stdout.split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(lastLine) as ExtractionResult;
  } catch {
    console.error("Could not parse Python output:\n", stdout);
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (dryRun) console.log("DRY RUN — no DB writes\n");

  const { xlsxPath, tempFile } = await resolveLocalPath();
  const extracted = parseXlsx(xlsxPath);
  if (tempFile) try { fs.unlinkSync(tempFile); } catch {}

  if (extracted.error) {
    console.error(`Extraction error: ${extracted.error}`);
    if (extracted.tabs) console.error("Available tabs:", extracted.tabs);
    process.exit(1);
  }

  console.log(`\nSheet: "${extracted.tab}"`);

  // ── Resolve container statuses from fill colors ───────────────────────────
  const containers: ContainerGroup[] = extracted.containers.map((c) => ({
    name: c.name,
    status: argbToStatus(c.argb, c.name),
    etaDate: c.etaDate,
  }));

  if (containers.length === 0) {
    console.error("\nNo container columns found in row 3. Check the tab name and header layout.");
    process.exit(1);
  }

  console.log(`\nFound ${containers.length} container(s):`);
  for (const cg of containers) {
    console.log(`  ${cg.name} | status=${cg.status} | eta=${cg.etaDate ?? "(none)"}`);
  }

  const skuRows = extracted.skuRows;
  const totalItems = skuRows.reduce((sum, r) => sum + Object.keys(r.qtys).length, 0);
  console.log(
    `\nParsed ${skuRows.length} SKU rows | ${totalItems} container-item entries | ${skuRows.filter((r) => r.cbmUnit !== null).length} CBM updates`
  );

  if (dryRun) {
    console.log("\nDry-run preview (first 15 SKUs):");
    for (const r of skuRows.slice(0, 15)) {
      const qtyStr = Object.entries(r.qtys)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      console.log(`  ${r.masterSku} | cbm=${r.cbmUnit ?? "-"} | ${qtyStr || "(no qtys)"}`);
    }
    console.log("\nContainers:");
    for (const cg of containers) {
      console.log(`  ${cg.name} | status=${cg.status} | eta=${cg.etaDate ?? "(none)"}`);
    }
    return;
  }

  // ── DB writes ─────────────────────────────────────────────────────────────
  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Update cbm_per_unit on fc_products for every SKU with a CBM value
    let cbmUpdated = 0;
    for (const r of skuRows) {
      if (r.cbmUnit === null) continue;
      const res = await client.query(
        `UPDATE shipcore.fc_products SET cbm_per_unit = $1, updated_at = NOW() WHERE master_sku = $2`,
        [r.cbmUnit, r.masterSku]
      );
      if ((res.rowCount ?? 0) > 0) cbmUpdated++;
    }
    console.log(`\nUpdated cbm_per_unit for ${cbmUpdated} SKUs in fc_products.`);

    // 2. Validate SKUs — only insert items for SKUs that exist in fc_products
    const allSkus = [...new Set(skuRows.map((r) => r.masterSku))];
    const skuResult = await client.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [allSkus]
    );
    const validSkus = new Set(skuResult.rows.map((r) => r.master_sku));
    const skippedSkus = allSkus.filter((s) => !validSkus.has(s));
    if (skippedSkus.length > 0) {
      console.log(`Skipping ${skippedSkus.length} SKU(s) not in fc_products: ${skippedSkus.join(", ")}`);
    }

    // 3. Upsert containers by container_number; collect their IDs
    const containerIds = new Map<string, string>();
    let insertedContainers = 0;
    let updatedContainers = 0;
    for (const cg of containers) {
      const res = await client.query<{ id: string; existed: boolean }>(
        `INSERT INTO shipcore.fc_containers
           (container_number, eta_date, status, cbm_capacity, created_at, updated_at)
         VALUES ($1, $2::date, $3::shipcore.fc_container_status, $4, NOW(), NOW())
         ON CONFLICT (container_number) DO UPDATE
           SET eta_date     = EXCLUDED.eta_date,
               status       = EXCLUDED.status,
               cbm_capacity = EXCLUDED.cbm_capacity,
               updated_at   = NOW()
         RETURNING id::text, (xmax <> 0) AS existed`,
        [cg.name, cg.etaDate, cg.status, CBM_CAPACITY_DEFAULT]
      );
      const { id, existed } = res.rows[0];
      containerIds.set(cg.name, id);
      if (existed) updatedContainers++; else insertedContainers++;
    }
    console.log(`\nContainers: ${insertedContainers} inserted, ${updatedContainers} updated.`);

    // 4. Load existing items for these containers so we can upsert without a unique constraint
    const containerIdList = [...containerIds.values()];
    const containerIdToName = new Map([...containerIds.entries()].map(([name, id]) => [id, name]));
    const existingItemsRes = await client.query<{ id: string; container_id: string; master_sku: string }>(
      `SELECT id::text, container_id::text, master_sku
       FROM shipcore.fc_container_items
       WHERE container_id = ANY($1::bigint[])`,
      [containerIdList]
    );
    // existingMap: containerName → master_sku → item id
    const existingMap = new Map<string, Map<string, string>>();
    for (const row of existingItemsRes.rows) {
      const cName = containerIdToName.get(row.container_id);
      if (!cName) continue;
      if (!existingMap.has(cName)) existingMap.set(cName, new Map());
      existingMap.get(cName)!.set(row.master_sku, row.id);
    }

    // 5. Upsert container items — update qty/cbm if row exists, insert otherwise
    let inserted = 0;
    let itemsUpdated = 0;
    for (const r of skuRows) {
      if (!validSkus.has(r.masterSku)) continue;
      for (const [containerName, qty] of Object.entries(r.qtys)) {
        const containerId = containerIds.get(containerName);
        if (!containerId) continue;
        const existingId = existingMap.get(containerName)?.get(r.masterSku);
        if (existingId) {
          await client.query(
            `UPDATE shipcore.fc_container_items
             SET qty = $1, cbm_unit = $2, updated_at = NOW()
             WHERE id = $3::bigint`,
            [qty, r.cbmUnit, existingId]
          );
          itemsUpdated++;
        } else {
          await client.query(
            `INSERT INTO shipcore.fc_container_items
               (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
             VALUES ($1::bigint, $2, $3::int, $4::numeric, NOW(), NOW())`,
            [containerId, r.masterSku, qty, r.cbmUnit]
          );
          inserted++;
        }
      }
    }

    await client.query("COMMIT");
    console.log(
      `\nDone. ${insertedContainers} containers inserted, ${updatedContainers} updated, ${inserted} items inserted, ${itemsUpdated} items updated, ${cbmUpdated} CBM values updated.`
    );
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
