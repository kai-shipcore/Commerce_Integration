import type { DemandRow } from "@/types/demand-planning";

export type ProductKey = "sc" | "cc" | "fm";

export type SkuMasterMeta = {
  masterSku: string;
  productName: string | null;
  productKey: ProductKey;
  category: string | null;
  categoryCode: string | null;
  moq: number;
  orderMultiple: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
  isCustomSku: boolean;
};

export const productLabels: Record<ProductKey, string> = {
  sc: "Seat Cover",
  cc: "Car Cover",
  fm: "Floor Mat",
};

export function productKeyForRow(row: DemandRow): ProductKey {
  if (row.category_code === "CC") return "cc";
  if (row.category_code === "FM") return "fm";
  const sku = row.sku.toUpperCase();
  if (sku.startsWith("CC-")) return "cc";
  if (sku.startsWith("CA-FM-") || sku.split("-").includes("FM")) return "fm";
  return "sc";
}

export function defaultMasterMeta(row: DemandRow): SkuMasterMeta {
  const productKey = productKeyForRow(row);
  const moq = productKey === "cc" ? 3 : 5;
  return {
    masterSku: row.sku,
    productName: null,
    productKey,
    category: productLabels[productKey],
    categoryCode: productKey.toUpperCase(),
    moq,
    orderMultiple: moq,
    cbmPerUnit: row.cbm_per_unit ?? row.cbm ?? 0,
    caseQty: productKey === "cc" ? 3 : 1,
    weightKg: 0,
    isCustomSku: row.sales_status === "Custom",
  };
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  const safe = Number(value ?? 0);
  return safe.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function daysUntil(dateValue: string | null | undefined): number | null {
  if (!dateValue) return null;
  const today = new Date();
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function getUrgency(row: DemandRow): "critical" | "watch" | "healthy" {
  if ((row.back ?? 0) < 0) return "critical";
  const days = daysUntil(row.sod);
  if (days !== null && days <= 30) return "critical";
  if (days !== null && days <= 60) return "watch";
  return "healthy";
}
