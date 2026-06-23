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
};

export const productLabels: Record<ProductKey, string> = {
  fm: "Floor Mat",
  cc: "Car Cover",
  sc: "Seat Cover",
};

export const DEFAULT_TARGET_INVENTORY_DAYS = 90;

export function recommendedContainerQty(row: DemandRow, multiple?: number, targetInventoryDays = DEFAULT_TARGET_INVENTORY_DAYS): number {
  const targetQty = Math.ceil(row.total_avg_curr * targetInventoryDays);
  const projectedQty = row.total_stock + (row.total_inbound_qty ?? 0) + Math.min(row.back, 0);
  const rawQty = Math.max(targetQty - projectedQty, 0);
  const fallbackMultiple = productKeyForRow(row) === "cc" ? 3 : 5;
  const orderMultiple = Math.max(multiple || row.order_multiple || row.moq || fallbackMultiple, 1);
  return rawQty === 0 ? 0 : Math.ceil(rawQty / orderMultiple) * orderMultiple;
}

export function salesVelocityTrend(row: DemandRow): { recentDaily: number; thirtyDayDaily: number; changePercent: number | null } {
  const recentDaily = (row.west_7d + row.east_7d) / 7;
  const thirtyDayDaily = (row.west_30d + row.east_30d) / 30;
  return {
    recentDaily,
    thirtyDayDaily,
    changePercent: thirtyDayDaily > 0 ? ((recentDaily - thirtyDayDaily) / thirtyDayDaily) * 100 : null,
  };
}

export function productKeyForRow(row: DemandRow): ProductKey {
  if (row.category_code === "CC") return "cc";
  if (row.category_code === "FM") return "fm";
  const sku = row.sku.toUpperCase();
  if (sku.startsWith("CC-")) return "cc";
  if (sku.startsWith("CA-FM-") || sku.split("-").includes("FM")) return "fm";
  return "sc";
}

export function forecastProductKeyForRow(row: DemandRow): ProductKey | null {
  if (row.category_code === "SC") return "sc";
  if (row.category_code === "CC") return "cc";
  if (row.category_code === "FM") return "fm";
  if (row.category_code) return null;

  const sku = row.sku.toUpperCase();
  if (sku.startsWith("CC-")) return "cc";
  if (sku.startsWith("CA-FM-") || sku.split("-").includes("FM")) return "fm";
  if (sku.startsWith("CA-SC-") || sku.startsWith("CL-SC-")) return "sc";
  return null;
}

export function hasRecentSales(row: DemandRow): boolean {
  return Boolean(
    row.west_90d || row.west_60d || row.west_30d || row.west_15d || row.west_7d ||
    row.east_90d || row.east_60d || row.east_30d || row.east_15d || row.east_7d
  );
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
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = year && month && day
    ? new Date(year, month - 1, day)
    : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function stockOnlyDays(row: DemandRow): number | null {
  return row.total_avg_curr > 0 ? row.total_stock / row.total_avg_curr : null;
}

export function getUrgency(row: DemandRow): "critical" | "watch" | "healthy" {
  if ((row.back ?? 0) < 0) return "critical";
  const days = stockOnlyDays(row);
  if (days !== null && days <= 30) return "critical";
  if (days !== null && days <= 60) return "watch";
  return "healthy";
}
