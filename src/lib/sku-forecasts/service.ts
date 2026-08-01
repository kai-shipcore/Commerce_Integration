/**
 * Business logic for the SKU Planning inbound tabs: input validation only —
 * the actual data shaping already happens in the repository, matching the
 * original routes' minimal-logic footprint. Data access lives in
 * src/lib/sku-forecasts/repository.ts.
 *
 * getSalesHistory additionally owns the sales-history chart's bucket/category
 * resolution (day/week/month granularity, SC vs CC/FM velocity source),
 * moved verbatim from the original route.
 */

import { ValidationError } from "@/lib/errors";
import { forecastCategoryCodeForSku, type ForecastCategoryCode } from "@/lib/planning/forecast-calculations";
import { SkuForecastsRepository, type InboundHistoryRow, type InboundRow } from "@/lib/sku-forecasts/repository";

function requireMasterSku(rawMasterSku: string | null): string {
  const masterSku = rawMasterSku?.trim().toUpperCase() ?? "";
  if (!masterSku) throw new ValidationError("masterSku is required");
  return masterSku;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 1200;

type Bucket = "day" | "week" | "month";

export interface SalesHistoryPoint {
  date: string;
  west: number;
  east: number;
  total: number;
}

export interface SalesHistoryResult {
  sku: string;
  category: ForecastCategoryCode;
  bucket: Bucket;
  from: string;
  to: string;
  points: SalesHistoryPoint[];
  totals: { west: number; east: number; total: number };
}

function isValidDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((toTime - fromTime) / 86400000) + 1;
}

function normalizeBucket(value: string | null, rangeDays: number): Bucket {
  if (value === "day" || value === "week" || value === "month") return value;
  if (rangeDays <= 120) return "day";
  if (rangeDays <= 370) return "week";
  return "month";
}

function bucketExpression(bucket: Bucket): string {
  if (bucket === "day") return "order_date::date";
  if (bucket === "week") return "date_trunc('week', order_date)::date";
  return "date_trunc('month', order_date)::date";
}

function bucketLabelExpression(bucket: Bucket): string {
  if (bucket === "month") return "to_char(bucket_date, 'YYYY-MM')";
  return "to_char(bucket_date, 'YYYY-MM-DD')";
}

function tableForCategory(category: ForecastCategoryCode) {
  return category === "SC"
    ? {
        table: "shipcore.fc_velocity_link_snapshot",
        skuColumn: "link_master_sku",
        qtyColumn: "link_qty",
      }
    : {
        table: "shipcore.fc_velocity_custom_snapshot",
        skuColumn: "custom_master_sku",
        qtyColumn: "custom_qty",
      };
}

export const SkuForecastsService = {
  async getInboundHistory(rawMasterSku: string | null): Promise<InboundHistoryRow[]> {
    return SkuForecastsRepository.getInboundHistory(requireMasterSku(rawMasterSku));
  },

  async getInbound(rawMasterSku: string | null, includeDrafts: boolean): Promise<InboundRow[]> {
    return SkuForecastsRepository.getInbound(requireMasterSku(rawMasterSku), includeDrafts);
  },

  getForecastBounds(): Promise<string | null> {
    return SkuForecastsRepository.getForecastMinDate();
  },

  async getSalesHistory(params: {
    sku: string | null;
    from: string | null;
    to: string | null;
    category: string | null;
    bucket: string | null;
  }): Promise<SalesHistoryResult> {
    const sku = params.sku?.trim().toUpperCase() ?? "";
    const from = params.from ?? "";
    const to = params.to ?? "";

    if (!sku) throw new ValidationError("Missing sku");
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      throw new ValidationError("Invalid date range");
    }

    const rangeDays = daysBetween(from, to);
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new ValidationError(`Date range is too large. Maximum is ${MAX_RANGE_DAYS} days.`);
    }

    const category = params.category === "SC" || params.category === "CC" || params.category === "FM"
      ? (params.category as ForecastCategoryCode)
      : forecastCategoryCodeForSku(sku);
    const bucket = normalizeBucket(params.bucket, rangeDays);
    const source = tableForCategory(category);

    const rows = await SkuForecastsRepository.getSalesHistory({
      table: source.table,
      skuColumn: source.skuColumn,
      qtyColumn: source.qtyColumn,
      bucketSql: bucketExpression(bucket),
      labelSql: bucketLabelExpression(bucket),
      sku,
      from,
      to,
    });

    const points: SalesHistoryPoint[] = rows.map((row) => ({
      date: row.bucket_label,
      west: Number(row.west ?? 0),
      east: Number(row.east ?? 0),
      total: Number(row.total ?? 0),
    }));

    const totals = points.reduce(
      (sum, point) => ({
        west: sum.west + point.west,
        east: sum.east + point.east,
        total: sum.total + point.total,
      }),
      { west: 0, east: 0, total: 0 },
    );

    return { sku, category, bucket, from, to, points, totals };
  },
};
