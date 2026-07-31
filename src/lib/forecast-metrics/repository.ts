/**
 * Data access for forecast run metadata and backtest accuracy: the most
 * recent fc_forecast_history run, and per-week forecast-vs-actual rows from
 * fc_forward_forecasts joined against the link velocity snapshot.
 */

import prisma from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";

export interface LastRunRow {
  run_date: Date | null;
  horizon_weeks: bigint | null;
}

export interface AccuracyDbRow {
  ds: string;
  yhat: string;
  yhat_lo: string | null;
  yhat_hi: string | null;
  actual: string;
}

export const ForecastMetricsRepository = {
  async getLastRun(): Promise<LastRunRow | undefined> {
    const rows = await prisma.$queryRaw<LastRunRow[]>`
      SELECT run_date, horizon_weeks
      FROM shipcore.fc_forecast_history
      ORDER BY run_date DESC
      LIMIT 1
    `;
    return rows[0];
  },

  async getLastCompletedMonday(): Promise<string> {
    const result = await getPrimaryPool().query<{ last_monday: string }>(
      `SELECT (CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::int - 1) * interval '1 day')::date::text AS last_monday`,
    );
    return result.rows[0].last_monday;
  },

  async getAccuracyRows(sku: string, lastMonday: string): Promise<AccuracyDbRow[]> {
    const result = await getPrimaryPool().query<AccuracyDbRow>(
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
             AND ds < $2
         )
         AND f.ds <= $2
       GROUP BY f.ds, f.yhat, f.yhat_lo, f.yhat_hi
       ORDER BY f.ds`,
      [sku, lastMonday],
    );
    return result.rows;
  },
};
