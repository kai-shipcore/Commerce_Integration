import * as XLSX from "xlsx";
import type { VelocityRow } from "@/components/velocity/velocity-table-columns";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSection(
  rows: VelocityRow[],
  mode: "sales" | "ttm" | "preorder",
  labels: string[]
): (string | number | null)[][] {
  const result: (string | number | null)[][] = [];

  if (mode === "preorder") {
    result.push(["Master SKU", "Total", "Custom SKU", "Total", "TTM SKU", "Total"]);
    for (const r of rows) {
      result.push([
        r.masterSku || null,
        r.qtys[0] ?? null,
        r.customMasterSku ?? null,
        r.customQtys?.[0] ?? null,
        r.ttmMasterSku ?? null,
        r.ttmCount ?? null,
      ]);
    }
  } else {
    result.push(["Master SKU", ...labels, "Custom SKU", ...labels]);
    for (const r of rows) {
      result.push([
        r.masterSku || null,
        ...labels.map((_, i) => r.qtys[i] ?? null),
        r.customMasterSku ?? null,
        ...labels.map((_, i) => r.customQtys?.[i] ?? null),
      ]);
    }
  }

  return result;
}

export function exportCurrentVelocity(
  allRows: VelocityRow[],
  mode: "sales" | "ttm" | "preorder",
  labels: string[],
  label: string
): void {
  const ws = XLSX.utils.aoa_to_sheet(buildSection(allRows, mode, labels));
  const wb = XLSX.utils.book_new();
  const sheetName = mode === "preorder" ? "Pre Order" : mode === "ttm" ? "TTM" : "Sales";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `velocity_${label}_${today()}.xlsx`);
}

export function exportAllVelocity(
  salesRows: VelocityRow[],
  ttmRows: VelocityRow[],
  preorderRows: VelocityRow[],
  labels: string[],
  label: string
): void {
  const GAP = [null]; // 섹션 구분용 빈 열
  const sales    = buildSection(salesRows,    "sales",    labels);
  const ttm      = buildSection(ttmRows,      "ttm",      labels);
  const preorder = buildSection(preorderRows, "preorder", labels);

  // 섹션 타이틀 행 (헤더 위)
  const salesCols    = sales[0]?.length    ?? 0;
  const ttmCols      = ttm[0]?.length      ?? 0;
  const preorderCols = preorder[0]?.length ?? 0;
  const titleRow: (string | null)[] = [
    "SALES",    ...Array(salesCols    - 1).fill(null), null,
    "TTM",      ...Array(ttmCols      - 1).fill(null), null,
    "PRE ORDER",...Array(preorderCols - 1).fill(null),
  ];

  const maxLen = Math.max(sales.length, ttm.length, preorder.length);
  const merged: (string | number | null)[][] = [titleRow];

  for (let i = 0; i < maxLen; i++) {
    const s = sales[i]    ?? Array(salesCols).fill(null);
    const t = ttm[i]      ?? Array(ttmCols).fill(null);
    const p = preorder[i] ?? Array(preorderCols).fill(null);
    merged.push([...s, ...GAP, ...t, ...GAP, ...p]);
  }

  const ws = XLSX.utils.aoa_to_sheet(merged);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Velocity");
  XLSX.writeFile(wb, `velocity_all_${label}_${today()}.xlsx`);
}
