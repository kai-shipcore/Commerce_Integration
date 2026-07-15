import * as XLSX from "xlsx";
import { toFinalCarCoverSku, type VelocityRow } from "@/components/velocity/velocity-table-columns";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function hasAnyQty(r: VelocityRow): boolean {
  return (
    !!r.isTotal ||
    r.qtys.some((v) => (v ?? 0) > 0) ||
    (r.customQtys ?? []).some((v) => (v ?? 0) > 0) ||
    (r.ttmQtys ?? []).some((v) => (v ?? 0) > 0)
  );
}

function buildSection(
  rows: VelocityRow[],
  mode: "sales" | "ttm" | "preorder",
  labels: string[],
  selectedItem: string
): (string | number | null)[][] {
  rows = rows.filter(hasAnyQty);
  const result: (string | number | null)[][] = [];

  if (mode === "preorder") {
    if (selectedItem === "Car Cover") {
      result.push(["Master SKU", ...labels, "Final Master SKU", ...labels]);
      for (const r of rows) {
        const qtys = labels.map((_, i) => r.qtys[i] ?? null);
        result.push([
          r.masterSku || null,
          ...qtys,
          r.masterSku ? toFinalCarCoverSku(r.masterSku) : null,
          ...qtys,
        ]);
      }
    } else if (selectedItem === "Floor Mat") {
      result.push(["Master SKU", ...labels]);
      for (const r of rows) {
        result.push([r.masterSku || null, ...labels.map((_, i) => r.qtys[i] ?? null)]);
      }
    } else {
      // Seat Cover
      result.push(["Master SKU", ...labels, "Custom SKU", ...labels, "TTM SKU", ...labels]);
      for (const r of rows) {
        result.push([
          r.masterSku || null,
          ...labels.map((_, i) => r.qtys[i] ?? null),
          r.customMasterSku ?? null,
          ...labels.map((_, i) => r.customQtys?.[i] ?? null),
          r.ttmMasterSku ?? null,
          ...labels.map((_, i) => r.ttmQtys?.[i] ?? null),
        ]);
      }
    }
  } else {
    if (selectedItem === "Car Cover") {
      result.push(["Master SKU", ...labels, "Final Master SKU", ...labels]);
      for (const r of rows) {
        const qtys = labels.map((_, i) => r.qtys[i] ?? null);
        result.push([
          r.masterSku || null,
          ...qtys,
          r.masterSku ? toFinalCarCoverSku(r.masterSku) : null,
          ...qtys,
        ]);
      }
    } else if (selectedItem === "Floor Mat") {
      result.push(["Master SKU", ...labels]);
      for (const r of rows) {
        result.push([r.masterSku || null, ...labels.map((_, i) => r.qtys[i] ?? null)]);
      }
    } else {
      // Seat Cover
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
  }

  return result;
}

export function exportCurrentVelocity(
  allRows: VelocityRow[],
  mode: "sales" | "ttm" | "preorder",
  labels: string[],
  label: string,
  selectedItem: string
): void {
  const ws = XLSX.utils.aoa_to_sheet(buildSection(allRows, mode, labels, selectedItem));
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
  label: string,
  selectedItem: string
): void {
  const GAP = [null];
  const sales    = buildSection(salesRows,    "sales",    labels, selectedItem);
  const ttm      = buildSection(ttmRows,      "ttm",      labels, selectedItem);
  const preorder = buildSection(preorderRows, "preorder", labels, selectedItem);

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
