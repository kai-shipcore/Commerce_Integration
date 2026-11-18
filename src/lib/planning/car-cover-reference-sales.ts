/**
 * Code Guide:
 * Car Cover Fabric 03: a -BK SKU's sales reference the matching -GR SKU.
 *
 * A Fabric 03 (PVC) car cover in black is planned off the grey one. Each of the
 * BK SKU's sales figures is the higher of its own figure and 30% of the same
 * figure on the matching GR SKU. The GR SKU's figures are not reduced.
 * (Planning team rule, 2026-11-18. Example: CC-TT-03-Y-GR-1TO at 49 / 36 / 15 /
 * 8 / 3 gives CC-TT-03-Y-BK-1TO 15 / 11 / 5 / 2 / 1.)
 *
 * Applied where the Demand Planning dashboard resolves a row's sales, so the
 * sales columns and every average derived from them follow. The Velocity page
 * and the stored fc_stats columns keep the BK SKU's own sales.
 */

/** Share of the GR SKU's sales a Fabric 03 BK SKU is planned on. */
export const FABRIC_03_BK_REFERENCE_SHARE = 0.3;

// Car Cover master SKUs are 6 segments: CC-<line>-<fabric>-<size>-<color>-<colorType>.
const CAR_COVER_SEGMENTS = 6;
const FABRIC_SEGMENT_INDEX = 2;
const COLOR_SEGMENT_INDEX = 4;

/**
 * The GR SKU a Fabric 03 BK car cover takes its reference sales from, or null
 * for any other SKU. Only the one-colour `BK` matches: BKGR, BKRD and the like
 * are their own colours.
 */
export function fabric03ReferenceSku(masterSku: string): string | null {
  const parts = masterSku.trim().toUpperCase().split("-");
  if (parts.length !== CAR_COVER_SEGMENTS) return null;
  if (parts[0] !== "CC" || parts[FABRIC_SEGMENT_INDEX] !== "03" || parts[COLOR_SEGMENT_INDEX] !== "BK") return null;
  parts[COLOR_SEGMENT_INDEX] = "GR";
  return parts.join("-");
}

/**
 * The higher of the SKU's own figure and the share of the reference SKU's,
 * key by key. Unit counts are rounded to a whole unit, as on the planning
 * sheet; the keys in `averageKeys` are daily averages and stay unrounded.
 */
export function withReferenceSales<K extends string>(
  own: Record<K, number>,
  reference: Record<K, number>,
  averageKeys: ReadonlySet<string>,
  share = FABRIC_03_BK_REFERENCE_SHARE,
): Record<K, number> {
  const result = { ...own };
  for (const key of Object.keys(own) as K[]) {
    const scaled = (reference[key] ?? 0) * share;
    result[key] = Math.max(own[key], averageKeys.has(key) ? scaled : Math.round(scaled));
  }
  return result;
}
