/**
 * Code Guide:
 * Reading a master SKU's shape, in the format in use and the one replacing it.
 *
 * The SKU format is being unified (planning team sheet, 2026-11-18):
 *
 *   CA-<product>-<material>-<identifier 1>-<identifier 2>-<colour>-<style>
 *
 *   Car Cover        CC-CN-15-B-BKLG-STR      -> CA-CC-15-CN-B-BKLG-STR
 *   Custom Cover     CC-CC-03-CHCV15-BK-1TO   -> CA-CC-03-CC-CHCV15-BK-1TO
 *   Steering Wheel   CA-SWC-05-38-BKBK        -> CA-SW-13-AG-38-BK-1TO
 *   Floor Mat        CA-FM-80-FM13726         -> CA-FM-80-FS-13726-BK-1TO
 *   Floor Mat 3rd    CA-FM-TX-80-S3-BM-X705   -> CA-FM-80-S3-BM-X705-BK-1TO
 *   Seat Cover       CA-SC-10-F-10-BK-1TO        (already this shape)
 *   Neck Pillow      CA-NP-01-BK              -> CA-NP-15-F-01-BK-1TO
 *   Towel            CA-TW-02-MIX             -> CA-TW-71-4PS-02-MIX-4TO
 *   Windshield       CA-WS-10-WS15113         -> CA-WS-01-W-15113-BKSV-2TO
 *
 * Both have to be read for good, not for a changeover window: discontinued
 * SKUs keep their old code (CA-SWC-03-38-BKDI, CA-TW-01-MIX), and sales history
 * sits under the old codes.
 *
 * Two things about the new shape that a segment count gets wrong:
 *  - Identifier 2 can hold a hyphen (BM-X705), so a SKU is 7 segments or more.
 *    Read product / material / identifier 1 from the front and colour / style
 *    from the back; identifier 2 is whatever lies between.
 *  - For a car cover the fabric moved in front of the line, so a fixed index
 *    that reads the line in one format reads the fabric in the other. Use
 *    `carCoverSegments`.
 *
 * What a SKU *is* (its category) is stored on fc_products.category_code and
 * that stays the first thing to read. The helpers here are for the places
 * that only have the SKU text: a SKU not in fc_products yet, and SQL that
 * classifies a raw SKU column.
 *
 * Linking an old code to the new code for the same product (so its sales
 * history carries over) is not done here. Car Cover and Floor Mat convert by
 * rule, the rest need a list from the planning team.
 *
 * Pure and client-safe.
 */

function upperParts(masterSku: string): string[] {
  return masterSku.trim().toUpperCase().split("-");
}

const NUMERIC = /^\d+$/;
/** 1TO, 2TO, 4TO (tones), STR (stripe), STI (stitch only). */
const STYLE_PATTERN = /^(\d+TO|STR|STI)$/;

// ─── Category from the SKU text ─────────────────────────────────────────

/** A car cover in either format: CC-… or CA-CC-…. */
export function isCarCoverSku(masterSku: string): boolean {
  const sku = masterSku.trim().toUpperCase();
  return sku.startsWith("CC-") || sku.startsWith("CA-CC-");
}

/**
 * A steering wheel cover in either format. The old code carries SWC somewhere
 * in it (CA-SWC-05-38-BKBK, and CA-10-SWC-47-BKBK before the 2026-07 rename);
 * the new one is the SW product (CA-SW-13-AG-38-BK-1TO).
 */
export function isSteeringWheelSku(masterSku: string): boolean {
  const sku = masterSku.trim().toUpperCase();
  return sku.includes("SWC") || sku.startsWith("CA-SW-");
}

/** `isCarCoverSku` for a SQL expression. */
export function carCoverSkuSql(skuExpression: string): string {
  return `(UPPER(${skuExpression}) LIKE 'CC-%' OR UPPER(${skuExpression}) LIKE 'CA-CC-%')`;
}

/** `isSteeringWheelSku` for a SQL expression. */
export function steeringWheelSkuSql(skuExpression: string): string {
  return `(UPPER(${skuExpression}) LIKE '%SWC%' OR UPPER(${skuExpression}) LIKE 'CA-SW-%')`;
}

// ─── Car cover segments ─────────────────────────────────────────────────

export interface CarCoverSegments {
  /** The SKU split on "-", upper-cased. The indices below point into it. */
  parts: string[];
  /** Vehicle line (CN, TT, CC for a custom cover); null on the oldest SKUs, which have none. */
  line: number | null;
  fabric: number;
  size: number;
  color: number;
  style: number;
}

/**
 * Where a car cover SKU keeps each of its parts, or null when the SKU is not
 * a car cover.
 *
 *   CA-CC-<fabric>-<line>-<size>-<colour>-<style>   new
 *   CC-<line>-<fabric>-<size>-<colour>-<style>      current
 *   CA-CC-<line>-<fabric>-…                         current, keyed with the accessories prefix
 *   CC-<fabric>-<size>-<colour>-<style>             oldest, no line
 *
 * The new and the CA-prefixed current shape are told apart by which of the
 * two segments after CA-CC is the numeric fabric.
 */
export function carCoverSegments(masterSku: string): CarCoverSegments | null {
  const parts = upperParts(masterSku);
  if (parts[0] === "CC") {
    return NUMERIC.test(parts[1] ?? "")
      ? { parts, line: null, fabric: 1, size: 2, color: 3, style: 4 }
      : { parts, line: 1, fabric: 2, size: 3, color: 4, style: 5 };
  }
  if (parts[0] === "CA" && parts[1] === "CC") {
    return NUMERIC.test(parts[2] ?? "")
      ? { parts, line: 3, fabric: 2, size: 4, color: 5, style: 6 }
      : { parts, line: 2, fabric: 3, size: 4, color: 5, style: 6 };
  }
  return null;
}

// ─── The unified format ─────────────────────────────────────────────────

export interface UnifiedSku {
  /** CC, SC, FM, SW, NP, TW, WS. */
  product: string;
  material: string;
  identifier1: string;
  /** May contain a hyphen (BM-X705). */
  identifier2: string;
  color: string;
  style: string;
}

/**
 * A SKU in the unified format, or null when it is not in it. Recognised by
 * the CA prefix, a numeric material third, a known style last, and at least
 * seven segments, which no current-format SKU other than a seat cover (already
 * unified) satisfies: CA-FM-TX-80-S3-BM-X705 has TX where the material goes.
 */
export function parseUnifiedSku(masterSku: string): UnifiedSku | null {
  const parts = upperParts(masterSku);
  if (parts.length < 7 || parts[0] !== "CA") return null;
  if (!NUMERIC.test(parts[2]) || !STYLE_PATTERN.test(parts[parts.length - 1])) return null;
  return {
    product: parts[1],
    material: parts[2],
    identifier1: parts[3],
    identifier2: parts.slice(4, parts.length - 2).join("-"),
    color: parts[parts.length - 2],
    style: parts[parts.length - 1],
  };
}
