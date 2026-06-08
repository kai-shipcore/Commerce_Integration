import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { forecastCategoryCodeForSku, type ForecastCategoryCode } from "@/lib/planning/forecast-calculations";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 1200;

type Bucket = "day" | "week" | "month";

type SalesHistoryRow = {
  bucket_label: string;
  west: string | number | null;
  east: string | number | null;
  total: string | number | null;
};

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sku = params.get("sku")?.trim().toUpperCase() ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  if (!sku) {
    return NextResponse.json({ success: false, error: "Missing sku" }, { status: 400 });
  }
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return NextResponse.json({ success: false, error: "Invalid date range" }, { status: 400 });
  }

  const rangeDays = daysBetween(from, to);
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { success: false, error: `Date range is too large. Maximum is ${MAX_RANGE_DAYS} days.` },
      { status: 400 },
    );
  }

  const category = params.get("category") === "SC" || params.get("category") === "CC" || params.get("category") === "FM"
    ? params.get("category") as ForecastCategoryCode
    : forecastCategoryCodeForSku(sku);
  const bucket = normalizeBucket(params.get("bucket"), rangeDays);
  const source = tableForCategory(category);
  const bucketSql = bucketExpression(bucket);
  const labelSql = bucketLabelExpression(bucket);

  try {
    const pool = getPrimaryPool();
    const result = await pool.query<SalesHistoryRow>(
      `
        WITH bucketed AS (
          SELECT
            ${bucketSql} AS bucket_date,
            SUM(CASE WHEN order_type = 'sales' AND channel != 'Amazon FBA' THEN ${source.qtyColumn} ELSE 0 END)::int AS west,
            SUM(CASE WHEN order_type = 'ttm' THEN ${source.qtyColumn} ELSE 0 END)::int AS east
          FROM ${source.table}
          WHERE ${source.skuColumn} = $1
            AND order_date >= $2::date
            AND order_date <= $3::date
            AND order_type IN ('sales', 'ttm')
          GROUP BY bucket_date
        )
        SELECT
          ${labelSql} AS bucket_label,
          west,
          east,
          (west + east)::int AS total
        FROM bucketed
        ORDER BY bucket_date
      `,
      [sku, from, to],
    );

    const points = result.rows.map((row) => ({
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

    return NextResponse.json({
      success: true,
      data: { sku, category, bucket, from, to, points, totals },
    });
  } catch (error) {
    console.error("[sku-forecasts/sales-history] GET error:", errorMessage(error));
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
