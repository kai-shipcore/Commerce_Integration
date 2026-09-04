const MASTER_SKU_REMAP: Record<string, string> = {
  "CC-CP-07-N-GR": "CC-CP-03-M-GR-1TO",
  "CC-CSP-03-M-GR-1TO": "CC-CS-03-M-GR-1TO",
  "C-SJ-GR-7": "CC-CS-03-J-GR-1TO",
};

const LEGACY_SWC_PATTERN = /^CA-([^-]+)-SWC-(.+)$/;

export function normalizeMasterSku(masterSku: string): string {
  const trimmed = masterSku.trim();
  const remapped = MASTER_SKU_REMAP[trimmed] ?? trimmed;
  return remapped.replace(LEGACY_SWC_PATTERN, "CA-SWC-$1-$2");
}

export function normalizedMasterSkuSql(skuExpression: string): string {
  const exactWhens = Object.entries(MASTER_SKU_REMAP)
    .map(([from, to]) => `WHEN ${skuExpression} = '${from}' THEN '${to}'`)
    .join(" ");

  return `CASE
    WHEN BTRIM(${skuExpression}) ~ '^CA-[^-]+-SWC-.+$'
      THEN regexp_replace(BTRIM(${skuExpression}), '^CA-([^-]+)-SWC-(.+)$', 'CA-SWC-\\1-\\2')
    ${exactWhens}
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
// Car Cover master SKUs are 6 segments: CC-<line>-<series>-<model>-<color>-<suffix>.
// The two remaps live on different segments, so they are keyed by position.
const FINAL_CAR_COVER_LINE_REMAP: Record<string, string> = {
  TN: "TNS",
};

const FINAL_CAR_COVER_COLOR_REMAP: Record<string, string> = {
  BKGR: "BKLG",
};

const LINE_SEGMENT_INDEX = 1;
const COLOR_SEGMENT_INDEX = 4;

export function toFinalMasterSku(masterSku: string): string {
  const parts = masterSku.split("-");

  const line = FINAL_CAR_COVER_LINE_REMAP[parts[LINE_SEGMENT_INDEX]];
  if (line) parts[LINE_SEGMENT_INDEX] = line;

  const color = FINAL_CAR_COVER_COLOR_REMAP[parts[COLOR_SEGMENT_INDEX]];
  if (color) parts[COLOR_SEGMENT_INDEX] = color;

  return parts.join("-");
}
