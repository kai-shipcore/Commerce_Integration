/**
 * Data access for the home dashboard's sales-trend widget. Queries
 * ecommerce_data.sales_orders on the Supabase lookup DB — the same source
 * as the Orders page, so home page numbers match /orders.
 */

import { getLookupPool } from "@/lib/db/supabase-lookup";

const ORDER_DATE_DISPLAY_SQL =
  "(((so.order_date AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')";

export interface TrendRow {
  day: string;
  quantity: string;
  revenue: string;
}

export interface TotalRow {
  quantity: string;
  revenue: string;
}

export const HomeRepository = {
  isLookupAvailable(): boolean {
    return getLookupPool() !== null;
  },

  // Callers must check isLookupAvailable() first — these assume the pool exists.
  async getTrend(startDate: string, endDate: string): Promise<TrendRow[]> {
    const pool = getLookupPool()!;
    const result = await pool.query<TrendRow>(
      `SELECT
         ${ORDER_DATE_DISPLAY_SQL}::date::text      AS day,
         COUNT(*)::text                             AS quantity,
         COALESCE(SUM(so.total_price), 0)::text     AS revenue
       FROM ecommerce_data.sales_orders so
       WHERE ${ORDER_DATE_DISPLAY_SQL} >= $1::date
         AND ${ORDER_DATE_DISPLAY_SQL} < ($2::date + INTERVAL '1 day')
       GROUP BY ${ORDER_DATE_DISPLAY_SQL}::date
       ORDER BY ${ORDER_DATE_DISPLAY_SQL}::date ASC`,
      [startDate, endDate],
    );
    return result.rows;
  },

  async getTotal(startDate: string, endDate: string): Promise<TotalRow> {
    const pool = getLookupPool()!;
    const result = await pool.query<TotalRow>(
      `SELECT
         COUNT(*)::text                             AS quantity,
         COALESCE(SUM(so.total_price), 0)::text     AS revenue
       FROM ecommerce_data.sales_orders so
       WHERE ${ORDER_DATE_DISPLAY_SQL} >= $1::date
         AND ${ORDER_DATE_DISPLAY_SQL} < ($2::date + INTERVAL '1 day')`,
      [startDate, endDate],
    );
    return result.rows[0] ?? { quantity: "0", revenue: "0" };
  },

  async getPrevQty(prevStartDate: string, prevEndDate: string): Promise<string> {
    const pool = getLookupPool()!;
    const result = await pool.query<{ quantity: string }>(
      `SELECT COUNT(*)::text AS quantity
       FROM ecommerce_data.sales_orders so
       WHERE ${ORDER_DATE_DISPLAY_SQL} >= $1::date
         AND ${ORDER_DATE_DISPLAY_SQL} < ($2::date + INTERVAL '1 day')`,
      [prevStartDate, prevEndDate],
    );
    return result.rows[0]?.quantity ?? "0";
  },
};
