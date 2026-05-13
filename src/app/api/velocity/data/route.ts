/**
 * Code Guide:
 * GET /api/velocity/data — Queries velocity_link_snapshot and velocity_custom_snapshot
 * for the given filters and returns aggregated rows for display on the Velocity page.
 *
 * Query params:
 *   items    — comma-separated item categories (e.g. "Car Cover,Seat Cover")
 *   channels — comma-separated channels (e.g. "Coverland,Amazon")
 *   mode     — "sales" | "ttm" | "preorder"
 *   ranges   — comma-separated "from:to" date pairs (e.g. "2025-01-01:2025-03-31,2025-04-01:2025-04-30")
 *              ignored for preorder mode
 */

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  return DATE_RE.test(s) && !isNaN(Date.parse(s));
}

function parseRanges(csv: string): { from: string; to: string }[] {
  return csv
    .split(",")
    .map((s) => {
      const [from, to] = s.split(":");
      return { from: from?.trim() ?? "", to: to?.trim() ?? "" };
    })
    .filter(({ from, to }) => isValidDate(from) && isValidDate(to) && from <= to);
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const items = p.get("items")?.split(",").filter(Boolean) ?? [];
  const channels = p.get("channels")?.split(",").filter(Boolean) ?? [];
  const mode = p.get("mode") ?? "sales";
  const ranges = parseRanges(p.get("ranges") ?? "");

  if (!items.length || !channels.length) {
    return NextResponse.json({ success: true, link: [], custom: [] });
  }

  try {
    const pool = getPrimaryPool();

    const needsCustom = items.includes("Seat Cover");

    // ── Pre Order mode ────────────────────────────────────────────────────────
    if (mode === "preorder") {
      const linkQuery = pool.query<{ master_sku: string; qty: number }>(
        `SELECT link_master_sku AS master_sku, SUM(link_qty)::int AS qty
         FROM shipcore.velocity_link_snapshot
         WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = 'preorder'
         GROUP BY link_master_sku ORDER BY qty DESC`,
        [items, channels]
      );
      const ttmQuery = pool.query<{ master_sku: string; qty: number }>(
        `SELECT link_master_sku AS master_sku, SUM(link_qty)::int AS qty
         FROM shipcore.velocity_link_snapshot
         WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = 'ttm_preorder'
         GROUP BY link_master_sku ORDER BY qty DESC`,
        [items, channels]
      );
      const customQuery = needsCustom
        ? pool.query<{ master_sku: string; qty: number }>(
            `SELECT custom_master_sku AS master_sku, SUM(custom_qty)::int AS qty
             FROM shipcore.velocity_custom_snapshot
             WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = 'preorder'
             GROUP BY custom_master_sku ORDER BY qty DESC`,
            [items, channels]
          )
        : Promise.resolve({ rows: [] as { master_sku: string; qty: number }[] });

      const [linkRes, customRes, ttmRes] = await Promise.all([linkQuery, customQuery, ttmQuery]);

      return NextResponse.json({
        success: true,
        link: linkRes.rows.map((r) => ({ masterSku: r.master_sku, qtys: [r.qty] })),
        custom: customRes.rows.map((r) => ({ masterSku: r.master_sku, qtys: [r.qty] })),
        ttm: ttmRes.rows.map((r) => ({ masterSku: r.master_sku, count: r.qty })),
      });
    }

    // ── Sales / TTM mode ──────────────────────────────────────────────────────
    if (!ranges.length) {
      return NextResponse.json({ success: true, link: [], custom: [] });
    }

    const orderType = mode === "ttm" ? "ttm" : "sales";

    // dates are validated YYYY-MM-DD strings — safe to inline
    const linkCols = ranges
      .map(
        ({ from, to }, i) =>
          `SUM(CASE WHEN order_date >= '${from}' AND order_date <= '${to}' THEN link_qty ELSE 0 END)::int AS qty_${i}`
      )
      .join(", ");

    const linkQuery = pool.query(
      `SELECT link_master_sku AS master_sku, ${linkCols}
       FROM shipcore.velocity_link_snapshot
       WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = $3
       GROUP BY link_master_sku
       ORDER BY qty_0 DESC`,
      [items, channels, orderType]
    );

    const customQuery = needsCustom
      ? pool.query(
          `SELECT custom_master_sku AS master_sku, ${ranges
            .map(
              ({ from, to }, i) =>
                `SUM(CASE WHEN order_date >= '${from}' AND order_date <= '${to}' THEN custom_qty ELSE 0 END)::int AS qty_${i}`
            )
            .join(", ")}
           FROM shipcore.velocity_custom_snapshot
           WHERE item_category = ANY($1) AND channel = ANY($2) AND order_type = $3
           GROUP BY custom_master_sku
           ORDER BY qty_0 DESC`,
          [items, channels, orderType]
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[] });

    const [linkRes, customRes] = await Promise.all([linkQuery, customQuery]);

    const toRows = (rows: Record<string, unknown>[]) =>
      rows.map((r) => ({
        masterSku: r.master_sku as string,
        qtys: ranges.map((_, i) => (r[`qty_${i}`] as number) ?? 0),
      }));

    return NextResponse.json({
      success: true,
      link: toRows(linkRes.rows),
      custom: toRows(customRes.rows),
    });
  } catch (e) {
    console.error("[velocity/data] GET error:", getErrorMessage(e));
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status: 500 }
    );
  }
}
