/**
 * Shared vocabulary for floor mat set links (shipcore.fc_floor_mat_sets):
 * the sales statuses, the shape of a set record, and the parsing rules the
 * SKU Master page (browser) and its API (server) both apply to user input.
 * No DB or React imports, so both sides can use it.
 */

/** Sales statuses that only apply to floor mat SKUs. */
export const FLOOR_MAT_SALES_STATUSES = ["1+2 Set", "1+2+3 Set", "1st Row", "2nd Row", "3rd Row"] as const;
export type FloorMatSalesStatus = (typeof FLOOR_MAT_SALES_STATUSES)[number];

/** Every value SKU Master may store in fc_products.sales_status (the Type column). */
export const OVERRIDE_SALES_STATUSES = ["Hold", "Discontinued", "TBD", ...FLOOR_MAT_SALES_STATUSES] as const;
export type OverrideSalesStatus = (typeof OVERRIDE_SALES_STATUSES)[number];

const statusKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/\(\s*-c\s*\)/g, "") // the sheet writes "1+2+3 Set (-C)"
    .replace(/\s+/g, "");

const STATUS_BY_KEY = new Map(OVERRIDE_SALES_STATUSES.map((value) => [statusKey(value), value] as const));

/** Case- and spacing-insensitive match ("1+2set", "1+2+3 Set (-C)", "hold"). */
export function parseOverrideSalesStatus(value: unknown): OverrideSalesStatus | undefined {
  return STATUS_BY_KEY.get(statusKey(String(value ?? "")));
}

export function isFloorMatSalesStatus(value: unknown): value is FloorMatSalesStatus {
  return (FLOOR_MAT_SALES_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Whether a row's back order builds up along the container chain, i.e. grows
 * by the forecast sales a container cannot cover. It does for sellable items:
 * full sets, the 3rd Row, and every non-floor-mat SKU. The 1st / 2nd Row
 * components are mostly consumed into sets, so a forecast shortfall on them
 * would double count the set's own; they show only their live back order.
 */
export function accumulatesBackorder(salesStatus: string | null | undefined): boolean {
  return salesStatus !== "1st Row" && salesStatus !== "2nd Row";
}

export function isFloorMatSku(masterSku: string): boolean {
  return masterSku.trim().toUpperCase().startsWith("CA-FM-");
}

export interface FloorMatThirdRow {
  sku: string;
  /** "3열 Pre-Order 가능?" for this master + 3rd Row pair. */
  preOrder: boolean | null;
}

export interface FloorMatSet {
  frontSku: string | null;
  rearSku: string | null;
  /** "1~2열 Pre-Order 가능?" */
  preOrder12: boolean | null;
  /** "3열 Pre-Order 가능?" when the SKU has no 3rd Row links of its own. */
  preOrder3: boolean | null;
  thirdRows: FloorMatThirdRow[];
  oldSetSkus: string[];
}

export function emptyFloorMatSet(): FloorMatSet {
  return { frontSku: null, rearSku: null, preOrder12: null, preOrder3: null, thirdRows: [], oldSetSkus: [] };
}

export function isEmptyFloorMatSet(set: FloorMatSet): boolean {
  return (
    !set.frontSku &&
    !set.rearSku &&
    set.preOrder12 == null &&
    set.preOrder3 == null &&
    set.thirdRows.length === 0 &&
    set.oldSetSkus.length === 0
  );
}

export function sameFloorMatSet(a: FloorMatSet | null, b: FloorMatSet | null): boolean {
  return JSON.stringify(a ?? emptyFloorMatSet()) === JSON.stringify(b ?? emptyFloorMatSet());
}

const normalizeSku = (value: unknown) => String(value ?? "").trim().toUpperCase();

/**
 * One cell holding several values, one per line (how the planning sheet
 * writes them) or separated by "|" (safer in a CSV). Blank entries are kept so
 * positions still line up with a sibling column; trailing blanks are dropped.
 */
export function splitMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim());
  const parts = String(value ?? "")
    .split(/\r?\n|\|/)
    .map((part) => part.trim());
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** A multi-value cell of SKUs: upper-cased, blanks and repeats removed. */
export function parseSkuList(value: unknown): string[] {
  return [...new Set(splitMultiValue(value).map(normalizeSku).filter(Boolean))];
}

/**
 * Yes/No cell. The planning sheet writes "None" for No. Returns null for a
 * blank and undefined for anything unrecognised, so callers can reject it.
 */
export function parsePreOrder(value: unknown): boolean | null | undefined {
  if (typeof value === "boolean") return value;
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "") return null;
  if (["yes", "y", "true", "o"].includes(normalized)) return true;
  if (["no", "n", "none", "false", "x"].includes(normalized)) return false;
  return undefined;
}

export function formatPreOrder(value: boolean | null | undefined): string {
  return value == null ? "" : value ? "Yes" : "No";
}

/**
 * Coerces untrusted input (API body) into a FloorMatSet. Throws an Error with
 * a user-facing message on a malformed value; relationship rules are checked
 * separately by validateFloorMatSet.
 */
export function coerceFloorMatSet(input: unknown): FloorMatSet {
  const raw = (input ?? {}) as Record<string, unknown>;
  const preOrder = (value: unknown, label: string) => {
    const parsed = parsePreOrder(value);
    if (parsed === undefined) throw new Error(`Invalid ${label}: ${String(value)} (use Yes or No)`);
    return parsed;
  };
  const thirdRowsRaw = Array.isArray(raw.thirdRows) ? raw.thirdRows : [];
  const thirdRows = thirdRowsRaw
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return { sku: normalizeSku(row.sku), preOrder: preOrder(row.preOrder, "3rd Row Pre-Order") };
    })
    .filter((row) => row.sku);
  return {
    frontSku: normalizeSku(raw.frontSku) || null,
    rearSku: normalizeSku(raw.rearSku) || null,
    preOrder12: preOrder(raw.preOrder12, "1~2 Row Pre-Order"),
    preOrder3: preOrder(raw.preOrder3, "3rd Row Pre-Order"),
    thirdRows,
    oldSetSkus: parseSkuList(raw.oldSetSkus),
  };
}

/** Returns a user-facing problem with the set, or null when it is fine. */
export function validateFloorMatSet(masterSku: string, set: FloorMatSet): string | null {
  const sku = normalizeSku(masterSku);
  if (isEmptyFloorMatSet(set)) return null;
  if (!isFloorMatSku(sku)) return `${sku} is not a floor mat SKU; set links and Pre-Order flags apply to CA-FM- SKUs only`;
  if (set.rearSku && !set.frontSku) return `${sku}: a 2nd Row SKU needs a 1st Row SKU`;
  if (set.frontSku && set.frontSku === set.rearSku) return `${sku}: the 1st Row and 2nd Row SKU cannot be the same`;
  const thirdSkus = set.thirdRows.map((row) => row.sku);
  if (new Set(thirdSkus).size !== thirdSkus.length) return `${sku}: the same 3rd Row SKU is listed twice`;
  const components = [set.frontSku, set.rearSku, ...thirdSkus].filter((value): value is string => Boolean(value));
  if (components.includes(sku)) return `${sku} cannot be linked to itself`;
  if (thirdSkus.some((value) => value === set.frontSku || value === set.rearSku)) {
    return `${sku}: a 3rd Row SKU cannot also be the 1st or 2nd Row SKU`;
  }
  const tooLong = [...components, ...set.oldSetSkus].find((value) => value.length > 128);
  if (tooLong) return `${sku}: SKU is longer than 128 characters: ${tooLong}`;
  return null;
}

/** Every component SKU a set points at (not the old set SKUs). */
export function floorMatSetComponentSkus(set: FloorMatSet): string[] {
  return [set.frontSku, set.rearSku, ...set.thirdRows.map((row) => row.sku)].filter(
    (value): value is string => Boolean(value)
  );
}

/** One-line summary for the import preview and audit log. */
export function describeFloorMatSet(set: FloorMatSet | null): string | null {
  if (!set || isEmptyFloorMatSet(set)) return null;
  const parts: string[] = [];
  if (set.frontSku) parts.push(`1st: ${set.frontSku}`);
  if (set.rearSku) parts.push(`2nd: ${set.rearSku}`);
  if (set.thirdRows.length > 0) {
    parts.push(
      `3rd: ${set.thirdRows
        .map((row) => (row.preOrder == null ? row.sku : `${row.sku} (${formatPreOrder(row.preOrder)})`))
        .join(", ")}`
    );
  }
  if (set.preOrder12 != null) parts.push(`1~2 Pre-Order: ${formatPreOrder(set.preOrder12)}`);
  if (set.preOrder3 != null) parts.push(`3 Pre-Order: ${formatPreOrder(set.preOrder3)}`);
  if (set.oldSetSkus.length > 0) parts.push(`Old: ${set.oldSetSkus.join(", ")}`);
  return parts.join(" / ");
}

/** The set fields an import row may carry. Absent means "leave as it is". */
export interface FloorMatSetImportFields {
  frontSku?: string;
  rearSku?: string;
  thirdRowSkus?: string[];
  preOrder12?: boolean;
  /** One value per 3rd Row SKU, or a single value for a SKU with no 3rd Row links. */
  preOrder3Values?: Array<boolean | null>;
  oldSetSkus?: string[];
}

export function hasFloorMatSetImportFields(fields: FloorMatSetImportFields): boolean {
  return (
    fields.frontSku != null ||
    fields.rearSku != null ||
    fields.thirdRowSkus != null ||
    fields.preOrder12 != null ||
    fields.preOrder3Values != null ||
    fields.oldSetSkus != null
  );
}

/**
 * Applies an import row on top of the stored set. Only the columns present in
 * the file change, matching how the other SKU Master import columns behave.
 * Throws an Error with a user-facing message when the 3rd Row Pre-Order values
 * cannot be matched to 3rd Row SKUs.
 */
export function mergeFloorMatSetImport(
  masterSku: string,
  existing: FloorMatSet | null,
  fields: FloorMatSetImportFields
): FloorMatSet {
  const base = existing ?? emptyFloorMatSet();
  const next: FloorMatSet = {
    frontSku: fields.frontSku ?? base.frontSku,
    rearSku: fields.rearSku ?? base.rearSku,
    preOrder12: fields.preOrder12 ?? base.preOrder12,
    preOrder3: base.preOrder3,
    thirdRows: base.thirdRows.map((row) => ({ ...row })),
    oldSetSkus: fields.oldSetSkus ?? [...base.oldSetSkus],
  };
  const values = fields.preOrder3Values;

  if (fields.thirdRowSkus) {
    if (values && values.length > fields.thirdRowSkus.length) {
      throw new Error(
        `${masterSku}: ${values.length} 3rd Row Pre-Order values for ${fields.thirdRowSkus.length} 3rd Row SKU(s)`
      );
    }
    const previous = new Map(base.thirdRows.map((row) => [row.sku, row.preOrder]));
    next.thirdRows = fields.thirdRowSkus.map((sku, index) => ({
      sku,
      preOrder: values?.[index] ?? previous.get(sku) ?? null,
    }));
  } else if (values) {
    if (base.thirdRows.length > 0) {
      if (values.length !== base.thirdRows.length) {
        throw new Error(
          `${masterSku}: ${values.length} 3rd Row Pre-Order value(s) but ${base.thirdRows.length} 3rd Row SKU(s) are linked`
        );
      }
      next.thirdRows = base.thirdRows.map((row, index) => ({ sku: row.sku, preOrder: values[index] ?? row.preOrder }));
    } else {
      if (values.length !== 1) {
        throw new Error(`${masterSku}: several 3rd Row Pre-Order values but no 3rd Row SKUs`);
      }
      next.preOrder3 = values[0] ?? base.preOrder3;
    }
  }

  return next;
}
