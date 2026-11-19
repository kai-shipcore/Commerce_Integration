/**
 * Code Guide:
 * Renamed master SKUs: sales under a code a product used to have are counted
 * under the code it has now.
 *
 * The planning team renames a master SKU in ShipHero. Workbench records it in
 * master_product_sku_history: one row per code a product has had, with the
 * period it was valid for. A product keeps its master_product_id across
 * renames, so every code of one product folds onto its current code, however
 * many times it was renamed.
 *
 * Applied where the Velocity sync writes the sales snapshots. Without it a
 * renamed SKU starts at zero sales on the day of the rename, and its average
 * and inventory life are wrong for the next 90 days.
 *
 * Pure and client-safe.
 */

export interface SkuHistoryRow {
  masterProductId: string;
  /** A code this product has or had. */
  sku: string;
  validFrom: Date | string | null;
  /** Null while the code is still the product's code. */
  validTo: Date | string | null;
  /** master_product.sku, when the product row could be read. */
  currentSku: string | null;
}

const keyOf = (sku: string) => sku.trim().toUpperCase();
const timeOf = (value: Date | string | null) => (value === null ? 0 : new Date(value).getTime() || 0);

/** The code a product has now: its master_product row, else its open history row, else its latest one. */
function currentSkuOf(rows: SkuHistoryRow[]): string | null {
  const fromProduct = rows.find((row) => row.currentSku?.trim())?.currentSku;
  if (fromProduct) return fromProduct.trim();
  const latestFirst = [...rows].sort((a, b) => timeOf(b.validFrom) - timeOf(a.validFrom));
  const open = latestFirst.find((row) => row.validTo === null);
  return (open ?? latestFirst[0])?.sku.trim() || null;
}

/**
 * Old code → current code, keyed by the old code in upper case.
 *
 * Two kinds of old code are left out, because folding them would move sales
 * onto the wrong product:
 *  - a code that is some product's current code (it was handed to another
 *    product after the rename);
 *  - a code two products have both had, with different current codes.
 */
export function buildSkuAliasMap(history: readonly SkuHistoryRow[]): Map<string, string> {
  const byProduct = new Map<string, SkuHistoryRow[]>();
  for (const row of history) {
    if (!row.sku?.trim()) continue;
    const rows = byProduct.get(row.masterProductId);
    if (rows) rows.push(row);
    else byProduct.set(row.masterProductId, [row]);
  }

  const currentByProduct = new Map<string, string>();
  const currentKeys = new Set<string>();
  for (const [productId, rows] of byProduct) {
    const current = currentSkuOf(rows);
    if (!current) continue;
    currentByProduct.set(productId, current);
    currentKeys.add(keyOf(current));
  }

  const aliases = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [productId, rows] of byProduct) {
    const current = currentByProduct.get(productId);
    if (!current) continue;
    for (const row of rows) {
      const oldKey = keyOf(row.sku);
      if (currentKeys.has(oldKey) || ambiguous.has(oldKey)) continue;
      const existing = aliases.get(oldKey);
      if (existing !== undefined && keyOf(existing) !== keyOf(current)) {
        aliases.delete(oldKey);
        ambiguous.add(oldKey);
        continue;
      }
      aliases.set(oldKey, current);
    }
  }
  return aliases;
}

/**
 * Rewrites the SKU of every row whose code was renamed, and adds rows that
 * then share an identity into one. `identityKeys` are the columns of the
 * table's conflict key other than the SKU: two rows equal on all of them and
 * on the SKU would otherwise overwrite each other on upsert, and the sales of
 * one would be lost.
 *
 * Returns the same array when nothing was renamed.
 */
export function foldRenamedSkuRows<T extends object>(
  rows: T[],
  aliases: ReadonlyMap<string, string>,
  skuKey: keyof T,
  qtyKey: keyof T,
  identityKeys: readonly (keyof T)[],
): T[] {
  if (aliases.size === 0) return rows;
  const renamed = (row: T) => aliases.get(keyOf(String(row[skuKey] ?? "")));
  if (!rows.some((row) => renamed(row) !== undefined)) return rows;

  const identity = (row: T, sku: string) =>
    JSON.stringify([sku, ...identityKeys.map((key) => {
      const value = row[key];
      return value instanceof Date ? value.getTime() : value;
    })]);

  // Rows already on the current code go first, so the columns outside the
  // identity (is_custom) keep the current code's value where both exist.
  const merged = new Map<string, T>();
  for (const row of rows) {
    if (renamed(row) === undefined) merged.set(identity(row, String(row[skuKey])), { ...row });
  }
  for (const row of rows) {
    const current = renamed(row);
    if (current === undefined) continue;
    const key = identity(row, current);
    const target = merged.get(key);
    if (target) {
      (target[qtyKey] as number) = Number(target[qtyKey]) + Number(row[qtyKey]);
    } else {
      merged.set(key, { ...row, [skuKey]: current });
    }
  }
  return [...merged.values()];
}
