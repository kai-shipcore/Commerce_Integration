/**
 * Pure data access for user accounts (shipcore.fc_user via Prisma), login
 * history, and the activity dashboards. Role/user-permission-override CRUD
 * lives in src/lib/users/permission-admin-repository.ts (a distinct set of
 * tables with its own cache-key convention). Business logic (menu-visibility
 * merging, effective-permission computation, date/day-range defaults) lives
 * in src/lib/users/service.ts — this file only runs queries.
 */

import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";

export interface UserListFilter {
  where: Prisma.UserWhereInput | undefined;
  orderBy: Prisma.UserOrderByWithRelationInput[];
  skip: number;
  take: number;
}

export type UserListRow = Prisma.UserGetPayload<{
  select: {
    id: true; name: true; email: true; role: true; isActive: true;
    lastLoginAt: true; menuVisibility: true;
    accounts: { select: { provider: true } };
    createdAt: true; updatedAt: true;
  };
}>;

export const UsersRepository = {
  async listUsers(filter: UserListFilter): Promise<{ total: number; users: UserListRow[] }> {
    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where: filter.where }),
      prisma.user.findMany({
        where: filter.where,
        orderBy: filter.orderBy,
        skip: filter.skip,
        take: filter.take,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          menuVisibility: true,
          accounts: { select: { provider: true } },
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    return { total, users };
  },

  async countPermissionOverridesByUser(userIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (userIds.length === 0) return counts;

    const result = await getPrimaryPool().query<{ user_id: string; count: string }>(
      `SELECT user_id, COUNT(*)::text AS count
       FROM shipcore.fc_user_permission_overrides
       WHERE user_id = ANY($1)
       GROUP BY user_id`,
      [userIds],
    );
    for (const row of result.rows) {
      counts.set(row.user_id, parseInt(row.count, 10));
    }
    return counts;
  },

  findById(userId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id: userId } });
  },

  countActiveAdmins(): Promise<number> {
    return prisma.user.count({ where: { isActive: true, role: { in: ["admin", "dev"] } } });
  },

  updateRole(userId: string, role: string, menuVisibility: string[]) {
    return prisma.user.update({
      where: { id: userId },
      data: { role, menuVisibility },
      select: { id: true, role: true, menuVisibility: true, updatedAt: true },
    });
  },

  updateActive(userId: string, isActive: boolean) {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true, updatedAt: true },
    });
  },

  updateName(userId: string, name: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { name },
      select: { id: true, name: true, updatedAt: true },
    });
  },

  updateMenuVisibility(userId: string, visibleMenuIds: string[]) {
    return prisma.user.update({
      where: { id: userId },
      data: { menuVisibility: visibleMenuIds },
      select: { id: true, menuVisibility: true, updatedAt: true },
    });
  },

  getLoginHistory(userId: string) {
    return prisma.userLoginLog.findMany({
      where: { userId },
      orderBy: { loggedInAt: "desc" },
      take: 10,
      select: { id: true, loggedInAt: true, ip: true, userAgent: true },
    });
  },

  // ───────────────────────────────────────────────────────────────────────
  // Activity timeline (single user, single day)
  // ───────────────────────────────────────────────────────────────────────

  async getActivityTimelineUser(userId: string) {
    const result = await getPrimaryPool().query<{ id: string; name: string | null; email: string; role: string }>(
      `SELECT id, name, email, role FROM shipcore.fc_user WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async getActivityTimelineEvents(userId: string, date: string) {
    const result = await getPrimaryPool().query(
      `SELECT id::text, occurred_at AT TIME ZONE 'UTC' AS occurred_at,
              event_type, path, label, target, ip
       FROM shipcore.fc_user_activity_event
       WHERE user_id = $1
         AND (occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
       ORDER BY occurred_at ASC`,
      [userId, date],
    );
    return result.rows;
  },

  async getActivityTimelineLogins(userId: string, date: string) {
    const result = await getPrimaryPool().query(
      `SELECT id, "loggedInAt" AT TIME ZONE 'UTC' AS occurred_at,
              ip, "userAgent" AS user_agent
       FROM shipcore.fc_user_login_log
       WHERE "userId" = $1
         AND ("loggedInAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
       ORDER BY "loggedInAt" ASC`,
      [userId, date],
    );
    return result.rows;
  },

  async getActivityTimelineAuditEvents(userId: string, date: string) {
    const result = await getPrimaryPool().query(
      `SELECT id, entity_type, entity_id, entity_label, action, before, after, note, ip, created_at
       FROM (
         SELECT 'c:' || id::text AS id, 'container' AS entity_type,
                container_id::text AS entity_id, COALESCE(container_number, container_id::text) AS entity_label,
                action, before, after, note, ip, created_at, user_id
         FROM shipcore.fc_container_audit_log
         UNION ALL
         SELECT 'i:' || ial.id::text, 'invoice', ial.invoice_id::text,
                COALESCE(ial.invoice_number, inv.invoice_number, ial.invoice_id::text),
                ial.action, ial.before, ial.after, ial.note, ial.ip, ial.created_at, ial.user_id
         FROM shipcore.fc_invoice_audit_log ial
         LEFT JOIN shipcore.fc_invoices inv ON inv.id = ial.invoice_id
         UNION ALL
         SELECT 'a:' || id::text, entity_type, entity_id,
                COALESCE(entity_label, entity_id), action, before, after, note, ip, created_at, user_id
         FROM shipcore.fc_audit_log
       ) logs
       WHERE user_id = $1
         AND (created_at AT TIME ZONE 'America/Los_Angeles')::date = $2::date
       ORDER BY created_at ASC`,
      [userId, date],
    );
    return result.rows;
  },

  async resolveLegacySkuLabels(labels: string[]): Promise<Map<string, { type: "sku" | "part_sku"; id: string }>> {
    const map = new Map<string, { type: "sku" | "part_sku"; id: string }>();
    if (labels.length === 0) return map;

    const result = await getPrimaryPool().query(
      `WITH known_sku AS (
         SELECT master_sku AS sku, 'sku'::text AS subject_type
         FROM shipcore.sc_products
         UNION ALL
         SELECT sku, 'part_sku'::text AS subject_type
         FROM shipcore.pd_part_skus
       )
       SELECT candidate.label, matched.sku, matched.subject_type
       FROM unnest($1::text[]) AS candidate(label)
       JOIN LATERAL (
         SELECT sku, subject_type
         FROM known_sku
         WHERE candidate.label LIKE sku || '%'
         ORDER BY length(sku) DESC
         LIMIT 1
       ) matched ON true`,
      [labels],
    );
    for (const row of result.rows) {
      map.set(row.label as string, { type: row.subject_type as "sku" | "part_sku", id: row.sku as string });
    }
    return map;
  },

  // ───────────────────────────────────────────────────────────────────────
  // Org-wide activity dashboard
  // ───────────────────────────────────────────────────────────────────────

  async getActivitySummary(today: string, weekStart: string, monthStart: string) {
    const result = await getPrimaryPool().query<{ today_active: string; week_active: string; month_active: string }>(
      `SELECT
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date = $1::date)::text AS today_active,
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date BETWEEN $2::date AND $1::date)::text AS week_active,
         COUNT(DISTINCT user_id) FILTER (WHERE activity_date BETWEEN $3::date AND $1::date)::text AS month_active
       FROM shipcore.fc_user_daily_activity
       WHERE activity_date BETWEEN $3::date AND $1::date`,
      [today, weekStart, monthStart],
    );
    return result.rows[0] ?? { today_active: "0", week_active: "0", month_active: "0" };
  },

  async getActivityTrend(startDate: string, today: string) {
    const result = await getPrimaryPool().query<{ activity_date: string | Date; active_users: string }>(
      `SELECT days.activity_date,
              COUNT(DISTINCT activity.user_id)::text AS active_users
       FROM generate_series($1::date, $2::date, interval '1 day') AS days(activity_date)
       LEFT JOIN shipcore.fc_user_daily_activity activity
         ON activity.activity_date = days.activity_date::date
       GROUP BY days.activity_date
       ORDER BY days.activity_date ASC`,
      [startDate, today],
    );
    return result.rows;
  },

  async getActivityUsers(startDate: string, today: string) {
    const result = await getPrimaryPool().query<{
      id: string; name: string | null; email: string; role: string; is_active: boolean;
      last_seen_at: Date | null; activity_days: string; activity_count: string;
      last_path: string | null; active_today: boolean;
    }>(
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
    );
    return result.rows;
  },
};
