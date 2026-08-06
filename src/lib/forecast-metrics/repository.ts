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

  /**
   * The most recent week that has actually FINISHED, as its W-MON label.
   *
   * A week runs Tuesday through Monday and is labelled by the Monday it ends
   * on, so the week labelled Monday L is still running for the whole of
   * Monday L. This previously returned `CURRENT_DATE - (ISODOW - 1)`, which is
   * the most recent Monday and is today when today is a Monday. Every Monday,
   * therefore, the accuracy view included a week whose actuals were still being
   * accumulated: `getAccuracyRows` sums orders over `(ds - 7, ds]`, so it
   * picked up a part-day of Monday's sales and scored the forecast against it.
   * The week always looked under-sold and accuracy always looked worse, once a
   * week, for one day.
   *
   * Offset by ISODOW: Mon 7, Tue 1, Wed 2, Thu 3, Fri 4, Sat 5, Sun 6. Written
   * as `((ISODOW + 5) % 7) + 1` so both operands of the modulo stay positive;
   * Postgres truncates rather than floors, so the more obvious
   * `((ISODOW - 2) % 7) + 1` returns 0 on a Monday instead of 7.
   *
   * This is the SQL twin of `last_complete_week` in the forecasting repo's
   * src/weeks.py, and the two must agree.
   */
  async getLastCompletedMonday(): Promise<string> {
    const result = await getPrimaryPool().query<{ last_monday: string }>(
      `SELECT (CURRENT_DATE - (((EXTRACT(ISODOW FROM CURRENT_DATE)::int + 5) % 7) + 1) * interval '1 day')::date::text AS last_monday`,
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
