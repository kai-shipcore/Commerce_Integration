/**
 * Code Guide:
 * Lightweight home dashboard stats endpoint.
 * Returns per-category KPIs, stock distribution, top critical SKUs,
 * delayed containers, and global stats for the Command Center.
 * Uses only aggregate queries — does NOT load full SKU rows.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";

const CACHE_KEY = "home:planning-stats:v25";
const CACHE_TTL = 10 * 60; // 10 minutes

function getErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Unknown error";
}

// Shared category-classification CASE expression used in both queries
const CAT_CASE = `
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
  END
`;

// Shared stats_source CTE (fc_stats_custom takes precedence for CC/FM SKUs)
const STATS_SOURCE_CTE = `
  stats_source AS (
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
`;

// Shared categorized CTE: adds cat, sod_days, has_inbound to each row
const CATEGORIZED_CTE = `
  categorized AS (
    SELECT
      s.master_sku,
      s.total_stock,
      s.total_avg_curr,
      s.back,
      ${CAT_CASE} AS cat,
      CASE
        WHEN s.back < 0 THEN -1
        WHEN s.total_avg_curr > 0 THEN FLOOR(s.total_stock::float / s.total_avg_curr)::int
        ELSE 9999
      END AS sod_days,
      EXISTS (
        SELECT 1 FROM shipcore.fc_container_items ci
        JOIN shipcore.fc_containers con ON con.id = ci.container_id
        WHERE ci.master_sku = s.master_sku
          AND con.status NOT IN ('complete')
          AND con.eta_date >= CURRENT_DATE
      ) AS has_inbound
    FROM stats_source s
    LEFT JOIN shipcore.fc_products p ON p.master_sku = s.master_sku
  )
`;

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
    const lookup = getLookupPool();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // ── Row types ──────────────────────────────────────────────────────────────
    type SyncRow       = { last_sync: string | null };
    type ContainerRow  = { name: string; eta: string | null; total_qty: string; status: string; cbm_capacity: string | null; used_cbm: string; sku_count: string };
    type SalesRow      = { qty: string; revenue: string };
    type PartSkuRow    = { sku: string };
    type PartBackRow   = { sku: string; back: number };
    type DelayedConRow = { name: string; eta: string | null; delay_days: string; status: string };

    type CatDetailRow  = {
      cat: string;
      critical_sku: string; expected_oos: string; overstock_sku: string; urgent_po: string;
      d0_30: string; d30_60: string; d60_180: string; d180plus: string; backorder: string;
    };
    type CatTopRow = {
      cat: string; sku: string; total_stock: string; total_avg_curr: string;
      sod_days: string; back: string; next_eta: string | null;
    };

    // ── All queries in parallel ────────────────────────────────────────────────
    const [
      catDetailResult,
      syncResult,
      containersResult,
      sales30Result,
      salesPrev30Result,
      catTopResult,
      delayedContainersResult,
    ] = await Promise.all([

      // Per-category KPIs + distribution (replaces both catStatsResult and globalStatsResult)
      pool.query<CatDetailRow>(`
        WITH ${STATS_SOURCE_CTE},
        ${CATEGORIZED_CTE}
        SELECT
          cat,
          COUNT(*) FILTER (WHERE sod_days <= 30)::text                          AS critical_sku,
          COUNT(*) FILTER (WHERE sod_days BETWEEN 31 AND 60)::text              AS expected_oos,
          COUNT(*) FILTER (WHERE sod_days > 180 AND sod_days < 9999)::text      AS overstock_sku,
          COUNT(*) FILTER (WHERE sod_days <= 30 AND NOT has_inbound)::text       AS urgent_po,
          COUNT(*) FILTER (WHERE sod_days <= 30)::text                          AS d0_30,
          COUNT(*) FILTER (WHERE sod_days BETWEEN 31 AND 60)::text              AS d30_60,
          COUNT(*) FILTER (WHERE sod_days BETWEEN 61 AND 180)::text             AS d60_180,
          COUNT(*) FILTER (WHERE sod_days > 180 AND sod_days < 9999)::text      AS d180plus,
          COALESCE(SUM(CASE WHEN back < 0 THEN ABS(back) ELSE 0 END), 0)::text AS backorder
        FROM categorized
        WHERE cat IN ('fm', 'cc', 'sc')
        GROUP BY cat
      `),

      pool.query<SyncRow>(`SELECT MAX(calculated_at)::text AS last_sync FROM shipcore.fc_stats`),

      pool.query<ContainerRow>(`
        SELECT
          c.container_number                                    AS name,
          c.eta_date::text                                      AS eta,
          c.status,
          COALESCE(c.cbm_capacity, 0)::text                    AS cbm_capacity,
          COALESCE(SUM(ci.qty), 0)::text                       AS total_qty,
          COALESCE(SUM(ci.cbm_unit * ci.qty), 0)::text         AS used_cbm,
          COUNT(DISTINCT ci.master_sku)::text                  AS sku_count
        FROM shipcore.fc_containers c
        LEFT JOIN shipcore.fc_container_items ci ON ci.container_id = c.id
        WHERE c.status NOT IN ('complete')
          AND (c.eta_date IS NULL OR c.eta_date >= CURRENT_DATE - INTERVAL '14 days')
        GROUP BY c.id, c.container_number, c.eta_date, c.status, c.cbm_capacity
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

      // Per-category top 10 critical SKUs — uses EFFECTIVE SOD (stock + confirmed inbound)
      // so SKUs with sufficient pending inbound are excluded from the critical list.
      pool.query<CatTopRow>(`
        WITH ${STATS_SOURCE_CTE},
        ${CATEGORIZED_CTE},
        with_effective_sod AS (
          SELECT
            c.*,
            CASE
              WHEN c.total_avg_curr > 0 THEN
                FLOOR((
                  c.total_stock::float
                  + COALESCE((
                      SELECT SUM(ci.qty)
                      FROM shipcore.fc_container_items ci
                      JOIN shipcore.fc_containers con ON con.id = ci.container_id
                      WHERE ci.master_sku = c.master_sku
                        AND con.status NOT IN ('complete')
                        AND con.eta_date IS NOT NULL
                        AND con.eta_date >= CURRENT_DATE
                    ), 0)
                ) / c.total_avg_curr)::int
              ELSE 9999
            END AS effective_sod_days
          FROM categorized c
        ),
        critical_only AS (
          SELECT w.*
          FROM with_effective_sod w
          JOIN stats_source ss ON ss.master_sku = w.master_sku
          WHERE w.cat IN ('fm', 'cc', 'sc')
            AND w.effective_sod_days <= 30
            AND w.total_avg_curr > 0
            AND (
              COALESCE(ss.west_90d, 0) > 0 OR COALESCE(ss.west_60d, 0) > 0 OR
              COALESCE(ss.west_30d, 0) > 0 OR COALESCE(ss.west_15d, 0) > 0 OR COALESCE(ss.west_7d, 0) > 0 OR
              COALESCE(ss.east_90d, 0) > 0 OR COALESCE(ss.east_60d, 0) > 0 OR
              COALESCE(ss.east_30d, 0) > 0 OR COALESCE(ss.east_15d, 0) > 0 OR COALESCE(ss.east_7d, 0) > 0
            )
        ),
        ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY cat ORDER BY total_avg_curr DESC, master_sku ASC) AS rn
          FROM critical_only
        )
        SELECT
          r.cat,
          r.master_sku                                AS sku,
          r.total_stock::text,
          ROUND(r.total_avg_curr::numeric, 1)::text  AS total_avg_curr,
          r.effective_sod_days::text                 AS sod_days,
          r.back::text,
          (
            SELECT MIN(c.eta_date)::text
            FROM shipcore.fc_container_items ci
            JOIN shipcore.fc_containers c ON c.id = ci.container_id
            WHERE ci.master_sku = r.master_sku
              AND c.status NOT IN ('complete')
              AND c.eta_date >= CURRENT_DATE
          ) AS next_eta
        FROM ranked r
        WHERE r.rn <= 10
        ORDER BY r.cat, r.total_avg_curr DESC
      `),

      // Containers whose ETA has passed and are not yet complete
      pool.query<DelayedConRow>(`
        SELECT
          c.container_number              AS name,
          c.eta_date::text                AS eta,
          (CURRENT_DATE - c.eta_date)::text AS delay_days,
          c.status
        FROM shipcore.fc_containers c
        WHERE c.status NOT IN ('complete')
          AND c.eta_date IS NOT NULL
          AND c.eta_date < CURRENT_DATE
        ORDER BY c.eta_date ASC
        LIMIT 10
      `),
    ]);

    // ── Parse catDetailResult into per-category maps ───────────────────────────
    type CatKey = "fm" | "cc" | "sc";
    const cats: CatKey[] = ["fm", "cc", "sc"];
    const emptyDetail = {
      critical_sku: "0", expected_oos: "0", overstock_sku: "0", urgent_po: "0",
      d0_30: "0", d30_60: "0", d60_180: "0", d180plus: "0", backorder: "0",
    };
    const catDetailMap: Record<CatKey, CatDetailRow & { cat: CatKey }> = {
      fm: { cat: "fm", ...emptyDetail },
      cc: { cat: "cc", ...emptyDetail },
      sc: { cat: "sc", ...emptyDetail },
    };
    for (const row of catDetailResult.rows) {
      const k = row.cat as CatKey;
      if (k in catDetailMap) catDetailMap[k] = { ...row, cat: k };
    }

    // ── Parse catTopResult into per-category arrays ────────────────────────────
    const catTopMap: Record<CatKey, typeof catTopResult.rows> = { fm: [], cc: [], sc: [] };
    for (const row of catTopResult.rows) {
      const k = row.cat as CatKey;
      if (k in catTopMap) catTopMap[k].push(row);
    }

    // ── Replacement parts backorder adjustment (SC category) ──────────────────
    const partSkusResult = await pool.query<PartSkuRow>(`
      SELECT DISTINCT "partSkuValue" AS sku
      FROM shipcore.fc_replacement_parts
      WHERE "partSkuValue" IS NOT NULL
        AND "shippingStatus" = 'Not Ready'
        AND "deleteYN" = 'N'
        AND "orderRequest" ~ '^[0-9]+$'
        AND "orderRequest"::int > 0
    `);

    let scCriticalAdjust = 0;
    let scBackorderAdjust = 0;

    if (lookup && partSkusResult.rows.length > 0) {
      const skuList = partSkusResult.rows.map((r) => r.sku);
      const partBackResult = await lookup.query<PartBackRow>(
        `SELECT
           BTRIM(master_sku) AS sku,
           (-SUM(COALESCE(backorder, 0)))::int AS back
         FROM ecommerce_data.coverland_inventory
         WHERE BTRIM(master_sku) = ANY($1)
         GROUP BY BTRIM(master_sku)`,
        [skuList],
      );
      const backorderedParts = partBackResult.rows.filter((r) => Number(r.back) < 0);
      scCriticalAdjust  = Math.min(3, backorderedParts.length);
      scBackorderAdjust = backorderedParts.reduce((sum, r) => sum + Math.abs(Number(r.back)), 0);
    }

    // ── Per-category Redis delta snapshots ────────────────────────────────────
    const todayStr     = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

    interface CatKpiSnap {
      criticalSku: number; expectedOos: number; overstockSku: number; urgentPo: number;
    }

    const prevSnaps = Object.fromEntries(
      await Promise.all(
        cats.map(async (cat) => [
          cat,
          await CacheManager.get<CatKpiSnap>(`home:kpi-snap:${cat}:${yesterdayStr}`),
        ])
      )
    ) as Record<CatKey, CatKpiSnap | null>;

    // ── Build byCategoryFull ──────────────────────────────────────────────────
    const byCategoryFull = Object.fromEntries(
      cats.map((cat) => {
        const d = catDetailMap[cat];
        const prev = prevSnaps[cat];

        let criticalSku  = parseInt(d.critical_sku,  10);
        let urgentPo     = parseInt(d.urgent_po,      10);
        let backorder    = parseInt(d.backorder,      10);

        if (cat === "sc") {
          criticalSku += scCriticalAdjust;
          urgentPo    += scCriticalAdjust;
          backorder   += scBackorderAdjust;
        }

        const expectedOos  = parseInt(d.expected_oos,  10);
        const overstockSku = parseInt(d.overstock_sku, 10);

        const delta = (curr: number, field: keyof CatKpiSnap) =>
          prev ? curr - prev[field] : 0;

        const kpis = {
          criticalSku,
          expectedOos,
          overstockSku,
          urgentPo,
          deltas: {
            criticalSku:  delta(criticalSku,  "criticalSku"),
            expectedOos:  delta(expectedOos,  "expectedOos"),
            overstockSku: delta(overstockSku, "overstockSku"),
            urgentPo:     delta(urgentPo,     "urgentPo"),
          },
        };

        const stockDistribution = {
          d0_30:    parseInt(d.d0_30,    10) + (cat === "sc" ? scCriticalAdjust : 0),
          d30_60:   parseInt(d.d30_60,   10),
          d60_180:  parseInt(d.d60_180,  10),
          d180plus: parseInt(d.d180plus, 10),
        };

        const topCritical = catTopMap[cat].map((row) => ({
          sku:        row.sku,
          totalStock: parseInt(row.total_stock,    10),
          avgDaily:   parseFloat(row.total_avg_curr),
          sodDays:    parseInt(row.sod_days,       10),
          back:       parseInt(row.back,           10),
          nextEta:    row.next_eta ?? null,
        }));

        return [cat, { kpis, stockDistribution, topCritical, backorder }];
      })
    ) as Record<CatKey, { kpis: object; stockDistribution: object; topCritical: object[]; backorder: number }>;

    // Persist today's per-cat snapshots for tomorrow's delta (48h TTL)
    await Promise.all(
      cats.map((cat) => {
        const f = byCategoryFull[cat] as { kpis: { criticalSku: number; expectedOos: number; overstockSku: number; urgentPo: number } };
        return CacheManager.set(
          `home:kpi-snap:${cat}:${todayStr}`,
          {
            criticalSku:  f.kpis.criticalSku,
            expectedOos:  f.kpis.expectedOos,
            overstockSku: f.kpis.overstockSku,
            urgentPo:     f.kpis.urgentPo,
          } satisfies CatKpiSnap,
          48 * 60 * 60
        );
      })
    );

    // ── Backward-compat byCategory (old CatStats shape) ──────────────────────
    const byCategory = Object.fromEntries(
      cats.map((cat) => {
        const d  = catDetailMap[cat];
        const bf = byCategoryFull[cat] as { kpis: { criticalSku: number }; backorder: number };
        return [cat, {
          critical:  bf.kpis.criticalSku,
          warning:   parseInt(d.d30_60, 10),
          backorder: bf.backorder,
          total:     parseInt(d.d0_30, 10) + parseInt(d.d30_60, 10) + parseInt(d.d60_180, 10) + parseInt(d.d180plus, 10),
        }];
      })
    );

    // ── Global KPIs (sum of all 3 categories) ─────────────────────────────────
    const globalKpis = cats.reduce(
      (acc, cat) => {
        const k = (byCategoryFull[cat] as { kpis: { criticalSku: number; expectedOos: number; overstockSku: number; urgentPo: number } }).kpis;
        acc.criticalSku  += k.criticalSku;
        acc.expectedOos  += k.expectedOos;
        acc.overstockSku += k.overstockSku;
        acc.urgentPo     += k.urgentPo;
        return acc;
      },
      { criticalSku: 0, expectedOos: 0, overstockSku: 0, urgentPo: 0 }
    );

    const globalDistribution = cats.reduce(
      (acc, cat) => {
        const sd = (byCategoryFull[cat] as { stockDistribution: { d0_30: number; d30_60: number; d60_180: number; d180plus: number } }).stockDistribution;
        acc.d0_30    += sd.d0_30;
        acc.d30_60   += sd.d30_60;
        acc.d60_180  += sd.d60_180;
        acc.d180plus += sd.d180plus;
        return acc;
      },
      { d0_30: 0, d30_60: 0, d60_180: 0, d180plus: 0 }
    );

    // ── inboundContainers ─────────────────────────────────────────────────────
    const containers = containersResult.rows.map((r) => ({
      name:        r.name,
      eta:         r.eta ?? null,
      qty:         parseInt(r.total_qty     ?? "0", 10),
      status:      r.status,
      cbmCapacity: parseFloat(r.cbm_capacity ?? "0"),
      usedCbm:     parseFloat(r.used_cbm    ?? "0"),
      skuCount:    parseInt(r.sku_count     ?? "0", 10),
    }));
    const totalInboundQty = containers.reduce((sum, c) => sum + c.qty, 0);

    // ── delayedContainerList ──────────────────────────────────────────────────
    const delayedContainerList = delayedContainersResult.rows.map((r) => ({
      name:      r.name,
      eta:       r.eta ?? null,
      delayDays: parseInt(r.delay_days ?? "0", 10),
      status:    r.status,
    }));
    const delayedContainersCount = delayedContainerList.length;

    // ── Sales 30d ─────────────────────────────────────────────────────────────
    const units30     = parseInt(sales30Result.rows[0]?.qty      ?? "0", 10);
    const revenue30   = parseFloat(sales30Result.rows[0]?.revenue ?? "0");
    const unitsPrev30 = parseInt(salesPrev30Result.rows[0]?.qty  ?? "0", 10);
    const growthPct   = unitsPrev30 > 0
      ? Math.round(((units30 - unitsPrev30) / unitsPrev30) * 1000) / 10
      : 0;

    const data = {
      // Per-category full stats (new — primary data source for client)
      byCategoryFull,

      // Global counts (derived from per-cat sums)
      kpis: {
        ...globalKpis,
        delayedContainers: delayedContainersCount,
        deltas: { criticalSku: 0, expectedOos: 0, overstockSku: 0, delayedContainers: 0, urgentPo: 0 },
      },
      stockDistribution: globalDistribution,
      topCritical: catTopResult.rows
        .map((row) => ({
          sku:        row.sku,
          totalStock: parseInt(row.total_stock, 10),
          avgDaily:   parseFloat(row.total_avg_curr),
          sodDays:    parseInt(row.sod_days, 10),
          back:       parseInt(row.back, 10),
          nextEta:    row.next_eta ?? null,
        }))
        .sort((a, b) => a.sodDays - b.sodDays)
        .slice(0, 5),

      // Global delayed containers (not per-category)
      delayedContainerList,

      // Backward compat
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
