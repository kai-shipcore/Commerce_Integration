/**
 * Code Guide:
 * GET /api/forecast/[sku]/accuracy
 * Returns per-week forecast vs actual for the OLDEST forecast run that has completed weeks,
 * plus aggregate accuracy metrics (MAE, MAPE, PI coverage).
 * Uses MIN(forecast_date) so the backtest seed (run_backtest_seed.py) is always evaluated —
 * not the latest production run which has shorter look-ahead and inflates accuracy.
 */

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

interface AccuracyRow {
  ds: string;
  yhat: string;
  yhat_lo: string | null;
  yhat_hi: string | null;
  actual: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;

  try {
    // Last completed Monday (W-MON period boundary)
    const lastMondayRes = await getPrimaryPool().query<{ last_monday: string }>(
      `SELECT (CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1) * interval '1 day')::date::text AS last_monday`,
    );
    const lastMonday = lastMondayRes.rows[0].last_monday;

    // Use the OLDEST forecast_date that has at least one completed week.
    // This pins accuracy to the backtest seed (13-week look-ahead, truly out-of-sample).
    // Newer production runs have shorter look-ahead and would make accuracy look artificially good.
    const rows = await getPrimaryPool().query<AccuracyRow>(
      `SELECT
         f.ds::text                  AS ds,
         ROUND(f.yhat::numeric)      AS yhat,
         ROUND(f.yhat_lo::numeric)   AS yhat_lo,
         ROUND(f.yhat_hi::numeric)   AS yhat_hi,
         COALESCE(SUM(v.link_qty), 0)::text AS actual
       FROM shipcore.fc_forward_forecasts f
       LEFT JOIN shipcore.fc_velocity_link_snapshot v
         ON v.link_master_sku = $1
        AND v.order_date >  f.ds - interval '7 days'
        AND v.order_date <= f.ds
       WHERE f.unique_id = $1
         AND f.forecast_date = (
           SELECT MIN(forecast_date)
           FROM shipcore.fc_forward_forecasts
           WHERE unique_id = $1
             AND ds < $2   -- has at least one completed week
         )
         AND f.ds <= $2
       GROUP BY f.ds, f.yhat, f.yhat_lo, f.yhat_hi
       ORDER BY f.ds`,
      [sku, lastMonday],
    );

    if (rows.rows.length === 0) {
      return NextResponse.json({ weeks: [], mae: null, mape: null, coverage: null });
    }

    const weeks = rows.rows.map((r) => ({
      ds: r.ds.slice(0, 10),
      yhat: Number(r.yhat),
      yhat_lo: r.yhat_lo != null ? Number(r.yhat_lo) : null,
      yhat_hi: r.yhat_hi != null ? Number(r.yhat_hi) : null,
      actual: Number(r.actual),
    }));

    // Only compute metrics on weeks that actually have sales (exclude 0-sale weeks from MAPE)
    const nonZero = weeks.filter((w) => w.actual > 0);
    const mae = weeks.length > 0
      ? Math.round(weeks.reduce((s, w) => s + Math.abs(w.yhat - w.actual), 0) / weeks.length)
      : null;
    const mape = nonZero.length > 0
      ? Math.round(nonZero.reduce((s, w) => s + Math.abs(w.yhat - w.actual) / w.actual, 0) / nonZero.length * 100)
      : null;
    const coverage = weeks.filter((w) => w.yhat_lo != null).length > 0
      ? Math.round(
          weeks.filter((w) => w.yhat_lo != null && w.actual >= w.yhat_lo! && w.actual <= w.yhat_hi!).length /
          weeks.filter((w) => w.yhat_lo != null).length * 100,
        )
      : null;

    return NextResponse.json({ weeks, mae, mape, coverage });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
