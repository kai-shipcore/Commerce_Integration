/**
 * Code Guide:
 * Lightweight home dashboard stats endpoint.
 * Returns planning KPI counts per category and active container list for the home page overview.
 * Uses only aggregate queries — does NOT load full SKU rows.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { CacheManager } from "@/lib/redis";

const CACHE_KEY = "home:planning-stats:v7";
const CACHE_TTL = 10 * 60; // 10 minutes

function getErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const cached = await CacheManager.get<unknown>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true });
  }

  try {
    const pool = getPrimaryPool();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    type CatStatsRow = { cat: string; critical: string; warning: string; backorder: string };
    type SyncRow = { last_sync: string | null };
    type ContainerRow = { name: string; eta: string | null; total_qty: string; status: string };
    type SalesRow = { qty: string; revenue: string };
    type PinnedStatsRow = { cat: string; critical: string; warning: string; backorder: string };

    const [catStatsResult, pinnedStatsResult, syncResult, containersResult, sales30Result, salesPrev30Result] =
      await Promise.all([
        // Per-category SOD counts, joined with inbound quantities
        // Mirrors urgStatus() in columns.ts:
        //   crit = back < 0  OR  total_stock / total_avg_curr <= 30
        //   warn = back >= 0 AND sod_days > 30 AND <= 60
        pool.query<CatStatsRow>(`
          WITH stats_source AS (
            SELECT s.* FROM shipcore.fc_stats_custom s
            WHERE EXISTS (
              SELECT 1 FROM shipcore.fc_products p
              WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM')
            )
            UNION ALL
            SELECT s.* FROM shipcore.fc_stats s
            WHERE NOT EXISTS (
              SELECT 1 FROM shipcore.fc_products p
              WHERE p.master_sku = s.master_sku AND p.category_code IN ('CC', 'FM')
            )
          )
          SELECT
            CASE
              WHEN UPPER(p.category_code) = 'CC' THEN 'cc'
              WHEN UPPER(p.category_code) = 'SC' THEN 'sc'
              WHEN UPPER(p.category_code) = 'FM' THEN 'fm'
              WHEN UPPER(s.master_sku) LIKE 'CC-%' THEN 'cc'
              WHEN UPPER(s.master_sku) LIKE 'CA-FM-%'
                OR 'FM' = ANY(string_to_array(UPPER(s.master_sku), '-')) THEN 'fm'
              WHEN UPPER(s.master_sku) LIKE 'CA-SC-%'
                OR UPPER(s.master_sku) LIKE 'CL-SC-%' THEN 'sc'
              ELSE 'ac'
            END AS cat,
            COUNT(*) FILTER (
              WHERE s.back < 0
                 OR (s.total_avg_curr > 0 AND FLOOR(s.total_stock::float / s.total_avg_curr) <= 30)
            )::text AS critical,
            COUNT(*) FILTER (
              WHERE s.back >= 0
                AND s.total_avg_curr > 0
                AND FLOOR(s.total_stock::float / s.total_avg_curr) > 30
                AND FLOOR(s.total_stock::float / s.total_avg_curr) <= 60
            )::text AS warning,
            COALESCE(SUM(CASE WHEN s.back < 0 THEN ABS(s.back) ELSE 0 END), 0)::text AS backorder
          FROM stats_source s
          LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
          GROUP BY cat
        `),

        pool.query<PinnedStatsRow>(`
          WITH pinned_rows AS (
            SELECT
              CASE
                WHEN UPPER(pr.category_code) = 'CC' THEN 'cc'
                WHEN UPPER(pr.category_code) = 'SC' THEN 'sc'
                WHEN UPPER(pr.category_code) = 'FM' THEN 'fm'
                WHEN UPPER(p.master_sku) LIKE 'CC-%' THEN 'cc'
                WHEN UPPER(p.master_sku) LIKE 'CA-FM-%'
                  OR 'FM' = ANY(string_to_array(UPPER(p.master_sku), '-')) THEN 'fm'
                WHEN UPPER(p.master_sku) LIKE 'CA-SC-%'
                  OR UPPER(p.master_sku) LIKE 'CL-SC-%' THEN 'sc'
                ELSE 'ac'
              END AS cat,
              p.back::float8 AS back,
              p.total_stock::float8 AS total_stock,
              (
                CASE
                  WHEN p.avg_daily_prev = 0 THEN west_real
                  WHEN ABS((west_real - p.avg_daily_prev) / p.avg_daily_prev) < 0.5 THEN p.avg_daily_prev * 0.1 + west_real * 0.9
                  ELSE p.avg_daily_prev * 0.2 + west_real * 0.8
                END
                +
                CASE
                  WHEN p.east_avg_prev = 0 THEN east_real
                  WHEN ABS((east_real - p.east_avg_prev) / p.east_avg_prev) < 0.5 THEN p.east_avg_prev * 0.1 + east_real * 0.9
                  ELSE p.east_avg_prev * 0.2 + east_real * 0.8
                END
                + fba_real
              )::float8 AS total_avg_curr
            FROM shipcore.fc_pinned_rows p
            LEFT JOIN shipcore.fc_products pr ON pr.master_sku = p.master_sku
            CROSS JOIN LATERAL (
              SELECT
                (p.west_90d / 90 * 0.10
                  + p.west_60d / 60 * 0.15
                  + p.west_30d / 30 * 0.30
                  + p.west_30d_pre / 30 * 0.10
                  + p.west_15d / 15 * 0.20
                  + p.west_7d / 7 * 0.15)::float8 AS west_real,
                GREATEST(0.01,
                  p.east_90d / 90 * 0.10
                  + p.east_60d / 60 * 0.15
                  + p.east_30d / 30 * 0.30
                  + p.east_30d_pre / 30 * 0.10
                  + p.east_15d / 15 * 0.20
                  + p.east_7d / 7 * 0.15
                )::float8 AS east_real,
                (p.fba_30d::float8 / 30)::float8 AS fba_real
            ) calc
          )
          SELECT
            cat,
            COUNT(*) FILTER (
              WHERE back < 0
                 OR (total_avg_curr > 0 AND FLOOR(total_stock / total_avg_curr) <= 30)
            )::text AS critical,
            COUNT(*) FILTER (
              WHERE back >= 0
                AND total_avg_curr > 0
                AND FLOOR(total_stock / total_avg_curr) > 30
                AND FLOOR(total_stock / total_avg_curr) <= 60
            )::text AS warning,
            COALESCE(SUM(CASE WHEN back < 0 THEN ABS(back) ELSE 0 END), 0)::text AS backorder
          FROM pinned_rows
          GROUP BY cat
        `).catch(() => ({ rows: [] as PinnedStatsRow[] })),

        pool.query<SyncRow>(`SELECT MAX(calculated_at)::text AS last_sync FROM shipcore.fc_stats`),

        pool.query<ContainerRow>(`
          SELECT
            c.container_number  AS name,
            c.eta_date::text    AS eta,
            c.status,
            COALESCE(SUM(ci.qty), 0)::text AS total_qty
          FROM shipcore.fc_containers c
          LEFT JOIN shipcore.fc_container_items ci ON ci.container_id = c.id
          WHERE c.status IN ('shipped', 'packing_received')
          GROUP BY c.id, c.container_number, c.eta_date, c.status
          ORDER BY c.eta_date ASC NULLS LAST
          LIMIT 10
        `),

        pool.query<SalesRow>(`
          SELECT
            COALESCE(SUM(i.quantity), 0)::text   AS qty,
            COALESCE(SUM(i.line_total), 0)::text AS revenue
          FROM shipcore.sc_sales_order_items i
          JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
          WHERE o.order_date >= $1 AND i.is_counted_in_demand = true
        `, [thirtyDaysAgo]),

        pool.query<SalesRow>(`
          SELECT COALESCE(SUM(i.quantity), 0)::text AS qty
          FROM shipcore.sc_sales_order_items i
          JOIN shipcore.sc_sales_orders o ON o.id = i.order_id
          WHERE o.order_date >= $1 AND o.order_date < $2
            AND i.is_counted_in_demand = true
        `, [sixtyDaysAgo, thirtyDaysAgo]),
      ]);

    const emptyCat = { critical: 0, warning: 0, backorder: 0 };
    const byCategory: Record<string, { critical: number; warning: number; backorder: number }> = {
      fm: { ...emptyCat },
      cc: { ...emptyCat },
      sc: { ...emptyCat },
    };
    for (const row of catStatsResult.rows) {
      const key = row.cat as "fm" | "cc" | "sc";
      if (key in byCategory) {
        byCategory[key] = {
          critical: parseInt(row.critical, 10),
          warning:  parseInt(row.warning,  10),
          backorder: parseInt(row.backorder, 10),
        };
      }
    }
    for (const row of pinnedStatsResult.rows) {
      const key = row.cat as "fm" | "cc" | "sc";
      if (key in byCategory) {
        byCategory[key].critical += parseInt(row.critical, 10);
        byCategory[key].warning += parseInt(row.warning, 10);
        byCategory[key].backorder += parseInt(row.backorder, 10);
      }
    }

    const containers = containersResult.rows.map((r) => ({
      name: r.name,
      eta: r.eta ?? null,
      qty: parseInt(r.total_qty ?? "0", 10),
      status: r.status,
    }));
    const totalInboundQty = containers.reduce((sum, c) => sum + c.qty, 0);

    const units30     = parseInt(sales30Result.rows[0]?.qty      ?? "0", 10);
    const revenue30   = parseFloat(sales30Result.rows[0]?.revenue ?? "0");
    const unitsPrev30 = parseInt(salesPrev30Result.rows[0]?.qty  ?? "0", 10);
    const growthPct   =
      unitsPrev30 > 0
        ? Math.round(((units30 - unitsPrev30) / unitsPrev30) * 1000) / 10
        : 0;

    const data = {
      byCategory,
      inboundContainers: containers,
      totalInboundQty,
      sales30d: { units: units30, revenue: revenue30, growthPct },
      lastSync: syncResult.rows[0]?.last_sync ?? null,
    };

    await CacheManager.set(CACHE_KEY, data, CACHE_TTL);

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
