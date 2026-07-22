import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { ACTIVITY_TIME_ZONE, getActivityDate } from "@/lib/activity-date";

type SummaryRow = {
  today_active: string;
  week_active: string;
  month_active: string;
};

type TrendRow = { activity_date: string | Date; active_users: string };

type ActivityUserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  last_seen_at: Date | null;
  activity_days: string;
  activity_count: string;
  last_path: string | null;
  active_today: boolean;
};

export async function GET(request: NextRequest) {
  const denied = await guardPermission("user-permissions", "read");
  if (denied) return denied;

  try {
  const requestedDays = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const today = getActivityDate();
  const startDate = getActivityDate(-(days - 1));
  const weekStart = getActivityDate(-6);
  const monthStart = getActivityDate(-29);
  const pool = getPrimaryPool();

  const [summaryResult, trendResult, usersResult] = await Promise.all([
    pool.query<SummaryRow>(
      `SELECT
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date = $1::date)::text AS today_active,
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date BETWEEN $2::date AND $1::date)::text AS week_active,
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date BETWEEN $3::date AND $1::date)::text AS month_active
       FROM shipcore.fc_user_daily_activity
       WHERE activity_date BETWEEN $3::date AND $1::date`,
      [today, weekStart, monthStart],
    ),
    pool.query<TrendRow>(
      `SELECT days.activity_date,
              COUNT(DISTINCT activity.user_id)::text AS active_users
       FROM generate_series($1::date, $2::date, interval '1 day') AS days(activity_date)
       LEFT JOIN shipcore.fc_user_daily_activity activity
         ON activity.activity_date = days.activity_date::date
       GROUP BY days.activity_date
       ORDER BY days.activity_date ASC`,
      [startDate, today],
    ),
    pool.query<ActivityUserRow>(
      `SELECT users.id,
              users.name,
              users.email,
              users.role,
              users."isActive" AS is_active,
              MAX(activity.last_seen_at) AT TIME ZONE 'UTC' AS last_seen_at,
              COUNT(DISTINCT activity.activity_date)::text AS activity_days,
              COALESCE(SUM(activity.activity_count), 0)::text AS activity_count,
              (ARRAY_AGG(activity.last_path ORDER BY activity.last_seen_at DESC)
                FILTER (WHERE activity.last_path IS NOT NULL))[1] AS last_path,
              COALESCE(BOOL_OR(activity.activity_date = $2::date), false) AS active_today
       FROM shipcore.fc_user users
       LEFT JOIN shipcore.fc_user_daily_activity activity
         ON activity.user_id = users.id
        AND activity.activity_date BETWEEN $1::date AND $2::date
       GROUP BY users.id, users.name, users.email, users.role, users."isActive"
       ORDER BY MAX(activity.last_seen_at) DESC NULLS LAST, users.email ASC`,
      [startDate, today],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? { today_active: "0", week_active: "0", month_active: "0" };

  return NextResponse.json({
    success: true,
    data: {
      timeZone: ACTIVITY_TIME_ZONE,
      periodDays: days,
      summary: {
        today: Number(summary.today_active),
        last7Days: Number(summary.week_active),
        last30Days: Number(summary.month_active),
      },
      trend: trendResult.rows.map((row) => ({
        date: row.activity_date instanceof Date
          ? row.activity_date.toISOString().slice(0, 10)
          : String(row.activity_date).slice(0, 10),
        activeUsers: Number(row.active_users),
      })),
      users: usersResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: row.is_active,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        activityDays: Number(row.activity_days),
        activityCount: Number(row.activity_count),
        lastPath: row.last_path,
        activeToday: row.active_today,
      })),
    },
  });
  } catch (error) {
    console.error("[UserActivity] Failed to load activity summary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load user activity" },
      { status: 500 },
    );
  }
}
