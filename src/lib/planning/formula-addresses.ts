/** Translate displayed sheet addresses at the editing boundary. Stored references
 * keep SKU/field identities so sorting and column moves cannot change their target. */
export function resolveFormulaAddresses(text: string, resolve: (address: string) => string | null): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|\[[^\]]+\]|\b[A-Z]+[1-9]\d*\b/gi, (token, offset: number) => {
    if (token.startsWith('"') || token.startsWith('[') || /^\s*\(/.test(text.slice(offset + token.length))) return token;
    return resolve(token.toUpperCase()) ?? token;
  });
}

export function displayFormulaAddresses(text: string, sku: string, address: (sku: string, field: string) => string | null): string {
  return text.replace(/SKU\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)|"(?:[^"\\]|\\.)*"|\[([^\]]+)\]/gi,
    (token, row: string | undefined, field: string | undefined, local: string | undefined) => {
      if (row && field) return address(JSON.parse(row), JSON.parse(field)) ?? token;
      return local ? address(sku, local) ?? token : token;
    });
}

export type FormulaCellReference = { sku: string; field: string };

/** Return direct cell references in expression order. Stored formulas use
 * stable SKU/field identities, so highlights remain correct after sorting or
 * moving columns. Duplicate references are collapsed like Google Sheets. */
export function collectFormulaCellReferences(text: string, sku: string): FormulaCellReference[] {
  const references: FormulaCellReference[] = [];
  const seen = new Set<string>();
  text.replace(
    /SKU\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)|"(?:[^"\\]|\\.)*"|\[([^\]]+)\]/gi,
    (token, row: string | undefined, field: string | undefined, local: string | undefined) => {
      let reference: FormulaCellReference | null = null;
      if (row && field) {
        try { reference = { sku: JSON.parse(row), field: JSON.parse(field) }; } catch { reference = null; }
      } else if (local) reference = { sku, field: local };
      if (!reference) return token;
      const key = `${reference.sku}::${reference.field}`;
      if (!seen.has(key)) {
        seen.add(key);
        references.push(reference);
      }
      return token;
    },
  );
  return references;
}

/** Shift cell references by the destination's displayed row offset. */
export function shiftFormulaRows(text: string, sourceSku: string, targetSku: string, rows: string[]): string {
  const source = rows.indexOf(sourceSku);
  const target = rows.indexOf(targetSku);
  if (source < 0 || target < 0) return text;
  return text.replace(/SKU\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)|"(?:[^"\\]|\\.)*"/gi,
    (token, row: string | undefined, field: string | undefined) => {
      if (!row || !field) return token;
      const index = rows.indexOf(JSON.parse(row));
      // A reference outside the visible rows has no displayed offset to shift.
      if (index < 0) return token;
      const shifted = rows[index + target - source];
      return `SKU(${JSON.stringify(shifted ?? "")}, ${field})`;
    });
}

