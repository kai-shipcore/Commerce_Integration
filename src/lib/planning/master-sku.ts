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
