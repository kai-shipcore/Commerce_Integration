import { carCoverSegments } from "@/lib/planning/sku-format";

// Source master SKUs counted as another SKU: their sales (Velocity sync, OOS
// Impact) and their stock (Demand Planning) are added onto the target's row,
// and the source gets no row of its own.
//
// CC-CSP-03-M-GR-1TO used to be here, folded onto CC-CS-03-M-GR-1TO. CSP and CS
// are separate products to the planning team (2026-11-20): the fold put CSP's
// 42 units at TTM Group on the CS row, which holds none there itself. Each now
// keeps its own sales and stock. Do not add a CSP -> CS entry back.
const MASTER_SKU_REMAP: Record<string, string> = {
  "CC-CP-07-N-GR": "CC-CP-03-M-GR-1TO",
  "C-SJ-GR-7": "CC-CS-03-J-GR-1TO",
};

const LEGACY_SWC_PATTERN = /^CA-([^-]+)-SWC-(.+)$/;

export function normalizeMasterSku(masterSku: string): string {
  const trimmed = masterSku.trim();
  const remapped = MASTER_SKU_REMAP[trimmed] ?? trimmed;
  return remapped.replace(LEGACY_SWC_PATTERN, "CA-SWC-$1-$2");
}

function exactRemapWhensSql(skuExpression: string): string {
  return Object.entries(MASTER_SKU_REMAP)
    .map(([from, to]) => `WHEN ${skuExpression} = '${from}' THEN '${to}'`)
    .join(" ");
}

/** The SKU a source SKU's stock is counted under: the exact remaps only, the
 *  same rule as `inventoryMasterSkuSql`. Legacy SWC spellings keep their own
 *  SKU for stock. */
export function inventoryMasterSku(masterSku: string): string {
  const trimmed = masterSku.trim();
  return MASTER_SKU_REMAP[trimmed] ?? trimmed;
}

export function normalizedMasterSkuSql(skuExpression: string): string {
  return `CASE
    WHEN BTRIM(${skuExpression}) ~ '^CA-[^-]+-SWC-.+$'
      THEN regexp_replace(BTRIM(${skuExpression}), '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\\1-\\2')
    ${exactRemapWhensSql(skuExpression)}
    ELSE BTRIM(${skuExpression})
  END`;
}

// Inventory keeps a legacy SWC SKU (CA-10-SWC-47-BKBK) on its own row instead
// of folding it onto the current one (CA-SWC-10-47-BKBK). Folding it summed two
// warehouse lines into one figure that matched nothing in the Inventory page:
// CA-SWC-10-47-BKBK read 185 in Demand Planning against 89 on the shelf under
// that SKU (2026-11-12). Sales still fold through normalizedMasterSkuSql,
// since orders placed before the 2026-07-22 rename carry the legacy spelling
// and the current SKU's history would otherwise start at the rename.
// The exact remaps in MASTER_SKU_REMAP still apply to stock.
export function inventoryMasterSkuSql(skuExpression: string): string {
  return `CASE
    ${exactRemapWhensSql(skuExpression)}
    ELSE BTRIM(${skuExpression})
  END`;
}

// ─── Replacement-part master SKUs ───────────────────────────────────────
//
// A part SKU carries PART (or PARTS) as its own hyphen-delimited segment:
// CA-SC-PART-ARM5-BR, and the three aggregate rows BACK-SEAT-COVER-PARTS,
// FRONT-SEAT-COVER-PARTS, INDV-SEAT-COVER-PART. Matched as a segment rather
// than as a substring so a SKU that merely contains the letters — PARTNER,
// say — is not read as a part.
//
// Derived on read rather than stored. fc_products.sales_status did hold 'Part'
// for some rows, written once by 20260625100000_sync_part_status_to_fc_products
// from fc_replacement_parts; that table was dropped in
// 20260729183216_remove_seat_cover_parts, leaving nothing to classify the
// parts added since — 190 of 293 were falling through to 'Original'. Deriving
// from the SKU keeps new part SKUs classified without a job to run, the same
// reason is_custom_sku was dropped in favour of a derived Original/Custom.
const PART_SEGMENT_PATTERN = "(^|-)PARTS?(-|$)";

export function isPartMasterSku(masterSku: string): boolean {
  return new RegExp(PART_SEGMENT_PATTERN, "i").test(masterSku.trim());
}

/** The same rule as `isPartMasterSku`, for a SQL expression. `~*` is
 *  Postgres' case-insensitive regex match. */
export function partMasterSkuSql(skuExpression: string): string {
  return `BTRIM(${skuExpression}) ~* '${PART_SEGMENT_PATTERN}'`;
}

// ─── Final (current-production) master SKU ──────────────────────────────
//
// Distinct from normalizeMasterSku above: that one merges rows, this one only
// names the SKU the factory now produces. `TN` and `BKGR` are no longer
// ordered — their replacements are `TNS` and `BKLG` — but stock still sits on
// the old SKUs, so the two must stay separate rows while demand rolls up onto
// the final one.
//
// The two remaps live on different segments (line and colour). Where those
// sit depends on the SKU format, so they are found with carCoverSegments:
// CC-TN-15-B-BKGR-STR and CA-CC-15-TN-B-BKGR-STR both become …TNS…BKLG….
const FINAL_CAR_COVER_LINE_REMAP: Record<string, string> = {
  TN: "TNS",
};

const FINAL_CAR_COVER_COLOR_REMAP: Record<string, string> = {
  BKGR: "BKLG",
};

// A SKU that is not a car cover is read at the positions of the current
// car cover format, as it always was.
const LEGACY_LINE_SEGMENT_INDEX = 1;
const LEGACY_COLOR_SEGMENT_INDEX = 4;

export function toFinalMasterSku(masterSku: string): string {
  const parts = masterSku.split("-");
  const segments = carCoverSegments(masterSku);
  const lineIndex = segments ? segments.line : LEGACY_LINE_SEGMENT_INDEX;
  const colorIndex = segments ? segments.color : LEGACY_COLOR_SEGMENT_INDEX;

  if (lineIndex !== null) {
    const line = FINAL_CAR_COVER_LINE_REMAP[parts[lineIndex]];
    if (line) parts[lineIndex] = line;
  }

  const color = FINAL_CAR_COVER_COLOR_REMAP[parts[colorIndex]];
  if (color) parts[colorIndex] = color;

  return parts.join("-");
}
